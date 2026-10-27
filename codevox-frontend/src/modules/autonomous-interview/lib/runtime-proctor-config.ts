import type { CandidateRuntimeConfig } from '@/modules/recruitment/lib/configurations-api';
import { getCandidateRuntimeConfig } from '@/modules/recruitment/lib/configurations-api';

let cached: CandidateRuntimeConfig | null = null;
let loading: Promise<CandidateRuntimeConfig | null> | null = null;

export function getCachedRuntimeProctorConfig(): CandidateRuntimeConfig | null {
  return cached;
}

export function applyRuntimeProctorConfig(config: CandidateRuntimeConfig) {
  cached = config;
}

/** Fetch once (or refresh) so media-recovery helpers use live dashboard values. */
export async function ensureRuntimeProctorConfig(force = false): Promise<CandidateRuntimeConfig | null> {
  if (cached && !force) return cached;
  if (loading && !force) return loading;
  loading = getCandidateRuntimeConfig()
    .then((cfg) => {
      cached = cfg;
      return cfg;
    })
    .catch(() => cached)
    .finally(() => {
      loading = null;
    });
  return loading;
}
