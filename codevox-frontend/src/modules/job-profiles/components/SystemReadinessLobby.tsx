'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
  type NetworkReadinessResult,
  type NetworkReadinessStatus,
} from '@/lib/network-readiness';

type IdentityMode = 'face' | 'permissions_only';

export type SystemReadinessLobbyProps = {
  candidateName?: string;
  identityMode?: IdentityMode;
  /** Portal token — required when capturing face / recording consent. */
  token?: string;
  consentText?: string;
  consentRecorded?: boolean;
  /** When true (face mode + portal), Start freezes/uploads the enrollment photo. */
  persistFaceCapture?: boolean;
  startLabel?: string;
  onComplete: () => void | Promise<void>;
};

const STABLE_GOOD_FRAMES = 3;

const DEVICE_LOCK_MESSAGE =
  'Your camera or microphone is currently blocked by another application (like Zoom or MS Teams). Please close it completely and try again.';

function isDeviceLockError(err: unknown): boolean {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  return name === 'NotReadableError' || name === 'TrackStartError';
}

type CheckState = 'ok' | 'warn' | 'bad' | 'pending';

function checkStateClasses(state: CheckState): {
  row: string;
  icon: string;
  badge: string;
} {
  if (state === 'ok') {
    return {
      row: 'border-emerald-100 bg-emerald-50/70',
      icon: 'bg-emerald-500 text-white',
      badge: 'bg-emerald-100 text-emerald-800',
    };
  }
  if (state === 'bad') {
    return {
      row: 'border-red-100 bg-red-50/80',
      icon: 'bg-red-500 text-white',
      badge: 'bg-red-100 text-red-800',
    };
  }
  if (state === 'warn') {
    return {
      row: 'border-amber-100 bg-amber-50/80',
      icon: 'bg-amber-400 text-white',
      badge: 'bg-amber-100 text-amber-900',
    };
  }
  return {
    row: 'border-slate-200 bg-slate-50',
    icon: 'bg-slate-300 text-white',
    badge: 'bg-slate-200/80 text-slate-600',
  };
}

function networkState(status: NetworkReadinessStatus | null, testing: boolean): CheckState {
  if (testing || status == null) return 'pending';
  if (status === 'good') return 'ok';
  if (status === 'fair') return 'warn';
  return 'bad';
}

function networkLabel(status: NetworkReadinessStatus | null, testing: boolean): string {
  if (testing) return 'Testing…';
  if (status === 'good') return 'Good';
  if (status === 'fair') return 'Fair';
  if (status === 'poor') return 'Poor';
  return 'Waiting';
}

function StatusGlyph({ state }: { state: CheckState }) {
  if (state === 'ok') {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 010 1.42l-7.2 7.2a1 1 0 01-1.42 0l-3.2-3.2a1 1 0 111.42-1.42l2.49 2.49 6.49-6.49a1 1 0 011.42 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (state === 'bad') {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
      </svg>
    );
  }
  if (state === 'warn') {
    return (
      <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.63-1.515 2.63H3.72c-1.347 0-2.188-1.463-1.515-2.63L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 8a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <span className="h-2 w-2 animate-pulse rounded-full bg-white/90" aria-hidden />
  );
}

function StatusRow(props: {
  label: string;
  state: CheckState;
  badge: string;
  detail?: string | null;
  action?: ReactNode;
}) {
  const tone = checkStateClasses(props.state);
  return (
    <div className={`rounded-2xl border px-3.5 py-3 ${tone.row}`}>
      <div className="flex items-center gap-3">
        <span
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${tone.icon}`}
        >
          <StatusGlyph state={props.state} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-semibold text-slate-800">{props.label}</p>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone.badge}`}
            >
              {props.badge}
            </span>
          </div>
          {props.detail ? (
            <p className="mt-1 text-[11px] font-medium leading-snug text-slate-500">
              {props.detail}
            </p>
          ) : null}
        </div>
        {props.action}
      </div>
    </div>
  );
}

function formatNetworkDetail(
  network: NetworkReadinessResult | null,
  testing: boolean,
): string | null {
  if (testing) return 'Measuring ping, jitter, and upload…';
  if (!network) return 'Starting network test…';
  if (network.pingMs != null && network.uploadMbps != null) {
    const jitter =
      network.jitterMs != null ? ` · Jitter ${Math.round(network.jitterMs)}ms` : '';
    return `Ping ${Math.round(network.pingMs)}ms${jitter} · Upload ${network.uploadMbps.toFixed(1)} Mbps`;
  }
  return network.reason || null;
}

function MicEqualizer({ level }: { level: number }) {
  const bars = 16;
  return (
    <div className="flex h-8 items-end gap-0.5 rounded-lg bg-slate-900/90 px-2 py-1.5" aria-hidden>
      {Array.from({ length: bars }, (_, i) => {
        const threshold = (i + 1) / bars;
        const active = level >= threshold * 0.85;
        const mid = i > bars * 0.45 && i < bars * 0.75;
        const color = !active
          ? 'bg-slate-600'
          : mid
            ? 'bg-amber-400'
            : 'bg-emerald-400';
        const height = active ? 20 + ((i * 17) % 12) : 6;
        return (
          <div
            key={i}
            className={`w-1.5 rounded-sm transition-[height,background-color] duration-75 ${color}`}
            style={{ height: `${height}px` }}
          />
        );
      })}
    </div>
  );
}

export function SystemReadinessLobby({
  candidateName,
  identityMode = 'permissions_only',
  token,
  consentText = 'I consent to capture and store my facial photograph for identity verification and assessment integrity.',
  consentRecorded = false,
  persistFaceCapture = true,
  startLabel = 'Start Assessment',
  onComplete,
}: SystemReadinessLobbyProps) {
  const faceMode = identityMode === 'face';
  const needsConsentStep = faceMode && persistFaceCapture && Boolean(token) && !consentRecorded;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micRafRef = useRef<number | null>(null);
  const goodStreakRef = useRef(0);

  const [step, setStep] = useState<'consent' | 'lobby'>(() =>
    needsConsentStep ? 'consent' : 'lobby',
  );
  const [checked, setChecked] = useState(consentRecorded);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deviceLockWarning, setDeviceLockWarning] = useState<string | null>(null);

  const [cameraReady, setCameraReady] = useState(false);
  const [cameraLabel, setCameraLabel] = useState<string | null>(null);
  const [micReady, setMicReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [micHeard, setMicHeard] = useState(false);

  const [network, setNetwork] = useState<NetworkReadinessResult | null>(null);
  const [networkTesting, setNetworkTesting] = useState(false);

  const [modelsReady, setModelsReady] = useState(!faceMode);
  const [faceOk, setFaceOk] = useState(false);
  const [faceHint, setFaceHint] = useState(
    faceMode ? 'Loading face detection…' : '',
  );

  const stopMicMeter = useCallback(() => {
    if (micRafRef.current != null) {
      cancelAnimationFrame(micRafRef.current);
      micRafRef.current = null;
    }
    analyserRef.current = null;
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
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
          setMicHeard(true);
          return;
        }
        const ctx = new Ctx();
        if (ctx.state === 'suspended') {
          void ctx.resume().catch(() => undefined);
        }
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
          const level = Math.min(1, avg * 2.2);
          setMicLevel(level);
          if (level > 0.08) setMicHeard(true);
          micRafRef.current = requestAnimationFrame(tick);
        };
        micRafRef.current = requestAnimationFrame(tick);
      } catch {
        setMicReady(true);
        setMicHeard(true);
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
    setFaceOk(false);
    goodStreakRef.current = 0;
  }, [stopMicMeter]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setDeviceLockWarning(null);
    setError(null);
    setMicHeard(false);
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      });
    } catch (err) {
      if (isDeviceLockError(err)) {
        setDeviceLockWarning(DEVICE_LOCK_MESSAGE);
        return;
      }
      setError(
        err instanceof Error
          ? err.message
          : 'Camera and microphone access is required.',
      );
      return;
    }
    const videoLive = stream.getVideoTracks().some((t) => t.readyState === 'live');
    const audioLive = stream.getAudioTracks().some((t) => t.readyState === 'live');
    if (!videoLive || !audioLive) {
      stream.getTracks().forEach((t) => t.stop());
      setDeviceLockWarning(DEVICE_LOCK_MESSAGE);
      return;
    }
    streamRef.current = stream;
    const videoTrack = stream.getVideoTracks()[0];
    setCameraLabel(videoTrack?.label?.trim() || 'Camera');
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
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
    if (step !== 'lobby') return;
    let cancelled = false;

    if (faceMode) {
      setModelsReady(false);
      setFaceHint('Detecting Face…');
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
    }

    void startCamera();
    void runNetworkTest();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [faceMode, runNetworkTest, startCamera, step, stopCamera]);

  useEffect(() => {
    if (step !== 'lobby' || !faceMode || !cameraReady || !modelsReady || busy) return;
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
      if (stable) setFaceHint('Face Detected ✅');
      else if (check.ok) setFaceHint('Hold still… confirming face');
      else setFaceHint(check.reason || 'Center your face in the camera');

      timer = setTimeout(() => void tick(), check.ok ? 350 : 450);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [busy, cameraReady, faceMode, modelsReady, step]);

  const micActive = micReady && (micHeard || micLevel > 0.05);
  const networkOk = network != null && network.status !== 'poor' && !networkTesting;
  const faceValidated = !faceMode || faceOk;

  const canStart =
    cameraReady &&
    micActive &&
    networkOk &&
    faceValidated &&
    !busy &&
    !deviceLockWarning &&
    !networkTesting;

  const disabledReason = useMemo(() => {
    if (busy) return null;
    if (deviceLockWarning) return deviceLockWarning;
    if (!cameraReady) return 'Waiting for camera connection…';
    if (!micActive) return 'Speak briefly so we can confirm your microphone.';
    if (networkTesting) return 'Network test in progress…';
    if (!network || network.status === 'poor') {
      return network?.reason || 'Network must be Fair or Good to continue.';
    }
    if (faceMode && !modelsReady) return 'Preparing face detection…';
    if (faceMode && !faceOk) return faceHint || 'Center your face in the camera.';
    return null;
  }, [
    busy,
    cameraReady,
    deviceLockWarning,
    faceHint,
    faceMode,
    faceOk,
    micActive,
    modelsReady,
    network,
    networkTesting,
  ]);

  const submitConsent = async () => {
    setError(null);
    if (!checked) {
      setError('Please accept the consent statement to continue');
      return;
    }
    if (!token) {
      setError('Missing session token for consent.');
      return;
    }
    setBusy(true);
    try {
      await recordCandidateFaceConsent(token);
      setStep('lobby');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record consent');
    } finally {
      setBusy(false);
    }
  };

  const handleStart = async () => {
    setError(null);
    if (!canStart) return;
    setBusy(true);
    try {
      if (faceMode && persistFaceCapture && token) {
        const video = videoRef.current;
        if (!video || !cameraReady) throw new Error('Camera is not ready yet');
        const frozen = freezeVideoFrame(video);
        const previewUrl = canvasToJpegDataUrl(frozen, 0.92);
        const check = await validateCleanFaceForEnrollment(frozen);
        if (!check.ok || !check.result?.descriptor?.length) {
          setFaceOk(false);
          goodStreakRef.current = 0;
          setFaceHint(check.reason || 'Face moved — hold still and try again');
          throw new Error(
            check.reason ||
              'Face changed at capture time. Hold still with a clear face and try again.',
          );
        }
        await captureCandidateFace(token, {
          image_base64: previewUrl,
          face_descriptor: check.result.descriptor,
        });
      }
      stopCamera();
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'consent') {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-blue-600">
            Identity verification
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-gray-900">
            Consent required
          </h2>
          <p className="mt-2 text-sm font-medium text-gray-500">
            {candidateName ? `Hi ${candidateName}. ` : ''}
            Assessment rounds stay locked until you complete this step.
          </p>
          <div className="mt-6 space-y-4">
            <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-sm leading-relaxed text-blue-950">
              {consentText}
            </div>
            <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 p-4 transition-colors hover:bg-gray-100/80">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => {
                  setChecked(e.target.checked);
                  if (error) setError(null);
                }}
                className="mt-0.5 h-5 w-5 cursor-pointer rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="select-none text-sm font-semibold text-gray-800">
                I have read and agree to the consent statement above.
              </span>
            </label>
            <button
              type="button"
              disabled={!checked || busy}
              onClick={() => void submitConsent()}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
            >
              {busy ? 'Saving…' : 'Agree & continue to system check'}
            </button>
          </div>
          {error ? (
            <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
              {error}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md">
      <div className="flex w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl md:flex-row">
        {/* Preview pane */}
        <div className="relative flex flex-1 flex-col bg-slate-950 p-4 md:p-5">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-white">System readiness</h2>
            </div>
            {cameraLabel ? (
              <span className="max-w-[45%] truncate rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-semibold text-slate-200">
                {cameraLabel}
              </span>
            ) : null}
          </div>

          <div
            className={`relative overflow-hidden rounded-2xl border-2 bg-black ${
              cameraReady ? 'border-emerald-400/70' : 'border-amber-400/50'
            }`}
          >
            <video
              ref={videoRef}
              playsInline
              muted
              className="aspect-[4/3] w-full scale-x-[-1] object-cover"
            />
            {!cameraReady ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 text-sm font-medium text-slate-300">
                Waiting for camera…
              </div>
            ) : null}
          </div>

          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-300">
              <span>Microphone level</span>
              <span>{micActive ? 'Hearing you' : 'Speak to test'}</span>
            </div>
            <MicEqualizer level={micLevel} />
          </div>

          <p className="mt-3 text-xs leading-relaxed text-slate-400">
            {candidateName ? `Hi ${candidateName}. ` : ''}
            Confirm camera, mic, and network before you enter.
          </p>
        </div>

        {/* Checklist pane */}
        <div className="flex w-full flex-col justify-between gap-5 border-l border-slate-100 bg-slate-50/40 p-5 md:w-[23rem] md:shrink-0 md:p-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold tracking-tight text-slate-900">Status checks</h3>
              <span className="text-[11px] font-medium text-slate-400">
                {[
                  cameraReady,
                  micActive,
                  networkOk,
                  faceValidated,
                ].filter(Boolean).length}
                /
                {[true, true, true, faceMode].filter(Boolean).length} ready
              </span>
            </div>

            <div className="space-y-2.5">
              <StatusRow
                label="Camera"
                state={cameraReady ? 'ok' : deviceLockWarning ? 'bad' : 'pending'}
                badge={cameraReady ? 'Connected' : 'Waiting'}
                detail={cameraReady ? cameraLabel || 'Live preview ready' : 'Allow camera access'}
              />

              <StatusRow
                label="Microphone"
                state={micActive ? 'ok' : micReady ? 'warn' : 'pending'}
                badge={micActive ? 'Active' : micReady ? 'Speak' : 'Waiting'}
                detail={
                  micActive
                    ? 'Audio input confirmed'
                    : micReady
                      ? 'Speak briefly to confirm input'
                      : 'Allow microphone access'
                }
                action={
                  micReady ? (
                    <div className="ml-1 flex h-8 w-1.5 items-end overflow-hidden rounded-full bg-black/10">
                      <div
                        className="w-full rounded-full bg-emerald-500 transition-[height] duration-75"
                        style={{ height: `${Math.max(10, Math.round(micLevel * 100))}%` }}
                      />
                    </div>
                  ) : null
                }
              />

              <StatusRow
                label="Network"
                state={networkState(network?.status ?? null, networkTesting)}
                badge={networkLabel(network?.status ?? null, networkTesting)}
                detail={formatNetworkDetail(network, networkTesting)}
                action={
                  network?.status === 'poor' || (!network && !networkTesting) ? (
                    <button
                      type="button"
                      onClick={() => void runNetworkTest()}
                      disabled={networkTesting}
                      className="shrink-0 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-blue-700 shadow-sm ring-1 ring-blue-100 hover:bg-blue-50 disabled:opacity-50"
                    >
                      Retry
                    </button>
                  ) : null
                }
              />

              {faceMode ? (
                <StatusRow
                  label="Face"
                  state={
                    faceOk ? 'ok' : !modelsReady ? 'pending' : 'warn'
                  }
                  badge={
                    faceOk
                      ? 'Detected'
                      : !modelsReady
                        ? 'Loading'
                        : 'Adjust'
                  }
                  detail={
                    faceOk
                      ? 'Clear face in frame'
                      : !modelsReady
                        ? 'Loading face detection…'
                        : faceHint || 'Center your face in the camera'
                  }
                />
              ) : null}
            </div>

            {network?.status === 'fair' ? (
              <p className="rounded-xl border border-amber-100 bg-amber-50/90 px-3 py-2 text-[11px] font-medium text-amber-900">
                Connection is usable but may be unstable. Prefer stronger Wi‑Fi if you can.
              </p>
            ) : null}

            {deviceLockWarning ? (
              <div className="space-y-2">
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  {deviceLockWarning}
                </p>
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="w-full rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50"
                >
                  Try camera again
                </button>
              </div>
            ) : null}

            {error ? (
              <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {error}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            {!canStart && disabledReason ? (
              <p className="text-center text-[11px] font-medium leading-snug text-slate-500">
                {disabledReason}
              </p>
            ) : canStart ? (
              <p className="text-center text-[11px] font-medium text-emerald-700">
                All checks passed — you can continue
              </p>
            ) : null}
            <button
              type="button"
              disabled={!canStart}
              onClick={() => void handleStart()}
              className="w-full rounded-2xl bg-blue-600 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              {busy ? 'Starting…' : startLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
