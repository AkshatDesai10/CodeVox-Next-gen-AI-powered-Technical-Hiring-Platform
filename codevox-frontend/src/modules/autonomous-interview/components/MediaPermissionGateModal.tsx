'use client';

import { useEffect } from 'react';
import {
  formatGrace,
  getMaxMediaStrikes,
  isAutoSubmitOnStrikeEnabled,
  type MediaDeviceErrorKind,
  type MediaRecoveryState,
} from '@/modules/autonomous-interview/lib/media-recovery';

type Props = {
  recovery: MediaRecoveryState;
  graceSecondsLeft: number;
  requireCamera: boolean;
  requireMic: boolean;
  busy: boolean;
  onReacquire: () => void;
};

type VisibleState = 'prompt' | 'partial' | 'blocked' | 'hardware' | 'terminated';

function resolveVisibleState(
  recovery: MediaRecoveryState,
  requireCamera: boolean,
  requireMic: boolean,
): VisibleState {
  if (recovery.terminated) return 'terminated';

  const permissionDenied =
    recovery.isHardBlocked ||
    recovery.cameraError === 'permission' ||
    recovery.micError === 'permission';

  if (!recovery.attempted) {
    return permissionDenied ? 'blocked' : 'prompt';
  }

  const missingCount =
    (recovery.cameraMissing ? 1 : 0) + (requireMic && recovery.micMissing ? 1 : 0);
  const requiredCount = (requireCamera ? 1 : 0) + (requireMic ? 1 : 0);
  const oneLive = missingCount === 1 && requiredCount > 1;

  if (oneLive) return 'partial';
  if (permissionDenied) return 'blocked';
  return 'hardware';
}

function LockGuide({ requireMic, device }: { requireMic: boolean; device?: 'camera' | 'mic' }) {
  const target =
    device === 'camera'
      ? 'Camera'
      : device === 'mic'
        ? 'Microphone'
        : requireMic
          ? 'Camera and Microphone'
          : 'Camera';
  return (
    <ol className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-800">
      <li>
        <span className="font-semibold">1.</span> Click the <span className="font-semibold">Lock icon</span> (or
        Tune / Site Settings icon) on the left side of your browser address bar.
      </li>
      <li>
        <span className="font-semibold">2.</span> Switch <span className="font-semibold">{target}</span> to{' '}
        <span className="font-semibold">Allow</span>.
      </li>
      <li>
        <span className="font-semibold">3.</span> Click the button below to restart your devices.
      </li>
    </ol>
  );
}

function deviceAlert(kind: 'camera' | 'mic', error: MediaDeviceErrorKind | null, otherLive: string) {
  const name = kind === 'camera' ? 'Camera' : 'Microphone';
  const other = otherLive;
  if (error === 'permission') {
    return `${name} access is blocked in your browser settings. ${other} is connected.`;
  }
  if (error === 'unplugged') {
    return `${name} was not detected or is unplugged. ${other} is connected.`;
  }
  return `${name} is currently in use by another application. ${other} is connected.`;
}

export function MediaPermissionGateModal({
  recovery,
  graceSecondsLeft,
  requireCamera,
  requireMic,
  busy,
  onReacquire,
}: Props) {
  const open = recovery.required || recovery.terminated;
  const visible = resolveVisibleState(recovery, requireCamera, requireMic);
  const autoSubmit = isAutoSubmitOnStrikeEnabled();
  const warningCap = Math.max(1, getMaxMediaStrikes() - 1);
  const pastWarningCap = recovery.strike > warningCap;

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open]);

  if (!open) return null;

  const showFinalWarning = autoSubmit && recovery.strike === warningCap && visible !== 'terminated';
  const showTimer = visible !== 'terminated';
  const failedDevice: 'camera' | 'mic' | null = recovery.cameraMissing
    ? 'camera'
    : recovery.micMissing
      ? 'mic'
      : null;

  let title = 'Action Required: Media Access Interrupted';
  let description = requireMic
    ? 'Live camera and microphone are mandatory to maintain proctoring integrity. Your input is paused until access is restored.'
    : 'Live camera is mandatory to maintain proctoring integrity. Your input is paused until access is restored.';
  let buttonLabel = 'Allow & Resume Interview';
  let alert: string | null = null;
  let showLockGuide = false;
  let lockDevice: 'camera' | 'mic' | undefined;

  if (!autoSubmit && (graceSecondsLeft === 0 || pastWarningCap) && visible !== 'terminated') {
    title = 'Action Required: Camera Interrupted';
    description = 'Camera access is required to continue. Please restore access and click Retry.';
    buttonLabel = 'Retry Connection';
  } else if (visible === 'terminated') {
    title = 'Interview Session Closed & Flagged';
    description =
      'Required media access was not restored within the allowed limit. For fairness and proctoring compliance, this session has been locked and escalated to the recruitment team for manual review.';
    buttonLabel = '';
  } else if (visible === 'blocked') {
    title = 'Access Blocked in Browser Settings';
    description = '';
    buttonLabel = 'Check & Resume Interview';
    showLockGuide = true;
  } else if (visible === 'hardware') {
    title = 'Camera or Microphone Unavailable';
    description = '';
    buttonLabel = 'Retry Connection';
    const hardwareError = recovery.cameraError ?? recovery.micError;
    alert =
      hardwareError === 'unplugged'
        ? 'Your camera or microphone appears to be unplugged or disconnected. Please check your physical connection and click Retry.'
        : 'Your camera or microphone is currently in use by another application (such as Zoom, MS Teams, or another browser tab). Please close other applications and click Retry.';
  } else if (visible === 'partial' && failedDevice) {
    title = 'Action Required: Media Access Interrupted';
    description = '';
    const other = failedDevice === 'camera' ? 'Microphone' : 'Camera';
    const error = failedDevice === 'camera' ? recovery.cameraError : recovery.micError;
    alert = deviceAlert(failedDevice, error, other);
    buttonLabel = failedDevice === 'camera' ? 'Retry Camera & Resume' : 'Retry Microphone & Resume';
    if (error === 'permission') {
      showLockGuide = true;
      lockDevice = failedDevice;
    }
  }

  return (
    <div
      className="assessments-root fixed inset-0 z-[999] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-md"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-permission-title"
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-[var(--assessment-surface-container)] p-6 shadow-2xl"
      >
        {showFinalWarning ? (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-800 shadow-[0_0_16px_rgba(220,38,38,0.25)]">
            FINAL WARNING: Strike {warningCap} of {warningCap}
            <p className="mt-1 font-normal">
              Repeated media disconnection is logged as an integrity breach. The next disconnection will
              terminate your interview.
            </p>
          </div>
        ) : null}

        {visible !== 'terminated' && recovery.strike > 0 && recovery.strike < warningCap ? (
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Disconnection Warning: Strike {recovery.strike} of {warningCap}
          </p>
        ) : null}

        {visible !== 'terminated' && !autoSubmit && recovery.strike === warningCap ? (
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Disconnection Warning: Strike {recovery.strike} of {warningCap}
          </p>
        ) : null}

        {visible !== 'terminated' && pastWarningCap ? (
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-amber-800">
            Disconnection Warning: Strike {recovery.strike}
          </p>
        ) : null}

        {showTimer ? (
          <p className="mb-3 inline-flex rounded-full bg-amber-100 px-3 py-1 text-sm font-semibold text-amber-950">
            {formatGrace(graceSecondsLeft)} remaining to restore access
          </p>
        ) : null}

        <h2 id="media-permission-title" className="text-xl font-semibold text-slate-900">
          {title}
        </h2>

        {description ? (
          <p className="mt-3 text-sm leading-relaxed text-slate-600">{description}</p>
        ) : null}

        {alert ? (
          <p
            className={`mt-4 rounded-lg px-3 py-2 text-sm font-medium ${
              visible === 'hardware'
                ? 'border border-amber-300 bg-amber-50 text-amber-950'
                : 'border border-red-300 bg-red-50 text-red-800'
            }`}
          >
            {alert}
          </p>
        ) : null}

        {showLockGuide ? <LockGuide requireMic={requireMic} device={lockDevice} /> : null}

        {buttonLabel ? (
          <button
            type="button"
            onClick={onReacquire}
            disabled={busy}
            className="mt-5 w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white shadow-md transition-all hover:bg-blue-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <span className="flex items-center justify-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Checking access…
              </span>
            ) : (
              buttonLabel
            )}
          </button>
        ) : null}

        {visible === 'blocked' ? (
          <p className="mt-3 text-xs text-slate-500">
            No page reload required. After updating browser settings, click the button above to resume.
          </p>
        ) : null}
      </div>
    </div>
  );
}
