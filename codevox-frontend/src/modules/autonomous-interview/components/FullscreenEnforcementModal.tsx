'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

type Props = {
  open: boolean;
  secondsLeft: number | null;
  strikePendingAck: boolean;
  focusStrikeCount: number;
  maxFocusStrikes: number;
  onReturn: () => void;
};

export function FullscreenEnforcementModal({
  open,
  secondsLeft,
  strikePendingAck,
  focusStrikeCount,
  maxFocusStrikes,
  onReturn,
}: Props) {
  if (!open) return null;

  const inGrace = !strikePendingAck && secondsLeft != null && secondsLeft > 0;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fullscreen-enforcement-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${
              strikePendingAck ? 'bg-red-600' : 'bg-amber-500'
            }`}
          >
            <AssessmentMaterialIcon
              name={strikePendingAck ? 'gavel' : 'fullscreen_exit'}
              size={24}
            />
          </span>
          <div className="min-w-0 flex-1">
            <h2
              id="fullscreen-enforcement-title"
              className="text-lg font-bold text-slate-900"
            >
              {strikePendingAck
                ? `Focus strike ${focusStrikeCount} registered`
                : 'Return to the interview screen'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              {strikePendingAck
                ? `You were away from the interview window long enough to record a focus strike (${focusStrikeCount}/${maxFocusStrikes}). Click below to resume in fullscreen.`
                : 'Browser tab switched, window focus lost, or fullscreen exited. Return within the grace period to avoid a focus strike.'}
            </p>
            {inGrace ? (
              <p className="mt-3 font-mono text-3xl font-bold tabular-nums text-amber-700">
                {String(secondsLeft).padStart(2, '0')}s
              </p>
            ) : null}
            {strikePendingAck ? (
              <p className="mt-2 text-xs font-semibold text-red-700">
                Focus strikes: {focusStrikeCount} / {maxFocusStrikes}
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={onReturn}
          className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--assessment-primary,#1685FF)] px-4 py-3 text-sm font-bold text-white shadow-sm hover:opacity-95"
        >
          <AssessmentMaterialIcon name="fullscreen" size={18} />
          {strikePendingAck ? 'Resume in Fullscreen' : 'Return to Fullscreen'}
        </button>
      </div>
    </div>
  );
}
