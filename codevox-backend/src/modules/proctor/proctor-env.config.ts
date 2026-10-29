/**
 * Server-side proctor strike configuration.
 * Prefer DynamicConfigService (DB → env → default) so System Configurations
 * apply to coding rounds and interviews alike.
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
  graceSeconds: number;
};

/** Sync reader matching DynamicConfigService.getSync(key, fallback). */
export type ProctorConfigReader = (key: string, fallback?: string) => string;

function readConfig(
  getSync: ProctorConfigReader | undefined,
  key: string,
  altKey?: string,
): string {
  if (getSync) {
    const primary = (getSync(key, '') ?? '').trim();
    if (primary) return primary;
    if (altKey) {
      const alt = (getSync(altKey, '') ?? '').trim();
      if (alt) return alt;
    }
  }
  return readEnv(key) || (altKey ? readEnv(altKey) : '');
}

/**
 * Resolve strike thresholds. Pass `dynamicConfig.getSync.bind(dynamicConfig)` so
 * dashboard overrides win over raw process.env.
 */
export function resolveProctorStrikeConfig(
  getSync?: ProctorConfigReader,
): ProctorStrikeConfig {
  const enableMedia = parseBool(
    readConfig(getSync, 'PROCTOR_ENABLE_MEDIA_STRIKES', 'PROCTOR_ENABLE_STRIKES'),
    false,
  );
  let maxMedia = parsePositiveInt(
    readConfig(getSync, 'PROCTOR_MAX_MEDIA_STRIKES', 'PROCTOR_MAX_STRIKES'),
    5,
  );
  if (maxMedia > 10) maxMedia = 10;
  const autoMedia = parseBool(
    readConfig(
      getSync,
      'PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE',
      'PROCTOR_AUTO_SUBMIT_ON_STRIKE',
    ),
    false,
  );
  const enableFocus = parseBool(
    readConfig(getSync, 'PROCTOR_ENABLE_FOCUS_STRIKES', 'PROCTOR_ENABLE_STRIKES'),
    false,
  );
  let maxFocus = parsePositiveInt(
    readConfig(getSync, 'PROCTOR_MAX_FOCUS_STRIKES'),
    5,
  );
  if (maxFocus > 10) maxFocus = 10;
  const autoFocus = parseBool(
    readConfig(getSync, 'PROCTOR_AUTO_SUBMIT_ON_FOCUS_STRIKE'),
    false,
  );
  let focusThreshold = parsePositiveInt(
    readConfig(getSync, 'PROCTOR_FOCUS_STRIKE_THRESHOLD_SECONDS'),
    5,
  );
  if (focusThreshold > 60) focusThreshold = 60;
  let graceSeconds = parsePositiveInt(readConfig(getSync, 'PROCTOR_GRACE_SECONDS'), 90);
  if (graceSeconds < 30 || graceSeconds > 300) graceSeconds = 90;

  return {
    enableMediaStrikes: enableMedia,
    maxMediaStrikes: maxMedia,
    autoSubmitOnMediaStrike: autoMedia,
    enableFocusStrikes: enableFocus,
    maxFocusStrikes: maxFocus,
    autoSubmitOnFocusStrike: autoFocus,
    focusStrikeThresholdSeconds: focusThreshold,
    graceSeconds,
  };
}

/** Env-only fallback (no DB). Prefer resolveProctorStrikeConfig(dynamic.getSync). */
export function getProctorStrikeConfig(): ProctorStrikeConfig {
  return resolveProctorStrikeConfig();
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
