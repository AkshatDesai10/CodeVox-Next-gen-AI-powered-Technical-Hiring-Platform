'use client';

import type { ReactNode } from 'react';

type Props = {
  skill: string;
  variant: 'verified' | 'skipped' | 'unassessed';
  turns: number;
  strikes: number;
  footer?: ReactNode;
};

const variantStyles = {
  verified: 'border-emerald-200 bg-emerald-50/80',
  skipped: 'border-rose-200 bg-rose-50/80',
  unassessed: 'border-slate-200 bg-slate-50/80 opacity-90',
};

export function SkillAlignmentCard({ skill, variant, turns, strikes, footer }: Props) {
  return (
    <div
      className={`flex min-h-[8rem] flex-col justify-between rounded-xl border p-4 transition-shadow hover:shadow-md ${variantStyles[variant]}`}
    >
      <div>
        <span className="text-xs font-bold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
          {skill}
        </span>
      </div>
      <div className="mt-3 space-y-2">
        <div className="flex gap-3 text-xs text-[var(--assessment-on-surface-variant)]">
          <span>
            <strong className="text-[var(--assessment-on-surface)]">{turns}</strong> turns
          </span>
          <span>
            <strong className="text-[var(--assessment-on-surface)]">{strikes}</strong> strikes
          </span>
        </div>
        {footer}
      </div>
    </div>
  );
}
