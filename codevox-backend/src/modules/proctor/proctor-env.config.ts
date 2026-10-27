/**
 * Server-side proctor strike configuration.
 * Backend is source of truth for auto-termination thresholds.
 */

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

function parsePositiveInt(raw: string, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function parseBool(raw: string, fallback = false): boolean {
  if (!raw) return fallback;
  const s = raw.toLowerCase().trim();
  return s === 'true' || s === '1' || s === 'yes' || s === 'on';
}

export type ProctorStrikeConfig = {
  enableMediaStrikes: boolean;
  maxMediaStrikes: number;
  autoSubmitOnMediaStrike: boolean;
  enableFocusStrikes: boolean;
  maxFocusStrikes: number;
  autoSubmitOnFocusStrike: boolean;
  focusStrikeThresholdSeconds: number;
};

export function getProctorStrikeConfig(): ProctorStrikeConfig {
  const enableMedia = parseBool(
    readEnv('PROCTOR_ENABLE_MEDIA_STRIKES') || readEnv('PROCTOR_ENABLE_STRIKES'),
    false,
  );
  const maxMedia = parsePositiveInt(
    readEnv('PROCTOR_MAX_MEDIA_STRIKES') || readEnv('PROCTOR_MAX_STRIKES'),
    5,
  );
  const autoMedia = parseBool(
    readEnv('PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE') ||
      readEnv('PROCTOR_AUTO_SUBMIT_ON_STRIKE'),
    false,
  );
  const enableFocus = parseBool(
    readEnv('PROCTOR_ENABLE_FOCUS_STRIKES') || readEnv('PROCTOR_ENABLE_STRIKES'),
    false,
  );
  const maxFocus = parsePositiveInt(readEnv('PROCTOR_MAX_FOCUS_STRIKES'), 5);
  const autoFocus = parseBool(readEnv('PROCTOR_AUTO_SUBMIT_ON_FOCUS_STRIKE'), false);
  const focusThreshold = parsePositiveInt(
    readEnv('PROCTOR_FOCUS_STRIKE_THRESHOLD_SECONDS'),
    5,
  );
  return {
    enableMediaStrikes: enableMedia,
    maxMediaStrikes: maxMedia,
    autoSubmitOnMediaStrike: autoMedia,
    enableFocusStrikes: enableFocus,
    maxFocusStrikes: maxFocus,
    autoSubmitOnFocusStrike: autoFocus,
    focusStrikeThresholdSeconds: focusThreshold,
  };
}

export const MEDIA_STRIKE_EVENT_TYPES = new Set([
  'media_permission_revoked',
  'media_permission_terminated',
  'screen_share_dropped',
  'camera_dropped',
  'mic_dropped',
]);

export const FOCUS_STRIKE_EVENT_TYPES = new Set([
  'focus_strike',
  'focus_strike_terminated',
  'fullscreen_exited_strike',
]);

export function isMediaStrikeEvent(type: string): boolean {
  return MEDIA_STRIKE_EVENT_TYPES.has(type);
}

export function isFocusStrikeEvent(type: string): boolean {
  return FOCUS_STRIKE_EVENT_TYPES.has(type);
}
