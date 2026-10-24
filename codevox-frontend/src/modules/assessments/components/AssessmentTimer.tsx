'use client';

import { useEffect, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

export function AssessmentTimer(props: {
  durationMinutes: number;
  startedAt: string | null;
  onExpire?: () => void;
  variant?: 'default' | 'header';
}) {
  const [remaining, setRemaining] = useState(props.durationMinutes * 60);

  useEffect(() => {
    if (!props.startedAt) return;
    const started = new Date(props.startedAt).getTime();
    const totalMs = props.durationMinutes * 60 * 1000;

    const tick = () => {
      const elapsed = Date.now() - started;
      const left = Math.max(0, Math.floor((totalMs - elapsed) / 1000));
      setRemaining(left);
      if (left === 0) props.onExpire?.();
    };

    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [props.durationMinutes, props.onExpire, props.startedAt]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const label = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  if (props.variant === 'header') {
    return (
      <div className="flex items-center gap-1 font-bold text-white">
        <AssessmentMaterialIcon name="timer" size={20} className="text-white" />
        <span className="text-xs font-bold tracking-wide">{label}</span>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-[var(--assessment-surface-container)] px-4 py-2 font-mono text-sm font-semibold text-[var(--assessment-primary)]">
      {label}
    </div>
  );
}
