'use client';

export function ProfileHealthGauge(props: { score: number; label?: string }) {
  const pct = Math.min(100, Math.max(0, props.score));
  const circumference = 2 * Math.PI * 80;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="relative mx-auto flex h-48 w-48 items-center justify-center">
      <svg className="h-full w-full -rotate-90" viewBox="0 0 192 192">
        <circle cx="96" cy="96" r="80" fill="transparent" stroke="#f0f3ff" strokeWidth="12" />
        <circle
          cx="96"
          cy="96"
          r="80"
          fill="transparent"
          stroke="var(--assessment-primary-container)"
          strokeWidth="12"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute text-center">
        <span className="font-display-lg block text-[var(--assessment-primary)]">{pct}%</span>
        <span className="font-label-caps text-[var(--codevox-outline)]">
          {(props.label ?? 'HEALTH').toUpperCase()}
        </span>
      </div>
    </div>
  );
}
