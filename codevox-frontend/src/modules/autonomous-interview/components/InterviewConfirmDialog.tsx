'use client';

import type { ReactNode } from 'react';

type Props = {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  /** Omit or pass null/empty to hide the cancel button (required actions). */
  cancelLabel?: string | null;
  destructive?: boolean;
  /** Shown in red under the message. Keeps the dialog open for a retry. */
  error?: string | null;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function InterviewConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  error = null,
  confirmDisabled = false,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;
  const showCancel = Boolean(cancelLabel);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="interview-confirm-title"
        className="w-full max-w-md rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-2xl"
      >
        <h2
          id="interview-confirm-title"
          className="text-lg font-semibold text-[var(--assessment-on-surface)]"
        >
          {title}
        </h2>
        <div className="mt-3 text-sm leading-relaxed text-[var(--assessment-on-surface-variant)]">
          {message}
        {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
        </div>
        <div className="mt-6 flex justify-end gap-3">
          {showCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-medium text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container)]"
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50 ${
              destructive
                ? 'bg-[var(--assessment-error)] hover:opacity-90'
                : 'bg-[var(--assessment-primary)] hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
