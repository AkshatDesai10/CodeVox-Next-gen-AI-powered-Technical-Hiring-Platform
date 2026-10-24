'use client';

import { useCallback, useEffect, useRef } from 'react';
import { checkInterviewVoice } from '@/modules/autonomous-interview/lib/autonomous-interview-api';
import type { ProctorEventInput } from '@/modules/proctor/types';

const CHECK_INTERVAL_MS = 60_000;
const SAMPLE_MS = 3000;

async function sampleMicBase64(): Promise<string> {
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
  await new Promise((r) => setTimeout(r, SAMPLE_MS));
  recorder.stop();
  stream.getTracks().forEach((t) => t.stop());
  const blob = await done;
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function useVoiceConsistency(
  candidateToken: string,
  enabled: boolean,
  phase: string,
  onEvent: (event: ProctorEventInput) => void,
) {
  const runningRef = useRef(false);

  const check = useCallback(async () => {
    if (runningRef.current || !enabled) return;
    runningRef.current = true;
    try {
      const audioBase64 = await sampleMicBase64();
      const result = await checkInterviewVoice(candidateToken, {
        audio_base64: audioBase64,
        phase,
      });
      if (!result.match) {
        onEvent({
          type: 'voice_inconsistency',
          severity: 'critical',
          payload: { distance: result.distance, phase },
          client_ts: Date.now(),
        });
      }
    } catch {
      // non-fatal sampling error
    } finally {
      runningRef.current = false;
    }
  }, [candidateToken, enabled, onEvent, phase]);

  useEffect(() => {
    if (!enabled) return;
    void check();
    const id = setInterval(() => void check(), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [check, enabled]);
}
