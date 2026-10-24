'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import {
  enrollInterviewVoice,
  recordInterviewConsent,
  verifyInterviewIdentity,
  verifyInterviewLiveness,
} from '@/modules/autonomous-interview/lib/autonomous-interview-api';
import { captureFaceDescriptor, loadFaceModels } from '@/modules/proctor/face-models';
import { useLivenessChallenge } from '@/modules/proctor/useLivenessChallenge';

type Props = {
  candidateToken: string;
  consentText?: string;
  candidateName?: string;
  requireCameraForStart?: boolean;
  requireVoiceEnroll?: boolean;
  initialStep?: 'consent' | 'liveness' | 'identity' | 'voice' | 'done';
  onComplete: () => Promise<void>;
};

const DEVICE_LOCK_MESSAGE =
  'Your camera or microphone is currently blocked by another application (like Zoom or MS Teams). Please close it completely and try again.';

function isDeviceLockError(err: unknown): boolean {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  return name === 'NotReadableError' || name === 'TrackStartError';
}

async function recordAudioBase64(durationMs = 4000): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const done = new Promise<Blob>((resolve) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
  });
  recorder.start();
  await new Promise((r) => setTimeout(r, durationMs));
  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  const blob = await done;
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function InterviewConsentGate({
  candidateToken,
  consentText,
  candidateName,
  requireCameraForStart = true,
  requireVoiceEnroll = true,
  initialStep = 'consent',
  onComplete,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [checked, setChecked] = useState(false);
  const [step, setStep] = useState<'consent' | 'liveness' | 'identity' | 'voice' | 'done'>(initialStep);
  const [error, setError] = useState<string | null>(null);
  const [deviceLockWarning, setDeviceLockWarning] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const liveness = useLivenessChallenge(videoRef);

  const bindCamera = useCallback(async () => {
    setDeviceLockWarning(null);
    setCameraReady(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      const live =
        stream.getVideoTracks().some((track) => track.readyState === 'live') &&
        stream.getAudioTracks().some((track) => track.readyState === 'live');
      if (!live) {
        setDeviceLockWarning(DEVICE_LOCK_MESSAGE);
        return;
      }
      setCameraReady(true);
    } catch (err) {
      setCameraReady(false);
      setDeviceLockWarning(
        isDeviceLockError(err)
          ? DEVICE_LOCK_MESSAGE
          : err instanceof Error
            ? err.message
            : 'Could not access the camera or microphone.',
      );
    }
  }, []);

  useEffect(() => {
    if (!requireCameraForStart) return;
    if (step === 'consent' || step === 'done') return;

    void loadFaceModels();
    void bindCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [bindCamera, requireCameraForStart, step]);

  useEffect(() => {
    if (step === 'liveness' && cameraReady) liveness.start();
  }, [step, cameraReady, liveness]);

  const handleContinue = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (step === 'consent') {
        if (!checked) throw new Error('Please accept consent to continue');
        await recordInterviewConsent(candidateToken);
        // If no proctoring required (demo/preview), skip straight to done
        if (!requireCameraForStart && !requireVoiceEnroll) {
          setStep('done');
          await onComplete();
          return;
        }
        setStep(requireCameraForStart ? 'liveness' : 'voice');
        return;
      }

      if (step === 'liveness') {
        if (!liveness.passed) throw new Error('Complete the liveness challenge first');
        await verifyInterviewLiveness(candidateToken, {
          challenge_id: liveness.challengeId,
          passed: true,
          motion_score: liveness.motionScore,
          steps_completed: liveness.completedSteps,
        });
        setStep('identity');
        return;
      }

      if (step === 'identity') {
        const video = videoRef.current;
        if (!video) throw new Error('Camera not ready');
        const face = await captureFaceDescriptor(video);
        if (!face || face.faceCount !== 1) throw new Error('Show exactly one face in frame');
        await verifyInterviewIdentity(candidateToken, {
          descriptor: face.descriptor,
          capture_quality: face.quality,
        });
        setStep(requireVoiceEnroll ? 'voice' : 'done');
        if (!requireVoiceEnroll) {
          await onComplete();
        }
        return;
      }

      if (step === 'voice') {
        const audioBase64 = await recordAudioBase64();
        await enrollInterviewVoice(candidateToken, { audio_base64: audioBase64 });
        setStep('done');
        await onComplete();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--assessment-surface)] p-6">
      <div className="w-full max-w-lg rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-lg">
        <h1 className="mb-2 text-xl font-semibold text-[var(--assessment-primary)]">
          Interview readiness
        </h1>
        <p className="mb-4 text-sm text-[var(--assessment-on-surface-variant)]">
          {candidateName ? `Welcome, ${candidateName}. ` : ''}
          {step === 'consent'
            ? consentText ?? 'Consent to recording and fraud checks is required.'
            : step === 'liveness'
              ? 'Please follow the prompt in the video below to verify liveness.'
              : step === 'identity'
                ? 'Hold still - we will capture your reference photo.'
                : 'Speak clearly: "My name is [name] and I am completing this interview myself."'}
        </p>

        {requireCameraForStart ? (
          <div className="relative mb-4 aspect-video overflow-hidden rounded-lg bg-black">
            <video ref={videoRef} autoPlay playsInline muted className="h-full w-full scale-x-[-1] object-cover" />
            {step === 'liveness' && !liveness.passed && liveness.instruction ? (
              <div className="absolute bottom-2 left-2 right-2 rounded bg-black/60 px-3 py-2 text-center text-xs text-white">
                {liveness.instruction}
              </div>
            ) : null}
            {step === 'liveness' && liveness.passed ? (
              <div className="absolute inset-0 flex items-center justify-center bg-green-500/30 backdrop-blur-sm">
                <div className="rounded-lg bg-green-600 px-4 py-2 text-center font-semibold text-white shadow-lg">
                  ✓ Liveness Verified
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 'consent' ? (
          <label className="mb-4 flex items-start gap-2 text-sm">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <span>I consent to identity verification, liveness checks, and session recording.</span>
          </label>
        ) : null}

        {deviceLockWarning ? (
          <div className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-600">
            <p>{deviceLockWarning}</p>
            <button
              type="button"
              className="mt-2 font-semibold underline"
              onClick={() => void bindCamera()}
            >
              Try again
            </button>
          </div>
        ) : null}

        {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            disabled={
              submitting ||
              (step === 'liveness' && !liveness.passed) ||
              ((step === 'liveness' || step === 'identity') && requireCameraForStart && !cameraReady)
            }
            onClick={() => void handleContinue()}
            className="flex items-center justify-center gap-2 rounded bg-blue-600 px-6 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Please wait...' : step === 'voice' ? 'Record voice & start' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  );
}
