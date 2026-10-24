'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { captureFaceDescriptor, loadFaceModels } from '@/modules/proctor/face-models';

export type LivenessStep = 'blink' | 'turn_left' | 'turn_right' | 'nod';

const STEP_INSTRUCTIONS: Record<LivenessStep, string> = {
  blink: 'Blink twice naturally',
  turn_left: 'Turn your head slowly to the left',
  turn_right: 'Turn your head slowly to the right',
  nod: 'Nod your head once',
};

function randomSteps(): LivenessStep[] {
  const pool: LivenessStep[] = ['blink', 'turn_left', 'turn_right', 'nod'];
  const picked: LivenessStep[] = [];
  while (picked.length < 2 && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  return picked;
}

function landmarkMotionScore(
  prev: { x: number; y: number }[] | undefined,
  next: { x: number; y: number }[] | undefined,
): number {
  if (!prev?.length || !next?.length) return 0;
  const n = Math.min(prev.length, next.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = prev[i].x - next[i].x;
    const dy = prev[i].y - next[i].y;
    sum += Math.sqrt(dx * dx + dy * dy);
  }
  return sum / n;
}

export function useLivenessChallenge(videoRef: React.RefObject<HTMLVideoElement | null>) {
  const [steps, setSteps] = useState<LivenessStep[]>([]);
  const [stepIndex, setStepIndex] = useState(0);
  const [motionScore, setMotionScore] = useState(0);
  const [completedSteps, setCompletedSteps] = useState<LivenessStep[]>([]);
  const prevLandmarksRef = useRef<{ x: number; y: number }[] | undefined>(undefined);
  const [staticStreak, setStaticStreak] = useState(0);
  const [passed, setPassed] = useState(false);

  const start = useCallback(() => {
    setSteps(randomSteps());
    setStepIndex(0);
    setMotionScore(0);
    setCompletedSteps([]);
    prevLandmarksRef.current = undefined;
    setStaticStreak(0);
    setPassed(false);
    void loadFaceModels();
  }, []);

  // Update passed state based on completion
  useEffect(() => {
    if (
      steps.length > 0 &&
      completedSteps.length >= steps.length &&
      motionScore > 8
    ) {
      setPassed(true);
    }
  }, [completedSteps.length, steps.length, motionScore]);

  useEffect(() => {
    if (!steps.length || passed) return;
    const video = videoRef.current;
    if (!video) return;

    const id = setInterval(() => {
      void (async () => {
        const result = await captureFaceDescriptor(video);
        if (!result?.landmarks?.length) return;

        const motion = landmarkMotionScore(prevLandmarksRef.current, result.landmarks);
        prevLandmarksRef.current = result.landmarks;
        
        setMotionScore((prev) => prev + motion);

        if (motion < 1.0) {
          setStaticStreak((prev) => prev + 1);
        } else {
          setStaticStreak(0);
          // Reduced threshold for more forgiving motion detection
          if (motion > 2.0) {
            setCompletedSteps((prev) => {
              // Read current step using stepIndex from the outer scope is safe enough if we depend on it,
              // but safer to derive from prev.length:
              const currentIndex = prev.length;
              const current = steps[currentIndex];
              if (current && !prev.includes(current)) {
                return [...prev, current];
              }
              return prev;
            });
          }
        }
      })();
    }, 250); // increased polling rate

    return () => clearInterval(id);
  }, [steps, videoRef, passed]);

  // Derive stepIndex from completedSteps.length
  useEffect(() => {
    if (completedSteps.length < steps.length) {
      setStepIndex(completedSteps.length);
    }
  }, [completedSteps.length, steps.length]);

  const currentStep = steps[stepIndex] ?? null;
  const instruction = currentStep ? STEP_INSTRUCTIONS[currentStep] : null;

  return {
    start,
    steps,
    currentStep,
    instruction,
    motionScore,
    completedSteps,
    passed,
    challengeId: steps.join('-') || 'liveness',
  };
}
