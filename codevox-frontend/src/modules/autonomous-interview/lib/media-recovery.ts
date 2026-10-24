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

function readPublicEnv(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : undefined;
}

/** Strict lockout only when this is explicitly true. Missing or any other value stays in soft mode. */
export function isAutoSubmitOnStrikeEnabled(): boolean {
  return readPublicEnv('NEXT_PUBLIC_PROCTOR_AUTO_SUBMIT_ON_STRIKE') === 'true';
}

/** Strikes required before strict mode terminates. Warnings run through max - 1. */
export function getMaxMediaStrikes(): number {
  const parsed = Number(readPublicEnv('NEXT_PUBLIC_PROCTOR_MAX_STRIKES'));
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_MEDIA_STRIKES;
  return Math.floor(parsed);
}

export function getMediaGraceSeconds(): number {
  const parsed = Number(readPublicEnv('NEXT_PUBLIC_PROCTOR_GRACE_SECONDS'));
  if (!Number.isFinite(parsed) || parsed < 1) return GRACE_SECONDS;
  return Math.floor(parsed);
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
