'use client';

type Props = {
  /** Elapsed mm:ss (or hh:mm:ss) shown next to REC. */
  elapsed: string;
  /** When false, badge is hidden. */
  active?: boolean;
  /** Compact style for dense headers. */
  compact?: boolean;
  className?: string;
};

export function InterviewRecBadge({
  elapsed,
  active = true,
  compact = false,
  className = '',
}: Props) {
  if (!active) return null;

  return (
    <div className={`interview-rec-badge ${compact ? 'is-compact' : ''} ${className}`}>
      <span className="interview-rec-dot" aria-hidden />
      <span className="interview-rec-label">REC</span>
      <span className="interview-rec-time">{elapsed}</span>
      {!compact ? (
        <span className="interview-rec-hint">Session is recorded for evaluation</span>
      ) : null}
    </div>
  );
}
