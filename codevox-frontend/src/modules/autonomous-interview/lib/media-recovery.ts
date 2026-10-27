import { getCachedRuntimeProctorConfig } from '@/modules/autonomous-interview/lib/runtime-proctor-config';

export type MediaDeviceKind = 'camera' | 'mic';

export type MediaDeviceErrorKind = 'permission' | 'unplugged' | 'busy';

export type MediaOutageReason = 'permission_denied' | 'track_ended' | 'device_error';

export type MediaTerminationReason = 'grace_timeout' | 'max_strikes_exceeded';

export type MediaRecoveryState = {
  required: boolean;
  strike: number;
  cameraMissing: boolean;
  micMissing: boolean;
  isHardBlocked: boolean;
  /** True after the candidate clicks a restore button. */
  attempted: boolean;
  cameraError: MediaDeviceErrorKind | null;
  micError: MediaDeviceErrorKind | null;
  terminated: boolean;
  terminationReason: MediaTerminationReason | null;
};

export const GRACE_SECONDS = 90;
export const DEFAULT_MAX_MEDIA_STRIKES = 5;
export const DEFAULT_MAX_FOCUS_STRIKES = 5;
export const DEFAULT_FOCUS_THRESHOLD_SECONDS = 5;

function readPublicEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function parseBool(raw: string | undefined, fallback = false): boolean {
  if (!raw) return fallback;
  const s = raw.toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

/** Master switch: whether media strikes (camera/mic/screen drop) are enabled. */
export function isMediaStrikesEnabled(): boolean {
  const runtime = getCachedRuntimeProctorConfig();
  if (runtime) return runtime.enableMediaStrikes;
  return parseBool(
    readPublicEnv('NEXT_PUBLIC_PROCTOR_ENABLE_MEDIA_STRIKES') ??
      readPublicEnv('NEXT_PUBLIC_PROCTOR_ENABLE_STRIKES'),
    false,
  );
}

/** Master switch: whether focus strikes (tab switch/fullscreen exit) are enabled. */
export function isFocusStrikesEnabled(): boolean {
  const runtime = getCachedRuntimeProctorConfig();
  if (runtime) return runtime.enableFocusStrikes;
  return parseBool(
    readPublicEnv('NEXT_PUBLIC_PROCTOR_ENABLE_FOCUS_STRIKES') ??
      readPublicEnv('NEXT_PUBLIC_PROCTOR_ENABLE_STRIKES'),
    false,
  );
}

/** Media auto-submit (camera/mic/screen). Falls back to legacy AUTO_SUBMIT_ON_STRIKE. */
export function isAutoSubmitOnMediaStrikeEnabled(): boolean {
  const runtime = getCachedRuntimeProctorConfig();
  if (runtime) return runtime.autoSubmitOnMediaStrike;
  return parseBool(
    readPublicEnv('NEXT_PUBLIC_PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE') ||
      readPublicEnv('NEXT_PUBLIC_PROCTOR_AUTO_SUBMIT_ON_STRIKE'),
    false,
  );
}

/** @deprecated Prefer isAutoSubmitOnMediaStrikeEnabled */
export function isAutoSubmitOnStrikeEnabled(): boolean {
  return isAutoSubmitOnMediaStrikeEnabled();
}

export function isAutoSubmitOnFocusStrikeEnabled(): boolean {
  const runtime = getCachedRuntimeProctorConfig();
  if (runtime) return runtime.autoSubmitOnFocusStrike;
  return parseBool(readPublicEnv('NEXT_PUBLIC_PROCTOR_AUTO_SUBMIT_ON_FOCUS_STRIKE'), false);
}

/** Strikes required before media strict mode terminates. Warnings run through max - 1. */
export function getMaxMediaStrikes(): number {
  const runtime = getCachedRuntimeProctorConfig();
  if (runtime?.maxMediaStrikes != null && runtime.maxMediaStrikes >= 1) {
    return Math.floor(runtime.maxMediaStrikes);
  }
  return parsePositiveInt(
    readPublicEnv('NEXT_PUBLIC_PROCTOR_MAX_MEDIA_STRIKES') ||
      readPublicEnv('NEXT_PUBLIC_PROCTOR_MAX_STRIKES'),
    DEFAULT_MAX_MEDIA_STRIKES,
  );
}

export function getMaxFocusStrikes(): number {
  const runtime = getCachedRuntimeProctorConfig();
  if (runtime?.maxFocusStrikes != null && runtime.maxFocusStrikes >= 1) {
    return Math.floor(runtime.maxFocusStrikes);
  }
  return parsePositiveInt(
    readPublicEnv('NEXT_PUBLIC_PROCTOR_MAX_FOCUS_STRIKES'),
    DEFAULT_MAX_FOCUS_STRIKES,
  );
}

export function getFocusStrikeThresholdSeconds(): number {
  const runtime = getCachedRuntimeProctorConfig();
  if (
    runtime?.focusStrikeThresholdSeconds != null &&
    runtime.focusStrikeThresholdSeconds >= 1
  ) {
    return Math.floor(runtime.focusStrikeThresholdSeconds);
  }
  return parsePositiveInt(
    readPublicEnv('NEXT_PUBLIC_PROCTOR_FOCUS_STRIKE_THRESHOLD_SECONDS') ||
      readPublicEnv('NEXT_PUBLIC_FOCUS_STRIKE_THRESHOLD_SECONDS'),
    DEFAULT_FOCUS_THRESHOLD_SECONDS,
  );
}

export function getMediaGraceSeconds(): number {
  const runtime = getCachedRuntimeProctorConfig();
  if (runtime?.graceSeconds != null && runtime.graceSeconds >= 1) {
    return Math.floor(runtime.graceSeconds);
  }
  return parsePositiveInt(readPublicEnv('NEXT_PUBLIC_PROCTOR_GRACE_SECONDS'), GRACE_SECONDS);
}

export const INITIAL_MEDIA_RECOVERY: MediaRecoveryState = {
  required: false,
  strike: 0,
  cameraMissing: false,
  micMissing: false,
  isHardBlocked: false,
  attempted: false,
  cameraError: null,
  micError: null,
  terminated: false,
  terminationReason: null,
};

export function safeStopTrack(track: MediaStreamTrack | null, handler: () => void) {
  if (!track) return;
  track.removeEventListener('ended', handler);
  track.stop();
}

export function classifyMediaError(err: unknown): MediaDeviceErrorKind {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'permission';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'unplugged';
  }
  return 'busy';
}

export function formatGrace(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}
