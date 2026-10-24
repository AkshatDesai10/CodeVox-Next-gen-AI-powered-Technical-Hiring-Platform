type RbacEnvSource =
  | NodeJS.ProcessEnv
  | { RBAC_BYPASS?: string; get?: (key: string) => unknown };

function envValue(source: RbacEnvSource, key: string): string {
  if (typeof source.get === 'function') {
    const value = source.get(key);
    return value !== undefined && value !== null ? String(value).trim() : '';
  }
  const raw = (source as NodeJS.ProcessEnv)[key];
  return raw !== undefined && raw !== null ? String(raw).trim() : '';
}

/** When true, all RBAC permission checks pass (JWT auth still required on protected routes). */
export function isRbacBypassEnabled(source: RbacEnvSource = process.env): boolean {
  const flag = envValue(source, 'RBAC_BYPASS').toLowerCase();
  return flag === 'true' || flag === '1' || flag === 'yes';
}
