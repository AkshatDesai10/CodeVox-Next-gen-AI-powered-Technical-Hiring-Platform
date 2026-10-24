type RedisEnvSource =
  | NodeJS.ProcessEnv
  | { NODE_ENV?: string; REDIS_ENABLED?: string; get?: (key: string) => unknown };

function envValue(source: RedisEnvSource, key: string): string {
  if (typeof source.get === 'function') {
    const value = source.get(key);
    return value !== undefined && value !== null ? String(value).trim() : '';
  }
  const raw = (source as NodeJS.ProcessEnv)[key];
  return raw !== undefined && raw !== null ? String(raw).trim() : '';
}

function parseRedisEnabledFlag(flag: string): boolean | undefined {
  const v = flag.toLowerCase();
  if (v === 'true' || v === '1' || v === 'yes') {
    return true;
  }
  if (v === 'false' || v === '0' || v === 'no') {
    return false;
  }
  return undefined;
}

/**
 * BullMQ / Redis toggle.
 * - REDIS_ENABLED=false|0|no → off in any NODE_ENV
 * - REDIS_ENABLED=true|1|yes → on in any NODE_ENV
 * - unset: off in development/test, on otherwise
 */
export function isRedisEnabled(source: RedisEnvSource = process.env): boolean {
  const explicit = parseRedisEnabledFlag(envValue(source, 'REDIS_ENABLED'));
  if (explicit !== undefined) {
    return explicit;
  }

  const nodeEnv = (envValue(source, 'NODE_ENV') || 'development').toLowerCase();
  return nodeEnv !== 'development' && nodeEnv !== 'test';
}