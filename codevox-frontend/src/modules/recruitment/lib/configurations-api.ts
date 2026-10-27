import { clientApiGet, clientApiPut } from '@/lib/client-api';
import { recruitmentApiBase } from '@/lib/recruitment-api-base';

type Envelope<T> = { success: boolean; message: string; data: T };

function unwrap<T>(promise: Promise<Envelope<T>>): Promise<T> {
  return promise.then((response) => {
    if (!response.success) throw new Error(response.message || 'Request failed');
    return response.data;
  });
}

export type ConfigCategory =
  | 'portal_proctoring'
  | 'ai_models'
  | 'voice_audio'
  | 'api_keys';

export type SystemConfigItem = {
  key: string;
  category: ConfigCategory;
  label: string;
  description: string;
  type: 'string' | 'boolean' | 'number' | 'enum';
  secret: boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  value: string;
  source: 'db' | 'env' | 'default';
  hasDbValue: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type CandidateRuntimeConfig = {
  face: 'on' | 'off';
  graceSeconds: number;
  enableMediaStrikes: boolean;
  maxMediaStrikes: number;
  autoSubmitOnMediaStrike: boolean;
  enableFocusStrikes: boolean;
  maxFocusStrikes: number;
  autoSubmitOnFocusStrike: boolean;
  focusStrikeThresholdSeconds: number;
  /** @deprecated Prefer maxMediaStrikes */
  maxStrikes?: number;
  /** @deprecated Prefer autoSubmitOnMediaStrike */
  autoSubmitOnStrike?: boolean;
};

export type ConfigChangeLogItem = {
  id: string;
  key: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  createdAt: string;
};

export async function getSystemConfigurations(): Promise<SystemConfigItem[]> {
  return unwrap(clientApiGet<Envelope<SystemConfigItem[]>>('/api/recruitment/configurations'));
}

export async function saveSystemConfigurations(
  values: Record<string, string | null>,
): Promise<SystemConfigItem[]> {
  return unwrap(
    clientApiPut<Envelope<SystemConfigItem[]>>('/api/recruitment/configurations', { values }),
  );
}

export async function getConfigurationChangeLogs(): Promise<ConfigChangeLogItem[]> {
  return unwrap(
    clientApiGet<Envelope<ConfigChangeLogItem[]>>('/api/recruitment/configurations/logs'),
  );
}

/** Public — no JWT. Used by candidate portal / interview for live FACE + strike flags. */
export async function getCandidateRuntimeConfig(): Promise<CandidateRuntimeConfig> {
  const res = await fetch(`${recruitmentApiBase()}/api/candidate/portal/runtime-config`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || 'Failed to load runtime config');
  }
  const json = (await res.json()) as Envelope<CandidateRuntimeConfig>;
  if (!json.success || !json.data) throw new Error(json.message || 'Failed to load runtime config');
  return json.data;
}
