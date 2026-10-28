'use client';

import { use, useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

const HELLO_WORLD = `// Warmup sandbox — nothing is submitted to your assessment.
function greet(name) {
  return "Hello, " + name + "!";
}

console.log(greet("CodeVox"));
`;

const WARMUP_SECONDS = 120;

export default function CandidateWarmupPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [code, setCode] = useState(HELLO_WORLD);
  const [runOutput, setRunOutput] = useState<string | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(WARMUP_SECONDS);
  const [cameraOn, setCameraOn] = useState(false);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraOn(false);
  }, []);

  const startCamera = useCallback(async () => {
    setCameraError(null);
    try {
      stopCamera();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: true,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraOn(true);
    } catch (err) {
      setCameraError(
        err instanceof Error ? err.message : 'Could not access camera/microphone.',
      );
      setCameraOn(false);
    }
  }, [stopCamera]);

  useEffect(() => {
    void startCamera();
    return () => {
      stopCamera();
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount/unmount only
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setSecondsLeft((s) => (s <= 0 ? 0 : s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const startMicCheck = useCallback(async () => {
    setMicError(null);
    if (playbackUrl) {
      URL.revokeObjectURL(playbackUrl);
      setPlaybackUrl(null);
    }
    try {
      const stream =
        streamRef.current ??
        (await navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
      if (!streamRef.current) {
        streamRef.current = stream;
      }
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        setMicError('No microphone track available.');
        return;
      }
      const audioOnly = new MediaStream(audioTracks);
      chunksRef.current = [];
      const recorder = new MediaRecorder(audioOnly);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setPlaybackUrl(URL.createObjectURL(blob));
        setRecording(false);
      };
      recorder.start();
      setRecording(true);
      window.setTimeout(() => {
        if (recorder.state === 'recording') recorder.stop();
      }, 3000);
    } catch (err) {
      setMicError(err instanceof Error ? err.message : 'Microphone check failed.');
      setRecording(false);
    }
  }, [playbackUrl]);

  const stopMicCheck = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  }, []);

  const runHelloWorld = useCallback(() => {
    setRunError(null);
    setRunOutput(null);
    const logs: string[] = [];
    const fakeConsole = {
      log: (...args: unknown[]) => {
        logs.push(args.map((a) => String(a)).join(' '));
      },
    };
    try {
      // Local-only warmup — never sent to assessment APIs.
      // eslint-disable-next-line no-new-func
      const fn = new Function('console', code);
      fn(fakeConsole);
      setRunOutput(logs.join('\n') || '(ran with no console output)');
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    }
  }, [code]);

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0');
  const ss = String(secondsLeft % 60).padStart(2, '0');

  return (
    <div className="assessments-root min-h-screen bg-[var(--assessment-surface)] text-[var(--assessment-on-surface)]">
      <header className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-3 sm:px-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#34D399]">
            Optional 2-min warmup
          </p>
          <h1 className="text-lg font-bold tracking-tight">Practice sandbox</h1>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-[#1685FF]/40 bg-[#1685FF]/15 px-3 py-1 font-mono text-xs text-[#BAE6FD]">
            {mm}:{ss}
          </span>
          <Link
            href={`/candidate/portal/${encodeURIComponent(token)}`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#1685FF] px-3 py-2 text-xs font-bold text-white hover:bg-[#38BDF8]"
          >
            Back to portal
            <AssessmentMaterialIcon name="arrow_forward" size={14} />
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 p-4 sm:grid-cols-2 sm:p-6">
        <section className="space-y-4 rounded-2xl border border-[rgba(22,133,255,0.25)] bg-[#0B1930] p-4">
          <h2 className="text-sm font-bold text-[#BAE6FD]">Camera preview</h2>
          <div className="overflow-hidden rounded-xl border border-[#1685FF]/30 bg-black aspect-video">
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="h-full w-full scale-x-[-1] object-cover"
            />
          </div>
          {cameraError ? (
            <p className="text-xs text-red-300">{cameraError}</p>
          ) : (
            <p className="text-xs text-[#BAE6FD]">
              {cameraOn ? 'Camera live — this preview is not recorded for evaluation.' : 'Starting camera…'}
            </p>
          )}
          <button
            type="button"
            onClick={() => void startCamera()}
            className="rounded-lg border border-[#1685FF]/40 px-3 py-2 text-xs font-semibold text-[#BAE6FD] hover:bg-[#1685FF]/15"
          >
            Restart camera
          </button>

          <div className="border-t border-[rgba(22,133,255,0.2)] pt-4">
            <h2 className="mb-2 text-sm font-bold text-[#BAE6FD]">Mic check</h2>
            <p className="mb-3 text-xs text-[#BAE6FD]/80">
              Record ~3 seconds, then play it back. Audio stays on this device only.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={recording}
                onClick={() => void startMicCheck()}
                className="rounded-lg bg-[#34D399] px-3 py-2 text-xs font-bold text-[#050B18] disabled:opacity-50"
              >
                {recording ? 'Recording…' : 'Record sample'}
              </button>
              {recording ? (
                <button
                  type="button"
                  onClick={stopMicCheck}
                  className="rounded-lg border border-red-400/40 px-3 py-2 text-xs font-semibold text-red-300"
                >
                  Stop
                </button>
              ) : null}
            </div>
            {micError ? <p className="mt-2 text-xs text-red-300">{micError}</p> : null}
            {playbackUrl ? (
              <audio controls src={playbackUrl} className="mt-3 w-full" />
            ) : null}
          </div>
        </section>

        <section className="flex min-h-[420px] flex-col rounded-2xl border border-[rgba(22,133,255,0.25)] bg-[#0B1930] p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-[#BAE6FD]">Mini IDE (hello-world)</h2>
            <button
              type="button"
              onClick={runHelloWorld}
              className="inline-flex items-center gap-1 rounded-lg bg-[#1685FF] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#38BDF8]"
            >
              <AssessmentMaterialIcon name="play_arrow" size={14} />
              Run locally
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[#1685FF]/30">
            <MonacoEditor
              height="280px"
              language="javascript"
              theme="vs-dark"
              value={code}
              onChange={(v) => setCode(v ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 13,
                scrollBeyondLastLine: false,
              }}
            />
          </div>
          <div className="mt-3 rounded-xl border border-[rgba(22,133,255,0.2)] bg-[#050B18] p-3 font-mono text-xs">
            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#BAE6FD]">
              Output
            </p>
            {runError ? (
              <pre className="whitespace-pre-wrap text-red-300">{runError}</pre>
            ) : (
              <pre className="whitespace-pre-wrap text-[#34D399]">
                {runOutput ?? 'Click Run locally — nothing is submitted.'}
              </pre>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
