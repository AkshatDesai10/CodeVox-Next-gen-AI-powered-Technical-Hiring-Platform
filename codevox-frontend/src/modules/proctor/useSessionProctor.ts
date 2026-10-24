'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  captureFaceDescriptor,
  compareDescriptors,
  estimateHeadPoseOffset,
  loadFaceModels,
} from '@/modules/proctor/face-models';
import type { ProctorEventInput } from '@/modules/proctor/types';

type FaceTelemetry = {
  lookingAway: boolean;
  multiFace: boolean;
};

type Options = {
  enabled: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  referenceDescriptor: number[] | null;
  faceMatchThreshold?: number;
  checkIntervalMs?: number;
  agentSpeaking?: boolean;
  micEnabled?: boolean;
  /** When true, skip extra_voice_suspected (e.g. recruiter speaking into candidate speakers). */
  suppressExtraVoice?: boolean;
  gazeThreshold?: number;
  onEvent: (event: ProctorEventInput) => void;
  onFaceTelemetry?: (state: FaceTelemetry) => void;
};

export function useSessionProctor({
  enabled,
  videoRef,
  referenceDescriptor,
  faceMatchThreshold = 0.55,
  checkIntervalMs = 3000,
  agentSpeaking = false,
  micEnabled = true,
  suppressExtraVoice = false,
  gazeThreshold = 0.22,
  onEvent,
  onFaceTelemetry,
}: Options) {
  const [facePresent, setFacePresent] = useState(true);
  const absentStreakRef = useRef(0);
  const loudMicStreakRef = useRef(0);
  const gazeStreakRef = useRef(0);
  const multiFaceCleanRef = useRef(0);
  const multiFaceLatchedRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const onFaceTelemetryRef = useRef(onFaceTelemetry);
  onFaceTelemetryRef.current = onFaceTelemetry;
  const suppressExtraVoiceRef = useRef(suppressExtraVoice);
  suppressExtraVoiceRef.current = suppressExtraVoice;

  useEffect(() => {
    if (!enabled) return;
    void loadFaceModels();
  }, [enabled]);

  const sampleFace = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;

    try {
      const result = await captureFaceDescriptor(video);
      if (!result) {
        absentStreakRef.current += 1;
        setFacePresent(false);
        gazeStreakRef.current = 0;
        if (absentStreakRef.current >= 3) {
          onEvent({
            type: 'face_absent',
            severity: 'warning',
            payload: { consecutive: absentStreakRef.current },
            client_ts: Date.now(),
          });
        }
        return;
      }

      absentStreakRef.current = 0;
      setFacePresent(true);

      let multiFace = false;
      if (result.faceCount > 1) {
        multiFace = true;
        multiFaceCleanRef.current = 0;
        if (!multiFaceLatchedRef.current) {
          multiFaceLatchedRef.current = true;
          onEvent({
            type: 'multi_face',
            severity: 'critical',
            payload: { face_count: result.faceCount },
            client_ts: Date.now(),
          });
        }
      } else {
        multiFaceCleanRef.current += 1;
        // ~30s of clean frames at default 3s interval before re-arming the alert.
        if (multiFaceCleanRef.current >= 10) {
          multiFaceLatchedRef.current = false;
        }
      }

      if (referenceDescriptor?.length === 128) {
        const { match, distance } = compareDescriptors(
          referenceDescriptor,
          result.descriptor,
          faceMatchThreshold,
        );
        if (!match) {
          onEvent({
            type: 'identity_mismatch',
            severity: 'critical',
            payload: { distance, threshold: faceMatchThreshold },
            client_ts: Date.now(),
          });
        }
      }

      const poseOffset = estimateHeadPoseOffset(
        result.nose,
        video.videoWidth,
        video.videoHeight,
      );
      let lookingAway = false;
      if (poseOffset != null && poseOffset > gazeThreshold) {
        gazeStreakRef.current += 1;
        lookingAway = true;
        if (gazeStreakRef.current >= 3) {
          onEvent({
            type: 'gaze_off_camera',
            severity: 'warning',
            payload: { pose_offset: Number(poseOffset.toFixed(3)) },
            client_ts: Date.now(),
          });
          gazeStreakRef.current = 0;
        }
      } else {
        gazeStreakRef.current = 0;
      }

      onFaceTelemetryRef.current?.({ lookingAway, multiFace });
    } catch {
      // ignore transient detection errors
    }
  }, [videoRef, referenceDescriptor, faceMatchThreshold, gazeThreshold, onEvent]);

  useEffect(() => {
    if (!enabled) return;
    void sampleFace();
    const id = setInterval(() => {
      void sampleFace();
    }, checkIntervalMs);
    return () => clearInterval(id);
  }, [enabled, checkIntervalMs, sampleFace]);

  useEffect(() => {
    if (!enabled || !micEnabled || agentSpeaking || suppressExtraVoice) {
      loudMicStreakRef.current = 0;
      return;
    }

    let stream: MediaStream | null = null;
    let raf = 0;

    const tick = () => {
      if (suppressExtraVoiceRef.current) {
        loudMicStreakRef.current = 0;
        raf = requestAnimationFrame(tick);
        return;
      }
      const analyser = analyserRef.current;
      if (analyser) {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        if (avg > 35 && !facePresent) {
          loudMicStreakRef.current += 1;
          if (loudMicStreakRef.current >= 6) {
            onEvent({
              type: 'extra_voice_suspected',
              severity: 'warning',
              payload: { avg_level: avg },
              client_ts: Date.now(),
            });
            loudMicStreakRef.current = 0;
          }
        } else {
          loudMicStreakRef.current = 0;
        }
      }
      raf = requestAnimationFrame(tick);
    };

    void navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
      stream = s;
      const ctx = new AudioContext();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(s);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
  }, [enabled, micEnabled, agentSpeaking, suppressExtraVoice, facePresent, onEvent]);

  return { facePresent };
}
