import { SYSTEM_CONFIG_DEFS, type SystemConfigDef } from './system-config.keys';

/**
 * Custom display order:
 * In 'portal_proctoring', all toggles/switches appear grouped at the top,
 * followed by numeric thresholds and timers below.
 */
export const PORTAL_PROCTORING_ORDER: string[] = [
  // 1. Toggles (all on/off switches at the top)
  'FACE',
  'PROCTOR_ENABLE_MEDIA_STRIKES',
  'PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE',
  'PROCTOR_ENABLE_FOCUS_STRIKES',
  'PROCTOR_AUTO_SUBMIT_ON_FOCUS_STRIKE',

  // 2. Numbers / Thresholds / Timers below
  'PROCTOR_MAX_MEDIA_STRIKES',
  'PROCTOR_MAX_FOCUS_STRIKES',
  'PROCTOR_FOCUS_STRIKE_THRESHOLD_SECONDS',
  'PROCTOR_GRACE_SECONDS',
];

export function sortCategoryItems(
  category: string,
  items: SystemConfigDef[],
): SystemConfigDef[] {
  if (category === 'portal_proctoring') {
    const orderMap = new Map<string, number>();
    PORTAL_PROCTORING_ORDER.forEach((key, index) => orderMap.set(key, index));
    return [...items].sort((a, b) => {
      const idxA = orderMap.has(a.key) ? orderMap.get(a.key)! : 999;
      const idxB = orderMap.has(b.key) ? orderMap.get(b.key)! : 999;
      return idxA - idxB;
    });
  }
  return items;
}
