'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  canvasToJpegDataUrl,
  freezeVideoFrame,
  loadFaceModels,
  validateCleanFaceForEnrollment,
} from '@/modules/proctor/face-models';
import {
  captureCandidateFace,
  recordCandidateFaceConsent,
} from '@/lib/candidate-api';
import {
  checkNetworkReadiness,
  formatNetworkMetrics,
  type NetworkReadinessResult,
  type NetworkReadinessStatus,
} from '@/lib/network-readiness';

const STABLE_GOOD_FRAMES = 3;

const DEVICE_LOCK_MESSAGE =
  'Your camera or microphone is currently blocked by another application (like Zoom or MS Teams). Please close it completely and try again.';

function isDeviceLockError(err: unknown): boolean {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  return name === 'NotReadableError' || name === 'TrackStartError';
}

type Props = {
  /** Portal token — required when faceMode needs consent + face capture APIs. */
  portalToken?: string;
  candidateName?: string;
  /** FACE=on → run face validation (+ optional portal capture). */
  faceMode?: boolean;
  consentText?: string;
  consentAlreadyRecorded?: boolean;
  faceAlreadyCaptured?: boolean;
  startLabel?: string;
  title?: string;
  subtitle?: string;
  onComplete: () => void | Promise<void>;
};

type CheckState = 'pending' | 'ok' | 'warn' | 'fail';

function statusTone(state: CheckState) {
  if (state === 'ok') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
  if (state === 'warn') return 'bg-amber-500/15 text-amber-200 border-amber-500/30';
  if (state === 'fail') return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
  return 'bg-white/5 text-[#94A3B8] border-white/10';
}

function networkToCheck(status: NetworkReadinessStatus | null, testing: boolean): CheckState {
  if (testing || status == null) return 'pending';
  if (status === 'good') return 'ok';
  if (status === 'fair') return 'warn';
  return 'fail';
}

export function SystemReadinessLobby({
  portalToken,
  candidateName,
  faceMode = false,
  consentText = 'I consent to capture and store my facial photograph for identity verification and assessment integrity.',
  consentAlreadyRecorded = false,
  faceAlreadyCaptured = false,
  startLabel = 'Start Assessment',
  title = 'System check',
  subtitle = 'Confirm camera, mic, and network before you begin — just like joining a video call.',
  onComplete,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micRafRef = useRef<number | null>(null);
  const goodStreakRef = useRef(0);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraLabel, setCameraLabel] = useState<string | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [deviceError, setDeviceError] = useState<string | null>(null);

  const [network, setNetwork] = useState<NetworkReadinessResult | null>(null);
  const [networkTesting, setNetworkTesting] = useState(false);

  const [modelsReady, setModelsReady] = useState(!faceMode || faceAlreadyCaptured);
  const [faceOk, setFaceOk] = useState(!faceMode || faceAlreadyCaptured);
  const [faceHint, setFaceHint] = useState(
    faceMode && !faceAlreadyCaptured ? 'Loading face detection…' : 'Face check not required',
  );

  const [consentChecked, setConsentChecked] = useState(consentAlreadyRecorded);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopMicMeter = useCallback(() => {
    if (micRafRef.current != null) {
      cancelAnimationFrame(micRafRef.current);
      micRafRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
    }
    audioCtxRef.current = null;
    setMicLevel(0);
  }, []);

  const startMicMeter = useCallback(
    (stream: MediaStream) => {
      stopMicMeter();
      const audioTracks = stream.getAudioTracks().filter((t) => t.readyState === 'live');
      if (!audioTracks.length) {
        setMicReady(false);
        return;
      }
      try {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) {
          setMicReady(true);
          return;
        }
        const ctx = new Ctx();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
        setMicReady(true);

        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          const node = analyserRef.current;
          if (!node) return;
          node.getByteFrequencyData(data);
          let sum = 0;
          for (let i = 0; i < data.length; i += 1) sum += data[i];
          const avg = sum / data.length / 255;
          setMicLevel(Math.min(1, avg * 2.2));
          micRafRef.current = requestAnimationFrame(tick);
        };
        micRafRef.current = requestAnimationFrame(tick);
      } catch {
        setMicReady(true);
      }
    },
    [stopMicMeter],
  );

  const stopCamera = useCallback(() => {
    stopMicMeter();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
    setMicReady(false);
    if (faceMode && !faceAlreadyCaptured) {
      setFaceOk(false);
      goodStreakRef.current = 0;
    }
  }, [faceAlreadyCaptured, faceMode, stopMicMeter]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setDeviceError(null);
    setError(null);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    } catch (err) {
      if (isDeviceLockError(err)) {
        setDeviceError(DEVICE_LOCK_MESSAGE);
        return;
      }
      setDeviceError(
        err instanceof Error ? err.message : 'Camera and microphone access is required.',
      );
      return;
    }

    const videoTrack = stream.getVideoTracks().find((t) => t.readyState === 'live');
    const audioLive = stream.getAudioTracks().some((t) => t.readyState === 'live');
    if (!videoTrack || !audioLive) {
      stream.getTracks().forEach((t) => t.stop());
      setDeviceError(DEVICE_LOCK_MESSAGE);
      return;
    }

    streamRef.current = stream;
    setCameraLabel(videoTrack.label?.trim() || 'Camera');
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => undefined);
    }
    setCameraReady(true);
    startMicMeter(stream);
  }, [startMicMeter, stopCamera]);

  const runNetworkTest = useCallback(async () => {
    setNetworkTesting(true);
    setError(null);
    try {
      const result = await checkNetworkReadiness();
      setNetwork(result);
    } finally {
      setNetworkTesting(false);
    }
  }, []);

  useEffect(() => {
    void startCamera();
    void runNetworkTest();
    return () => {
      stopCamera();
    };
  }, [runNetworkTest, startCamera, stopCamera]);

  useEffect(() => {
    if (!faceMode || faceAlreadyCaptured) return;
    let cancelled = false;
    setModelsReady(false);
    setFaceHint('Loading face detection…');
    void loadFaceModels()
      .then(() => {
        if (!cancelled) {
          setModelsReady(true);
          setFaceHint('Center your face in the camera');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError('Face detection failed to load. Refresh and try again.');
          setFaceHint('Face detection unavailable');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [faceAlreadyCaptured, faceMode]);

  useEffect(() => {
    if (!faceMode || faceAlreadyCaptured || !cameraReady || !modelsReady || busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const video = videoRef.current;
      if (!video || cancelled) return;
      const check = await validateCleanFaceForEnrollment(video);
      if (cancelled) return;

      if (check.ok) goodStreakRef.current += 1;
      else goodStreakRef.current = 0;

      const stable = goodStreakRef.current >= STABLE_GOOD_FRAMES;
      setFaceOk(stable);
      if (stable) setFaceHint('Face detected');
      else if (check.ok) setFaceHint('Hold still… confirming a clear face');
      else setFaceHint(check.reason || 'Center your face in the camera');

      timer = setTimeout(() => void tick(), check.ok ? 350 : 450);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [busy, cameraReady, faceAlreadyCaptured, faceMode, modelsReady]);

  const networkState = networkToCheck(network?.status ?? null, networkTesting);
  const cameraState: CheckState = deviceError ? 'fail' : cameraReady ? 'ok' : 'pending';
  const micState: CheckState = deviceError ? 'fail' : micReady ? 'ok' : 'pending';
  const faceState: CheckState = !faceMode
    ? 'ok'
    : faceAlreadyCaptured || faceOk
      ? 'ok'
      : modelsReady
        ? 'warn'
        : 'pending';

  const canStart = useMemo(() => {
    if (!cameraReady || !micReady) return false;
    if (networkState === 'fail' || networkState === 'pending') return false;
    if (faceMode && !faceAlreadyCaptured && !faceOk) return false;
    if (faceMode && portalToken && !faceAlreadyCaptured && !consentChecked) return false;
    return true;
  }, [
    cameraReady,
    consentChecked,
    faceAlreadyCaptured,
    faceMode,
    faceOk,
    micReady,
    networkState,
    portalToken,
  ]);

  const disabledReason = useMemo(() => {
    if (deviceError) return deviceError;
    if (!cameraReady) return 'Waiting for camera…';
    if (!micReady) return 'Waiting for microphone…';
    if (networkTesting || !network) return 'Running network test…';
    if (network.status === 'poor') return 'Fix your connection, then retry the network test.';
    if (faceMode && !faceAlreadyCaptured && !modelsReady) return 'Loading face detection…';
    if (faceMode && !faceAlreadyCaptured && !faceOk) return faceHint || 'Center your face in the camera';
    if (faceMode && portalToken && !faceAlreadyCaptured && !consentChecked) {
      return 'Accept the face consent checkbox to continue.';
    }
    return null;
  }, [
    cameraReady,
    consentChecked,
    deviceError,
    faceAlreadyCaptured,
    faceHint,
    faceMode,
    faceOk,
    micReady,
    modelsReady,
    network,
    networkTesting,
    portalToken,
  ]);

  const handleStart = async () => {
    if (!canStart || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (faceMode && portalToken && !faceAlreadyCaptured) {
        if (!consentChecked) {
          setError('Please accept the consent statement to continue.');
          return;
        }
        if (!consentAlreadyRecorded) {
          await recordCandidateFaceConsent(portalToken);
        }
        const video = videoRef.current;
        if (!video || !cameraReady) {
          setError('Camera is not ready yet.');
          return;
        }
        const frozen = freezeVideoFrame(video);
        const previewUrl = canvasToJpegDataUrl(frozen, 0.92);
        const check = await validateCleanFaceForEnrollment(frozen);
        if (!check.ok || !check.result?.descriptor?.length) {
          setFaceOk(false);
          goodStreakRef.current = 0;
          setFaceHint(check.reason || 'Hold still with a clear face');
          setError(check.reason || 'Face moved at capture time. Hold still and try again.');
          return;
        }
        await captureCandidateFace(portalToken, {
          image_base64: previewUrl,
          face_descriptor: check.result.descriptor,
        });
      }
      stopCamera();
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete system check.');
    } finally {
      setBusy(false);
    }
  };

  const barCount = 16;
  const activeBars = Math.max(1, Math.round(micLevel * barCount));

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#090414]/85 p-4 backdrop-blur-sm">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-3xl border border-white/10 bg-[#160A30] shadow-2xl md:grid-cols-2">
        {/* Preview column */}
        <div className="relative flex flex-col gap-3 border-b border-white/10 bg-[#090414]/60 p-5 md:border-b-0 md:border-r">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-widest text-[#C4B5FD]">
                Pre-flight lobby
              </div>
              <h2 className="text-xl font-extrabold tracking-tight text-white">{title}</h2>
            </div>
            {candidateName ? (
              <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-[#C4B5FD]">
                {candidateName}
              </div>
            ) : null}
          </div>
          <p className="text-sm text-[#94A3B8]">{subtitle}</p>

          <div className="relative aspect-video overflow-hidden rounded-2xl border border-white/10 bg-black">
            <video
              ref={videoRef}
              className="h-full w-full scale-x-[-1] object-cover"
              playsInline
              muted
              autoPlay
            />
            {!cameraReady ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm text-[#94A3B8]">
                {deviceError ? 'Camera unavailable' : 'Starting camera…'}
              </div>
            ) : null}
            {cameraReady && cameraLabel ? (
              <div className="absolute left-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
                {cameraLabel}
              </div>
            ) : null}
          </div>

          {/* Mic equalizer */}
          <div className="rounded-xl border border-white/10 bg-[#090414]/80 p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-[#94A3B8]">
              <span>Microphone</span>
              <span className={micReady ? 'text-emerald-300' : 'text-amber-200'}>
                {micReady ? 'Live' : 'Waiting'}
              </span>
            </div>
            <div className="flex h-10 items-end gap-1">
              {Array.from({ length: barCount }).map((_, i) => {
                const on = i < activeBars;
                const warn = micLevel > 0.75;
                return (
                  <div
                    key={i}
                    className={`flex-1 rounded-sm transition-all duration-75 ${
                      on
                        ? warn
                          ? 'bg-amber-400'
                          : 'bg-emerald-400'
                        : 'bg-white/10'
                    }`}
                    style={{ height: `${12 + ((i * 7) % 28) + (on ? micLevel * 20 : 0)}%` }}
                  />
                );
              })}
            </div>
            <p className="mt-2 text-[11px] text-[#64748B]">Speak normally — bars should move.</p>
          </div>
        </div>

        {/* Checklist column */}
        <div className="flex flex-col gap-4 p-5">
          <h3 className="text-sm font-bold uppercase tracking-widest text-[#C4B5FD]">Status</h3>

          <StatusRow
            label="Camera"
            state={cameraState}
            detail={cameraReady ? cameraLabel || 'Connected' : deviceError || 'Connecting…'}
          />
          <StatusRow
            label="Microphone"
            state={micState}
            detail={micReady ? 'Active input detected' : 'Waiting for audio…'}
          />
          <StatusRow
            label="Network"
            state={networkState}
            detail={
              networkTesting
                ? 'Measuring ping, jitter & upload…'
                : network
                  ? `${formatNetworkMetrics(network)}${network.status === 'fair' ? ' — fair' : ''}`
                  : 'Not tested yet'
            }
            action={
              <button
                type="button"
                onClick={() => void runNetworkTest()}
                disabled={networkTesting || busy}
                className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-semibold text-[#C4B5FD] hover:bg-white/5 disabled:opacity-50"
              >
                {networkTesting ? 'Testing…' : 'Retry Test'}
              </button>
            }
          />

          {faceMode ? (
            <StatusRow
              label="Face status"
              state={faceState}
              detail={
                faceAlreadyCaptured
                  ? 'Face already verified'
                  : faceOk
                    ? 'Face detected'
                    : faceHint
              }
            />
          ) : null}

          {network?.status === 'fair' ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
              {network.reason}
            </div>
          ) : null}
          {network?.status === 'poor' ? (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {network.reason}
            </div>
          ) : null}
          {deviceError ? (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {deviceError}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {error}
            </div>
          ) : null}

          {faceMode && portalToken && !faceAlreadyCaptured ? (
            <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-xs text-[#C4B5FD]">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
                disabled={busy}
              />
              <span className="leading-relaxed text-[#94A3B8]">{consentText}</span>
            </label>
          ) : null}

          <div className="mt-auto space-y-2 pt-2">
            {!canStart && disabledReason ? (
              <p className="text-center text-[11px] text-[#64748B]">{disabledReason}</p>
            ) : null}
            <button
              type="button"
              disabled={!canStart || busy}
              onClick={() => void handleStart()}
              className="w-full rounded-xl bg-[#7C3AED] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-purple-500/20 transition hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-45"
            >
              {busy ? 'Saving…' : startLabel}
            </button>
            {(deviceError || !cameraReady) && (
              <button
                type="button"
                onClick={() => void startCamera()}
                disabled={busy}
                className="w-full rounded-xl border border-white/15 px-4 py-2 text-xs font-semibold text-[#C4B5FD] hover:bg-white/5 disabled:opacity-50"
              >
                Retry camera & mic
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusRow(props: {
  label: string;
  state: CheckState;
  detail: string;
  action?: ReactNode;
}) {
  const pill =
    props.state === 'ok'
      ? 'Ready'
      : props.state === 'warn'
        ? 'Check'
        : props.state === 'fail'
          ? 'Blocked'
          : '…';
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{props.label}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${statusTone(props.state)}`}>
            {pill}
          </span>
        </div>
        <p className="mt-1 truncate text-[11px] text-[#94A3B8]">{props.detail}</p>
      </div>
      {props.action}
    </div>
  );
}
