'use client';

import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const SIZE_CLASS = {
  sm: 'max-w-[400px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[640px]',
  xl: 'max-w-4xl',
} as const;

export function AppModal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  size?: keyof typeof SIZE_CLASS;
  children: ReactNode;
  footer?: ReactNode;
  bodyClassName?: string;
  titleId?: string;
}) {
  const titleId = props.titleId ?? 'app-modal-title';

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onClose();
    };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [props.open, props.onClose]);

  if (!props.open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[250] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop separate from scrollport - avoids closing when scrolling/dragging on overlay */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-[1px]"
        aria-hidden
        onClick={props.onClose}
      />
      <div className="pointer-events-none relative z-10 flex min-h-full items-start justify-center px-4 py-8 sm:items-center sm:py-10">
        <div
          className={`pointer-events-auto w-full shrink-0 overflow-hidden rounded-xl bg-[var(--assessment-surface-container)] shadow-xl ring-1 ring-black/5 ${SIZE_CLASS[props.size ?? 'sm']}`}
        >
        <div className="app-modal-header">
          <div className="min-w-0 pr-2">
            <h2 id={titleId} className="text-sm font-bold text-slate-900">
              {props.title}
            </h2>
            {props.description ? (
              <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{props.description}</p>
            ) : null}
          </div>
          <button type="button" className="app-icon-btn shrink-0" onClick={props.onClose} aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className={props.bodyClassName ? props.bodyClassName : 'app-modal-body'}>
          {props.children}
        </div>
        {props.footer ? <div className="app-modal-footer">{props.footer}</div> : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AppModalFooterActions(props: {
  onCancel: () => void;
  onConfirm: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  confirmPending?: boolean;
  variant?: 'default' | 'danger';
}) {
  const confirmClass =
    props.variant === 'danger'
      ? 'rounded-md border-0 bg-rose-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60'
      : 'app-btn-primary';

  return (
    <>
      <button type="button" className="app-btn-outline" onClick={props.onCancel}>
        {props.cancelLabel ?? 'Cancel'}
      </button>
      <button
        type="button"
        className={confirmClass}
        disabled={props.confirmDisabled || props.confirmPending}
        onClick={props.onConfirm}
      >
        {props.confirmPending ? 'Please wait...' : (props.confirmLabel ?? 'Confirm')}
      </button>
    </>
  );
}
