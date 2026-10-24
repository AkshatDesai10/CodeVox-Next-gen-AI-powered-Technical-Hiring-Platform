'use client';

import { useEffect, useState } from 'react';

const EVAL_STEPS = [
  'Reading your repository…',
  'Checking the project files…',
  'Scoring your work against the assessment…',
  'Preparing your Defend interview…',
];

export function SubmissionEvaluationProgress(props: { target: string }) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setStep((current) => (current + 1) % EVAL_STEPS.length);
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-[var(--assessment-on-surface)]">{EVAL_STEPS[step]}</p>
      <div className="flex justify-center gap-1.5" aria-hidden>
        {EVAL_STEPS.map((label, index) => (
          <span
            key={label}
            className={`h-1.5 w-6 rounded-full ${index === step ? 'bg-[var(--assessment-primary)]' : 'bg-slate-200'}`}
          />
        ))}
      </div>
      <p className="text-sm text-[var(--assessment-on-surface-variant)]">
        Looking at <span className="font-mono text-xs">{props.target}</span>.
      </p>
      <p className="text-sm text-[var(--assessment-on-surface-variant)]">
        This usually takes less than 5 minutes. Sit back and relax.
      </p>
      <p className="text-sm font-bold text-[var(--assessment-on-surface)]">
        Keep this window open. Your Defend interview starts automatically when the review is finished.
      </p>
    </div>
  );
}
