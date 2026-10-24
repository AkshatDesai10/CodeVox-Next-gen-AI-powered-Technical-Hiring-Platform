'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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

type GateMode = 'face' | 'permissions_only';

type Props = {
  token: string;
  candidateName?: string;
  consentText: string;
  consentRecorded: boolean;
  faceCaptured: boolean;
  /** face = consent + capture; permissions_only = camera/mic readiness (Approach A). */
  mode?: GateMode;
  onComplete: () => void | Promise<void>;
};

/** Require a few good frames in a row so a lucky flicker can't unlock capture. */
const STABLE_GOOD_FRAMES = 3;

const DEVICE_LOCK_MESSAGE =
  'Your camera or microphone is currently blocked by another application (like Zoom or MS Teams). Please close it completely and try again.';

function isDeviceLockError(err: unknown): boolean {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  return name === 'NotReadableError' || name === 'TrackStartError';
}

export function CandidatePortalIdentityGate({
  token,
  candidateName,
  consentText,
  consentRecorded,
  faceCaptured,
  mode = 'face',
  onComplete,
}: Props) {
  const permissionsOnly = mode === 'permissions_only';
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micRafRef = useRef<number | null>(null);
  const goodStreakRef = useRef(0);
  const [step, setStep] = useState<'consent' | 'face' | 'devices'>(() => {
    if (permissionsOnly) return 'devices';
    return consentRecorded && !faceCaptured ? 'face' : 'consent';
  });
  const [checked, setChecked] = useState(consentRecorded);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [modelsReady, setModelsReady] = useState(false);
  const [faceOk, setFaceOk] = useState(false);
  const [faceHint, setFaceHint] = useState('Loading face detection…');
  const [frozenPreview, setFrozenPreview] = useState<string | null>(null);
  const [deviceLockWarning, setDeviceLockWarning] = useState<string | null>(null);

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
    setFaceOk(false);
    goodStreakRef.current = 0;
  }, [stopMicMeter]);

  const startCamera = useCallback(async () => {
    stopCamera();
    setFrozenPreview(null);
    setDeviceLockWarning(null);
    setError(null);
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
    const videoLive = stream.getVideoTracks().some((track) => track.readyState === 'live');
    const audioLive = stream.getAudioTracks().some((track) => track.readyState === 'live');
    if (!videoLive || !audioLive) {
      stream.getTracks().forEach((track) => track.stop());
      setDeviceLockWarning(DEVICE_LOCK_MESSAGE);
      return;
    }
    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
    }
    setCameraReady(true);
    startMicMeter(stream);
  }, [startMicMeter, stopCamera]);

  useEffect(() => {
    if (step !== 'face' && step !== 'devices') return;
    let cancelled = false;

    if (step === 'face') {
      setModelsReady(false);
      setFaceHint('Loading face detection…');
      void loadFaceModels()
        .then(() => {
          if (!cancelled) {
            setModelsReady(true);
            setFaceHint('Position your face in the frame');
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
    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [startCamera, step, stopCamera]);

  // Live face quality feedback — capture stays disabled until a stable clean face.
  useEffect(() => {
    if (step !== 'face' || !cameraReady || !modelsReady || busy) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const video = videoRef.current;
      if (!video || cancelled) return;
      const check = await validateCleanFaceForEnrollment(video);
      if (cancelled) return;

      if (check.ok) {
        goodStreakRef.current += 1;
      } else {
        goodStreakRef.current = 0;
      }

      const stable = goodStreakRef.current >= STABLE_GOOD_FRAMES;
      setFaceOk(stable);
      if (stable) {
        setFaceHint('Face looks clear and steady — you can capture now');
      } else if (check.ok) {
        setFaceHint('Hold still… confirming a clear face');
      } else {
        setFaceHint(check.reason || 'Adjust your face');
      }
      timer = setTimeout(() => void tick(), check.ok ? 350 : 450);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [busy, cameraReady, modelsReady, step]);

  const submitConsent = async () => {
    setError(null);
    if (!checked) {
      setError('Please accept the consent statement to continue');
      return;
    }
    setBusy(true);
    try {
      await recordCandidateFaceConsent(token);
      setStep('face');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to record consent');
    } finally {
      setBusy(false);
    }
  };

  const submitFace = async () => {
    setError(null);
    const video = videoRef.current;
    if (!video || !cameraReady) {
      setError('Camera is not ready yet');
      return;
    }
    if (!modelsReady) {
      setError('Face detection is still loading. Please wait.');
      return;
    }

    setBusy(true);
    try {
      // 1) Freeze THIS frame immediately (avoids click → move → blurry upload).
      const frozen = freezeVideoFrame(video);
      const previewUrl = canvasToJpegDataUrl(frozen, 0.92);
      setFrozenPreview(previewUrl);
      try {
        video.pause();
      } catch {
        /* ignore */
      }

      // 2) Validate the frozen frame — not a later live frame.
      const check = await validateCleanFaceForEnrollment(frozen);
      if (!check.ok || !check.result?.descriptor?.length) {
        setFaceOk(false);
        goodStreakRef.current = 0;
        setFaceHint(check.reason || 'Face moved — hold still and try again');
        setError(
          check.reason ||
            'Face changed at capture time. Hold still with a clear face and try again.',
        );
        setFrozenPreview(null);
        try {
          await video.play();
        } catch {
          /* ignore */
        }
        return;
      }

      // 3) Upload the exact same frozen JPEG that passed detection.
      await captureCandidateFace(token, {
        image_base64: previewUrl,
        face_descriptor: check.result.descriptor,
      });
      stopCamera();
      await onComplete();
    } catch (err) {
      setFrozenPreview(null);
      try {
        await videoRef.current?.play();
      } catch {
        /* ignore */
      }
      setError(err instanceof Error ? err.message : 'Failed to save face photo');
    } finally {
      setBusy(false);
    }
  };

  const submitDevicesVerified = async () => {
    setError(null);
    if (!cameraReady || !micReady) {
      setError('Camera and microphone must both be working before you continue.');
      return;
    }
    setBusy(true);
    try {
      stopCamera();
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to continue');
    } finally {
      setBusy(false);
    }
  };

  const canCapture = cameraReady && modelsReady && faceOk && !busy;
  const canContinueDevices = cameraReady && micReady && !busy && !deviceLockWarning;

  if (permissionsOnly || step === 'devices') {
    return (
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
        <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-[var(--assessment-surface-container)] p-6 shadow-2xl">
          <div className="mb-1 text-xs font-bold uppercase tracking-wider text-blue-600">
            System & device check
          </div>
          <h2 className="text-2xl font-extrabold tracking-tight text-gray-900">
            Test your camera & microphone
          </h2>
          <p className="mt-2 text-sm font-medium text-gray-500">
            {candidateName ? `Hi ${candidateName}. ` : ''}
            Allow camera and microphone access so interviews and proctored rounds start smoothly.
          </p>

          <div className="mt-6 space-y-4">
            <div
              className={`relative overflow-hidden rounded-xl border-2 bg-black ${
                cameraReady ? 'border-emerald-400' : 'border-amber-300'
              }`}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                className="aspect-[4/3] w-full object-cover"
              />
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div
                className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                  cameraReady
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                Camera: {cameraReady ? 'Connected ✅' : 'Waiting…'}
              </div>
              <div
                className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                  micReady
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border-amber-200 bg-amber-50 text-amber-900'
                }`}
              >
                Mic: {micReady ? 'Working ✅' : 'Waiting…'}
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-black/10">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-[width] duration-75"
                    style={{ width: `${Math.round(micLevel * 100)}%` }}
                  />
                </div>
              </div>
            </div>

            <p className="text-xs font-medium text-gray-500">
              Speak briefly to confirm the mic level moves. Camera preview should show a live feed.
            </p>

            {deviceLockWarning ? (
              <div className="space-y-2">
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  {deviceLockWarning}
                </p>
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="w-full rounded-xl border border-red-200 bg-[var(--assessment-surface-container)] px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50"
                >
                  Try again
                </button>
              </div>
            ) : null}

            <button
              type="button"
              disabled={!canContinueDevices}
              onClick={() => void submitDevicesVerified()}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Continuing…' : 'All Good — Continue'}
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
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-[var(--assessment-surface-container)] p-6 shadow-2xl">
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-blue-600">
          Identity verification
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight text-gray-900">
          {step === 'consent' ? 'Consent required' : 'Capture your face photo'}
        </h2>
        <p className="mt-2 text-sm font-medium text-gray-500">
          {candidateName ? `Hi ${candidateName}. ` : ''}
          Assessment rounds stay locked until you complete this step.
        </p>

        {step === 'consent' ? (
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
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-blue-700 active:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none"
            >
              {busy ? 'Saving…' : 'Agree & continue'}
            </button>
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div
              className={`relative overflow-hidden rounded-xl border-2 bg-black ${
                faceOk ? 'border-emerald-400' : 'border-amber-300'
              }`}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                className={`aspect-[4/3] w-full object-cover ${frozenPreview ? 'invisible absolute inset-0' : ''}`}
              />
              {frozenPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={frozenPreview}
                  alt="Frozen capture preview"
                  className="aspect-[4/3] w-full object-cover"
                />
              ) : null}
            </div>
            <div
              className={`rounded-xl border px-3 py-2 text-xs font-semibold ${
                faceOk
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-amber-200 bg-amber-50 text-amber-900'
              }`}
            >
              {busy && frozenPreview
                ? 'Checking frozen frame… hold still'
                : faceHint}
            </div>
            <p className="text-xs font-medium text-gray-500">
              Camera and microphone are requested now, so the interview does not ask again. Hold
              still when you click capture — we freeze the frame and only save it if that exact
              photo still has a clear face.
            </p>
            {deviceLockWarning ? (
              <div className="space-y-2">
                <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  {deviceLockWarning}
                </p>
                <button
                  type="button"
                  onClick={() => void startCamera()}
                  className="w-full rounded-xl border border-red-200 bg-[var(--assessment-surface-container)] px-4 py-2.5 text-sm font-bold text-red-700 hover:bg-red-50"
                >
                  Try again
                </button>
              </div>
            ) : null}
            <button
              type="button"
              disabled={!canCapture}
              onClick={() => void submitFace()}
              className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy
                ? frozenPreview
                  ? 'Verifying & uploading…'
                  : 'Capturing…'
                : !modelsReady
                  ? 'Preparing face detection…'
                  : !faceOk
                    ? 'Waiting for a clear steady face…'
                    : 'Capture & save photo'}
            </button>
          </div>
        )}

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
