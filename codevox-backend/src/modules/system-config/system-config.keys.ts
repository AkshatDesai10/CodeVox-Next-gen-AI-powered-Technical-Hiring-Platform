/**
 * Logical dashboard keys → env fallbacks.
 * Order matters: first non-empty process.env wins (matches existing dual-name usage).
 */
export type ConfigCategory =
  | 'portal_proctoring'
  | 'ai_models'
  | 'voice_audio'
  | 'api_keys';

export type ConfigValueType = 'string' | 'boolean' | 'number' | 'enum';

export type SystemConfigDef = {
  key: string;
  category: ConfigCategory;
  label: string;
  description: string;
  /** Env names to try in order when DB value is empty. */
  envFallbacks: string[];
  type: ConfigValueType;
  secret?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: string;
};

export const SYSTEM_CONFIG_DEFS: readonly SystemConfigDef[] = [
  {
    key: 'FACE',
    category: 'portal_proctoring',
    label: 'Face verification',
    description: 'Face photo capture (on) vs device readiness only (off).',
    envFallbacks: ['FACE', 'FACE_VERIFICATION'],
    type: 'enum',
    options: ['on', 'off'],
    defaultValue: 'on',
  },
  {
    key: 'PROCTOR_ENABLE_MEDIA_STRIKES',
    category: 'portal_proctoring',
    label: 'Enable media strikes',
    description: 'Count camera / mic / screen-share drops as integrity strikes.',
    envFallbacks: [
      'PROCTOR_ENABLE_MEDIA_STRIKES',
      'PROCTOR_ENABLE_STRIKES',
      'NEXT_PUBLIC_PROCTOR_ENABLE_MEDIA_STRIKES',
      'NEXT_PUBLIC_PROCTOR_ENABLE_STRIKES',
    ],
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'PROCTOR_MAX_MEDIA_STRIKES',
    category: 'portal_proctoring',
    label: 'Max media strikes',
    description: 'Media strikes allowed before auto-submit (when enabled).',
    envFallbacks: [
      'PROCTOR_MAX_MEDIA_STRIKES',
      'PROCTOR_MAX_STRIKES',
      'NEXT_PUBLIC_PROCTOR_MAX_MEDIA_STRIKES',
      'NEXT_PUBLIC_PROCTOR_MAX_STRIKES',
    ],
    type: 'number',
    min: 1,
    max: 10,
    defaultValue: '5',
  },
  {
    key: 'PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE',
    category: 'portal_proctoring',
    label: 'Auto-submit on media strikes',
    description: 'End the interview when media strike limit is reached.',
    envFallbacks: [
      'PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE',
      'PROCTOR_AUTO_SUBMIT_ON_STRIKE',
      'NEXT_PUBLIC_PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE',
      'NEXT_PUBLIC_PROCTOR_AUTO_SUBMIT_ON_STRIKE',
    ],
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'PROCTOR_ENABLE_FOCUS_STRIKES',
    category: 'portal_proctoring',
    label: 'Enable focus strikes',
    description: 'Count tab switches / leaving fullscreen as integrity strikes.',
    envFallbacks: [
      'PROCTOR_ENABLE_FOCUS_STRIKES',
      'PROCTOR_ENABLE_STRIKES',
      'NEXT_PUBLIC_PROCTOR_ENABLE_FOCUS_STRIKES',
      'NEXT_PUBLIC_PROCTOR_ENABLE_STRIKES',
    ],
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'PROCTOR_MAX_FOCUS_STRIKES',
    category: 'portal_proctoring',
    label: 'Max focus strikes',
    description: 'Focus strikes allowed before auto-submit (when enabled).',
    envFallbacks: ['PROCTOR_MAX_FOCUS_STRIKES', 'NEXT_PUBLIC_PROCTOR_MAX_FOCUS_STRIKES'],
    type: 'number',
    min: 1,
    max: 10,
    defaultValue: '5',
  },
  {
    key: 'PROCTOR_AUTO_SUBMIT_ON_FOCUS_STRIKE',
    category: 'portal_proctoring',
    label: 'Auto-submit on focus strikes',
    description: 'End the interview when focus strike limit is reached.',
    envFallbacks: [
      'PROCTOR_AUTO_SUBMIT_ON_FOCUS_STRIKE',
      'NEXT_PUBLIC_PROCTOR_AUTO_SUBMIT_ON_FOCUS_STRIKE',
    ],
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'PROCTOR_FOCUS_STRIKE_THRESHOLD_SECONDS',
    category: 'portal_proctoring',
    label: 'Focus strike threshold (seconds)',
    description: 'How long focus must be lost before one focus strike is counted.',
    envFallbacks: [
      'PROCTOR_FOCUS_STRIKE_THRESHOLD_SECONDS',
      'NEXT_PUBLIC_PROCTOR_FOCUS_STRIKE_THRESHOLD_SECONDS',
      'NEXT_PUBLIC_FOCUS_STRIKE_THRESHOLD_SECONDS',
    ],
    type: 'number',
    min: 1,
    max: 60,
    defaultValue: '5',
  },
  {
    key: 'PROCTOR_GRACE_SECONDS',
    category: 'portal_proctoring',
    label: 'Media grace period (seconds)',
    description: 'Time allowed to re-acquire camera/mic after an outage.',
    envFallbacks: ['PROCTOR_GRACE_SECONDS', 'NEXT_PUBLIC_PROCTOR_GRACE_SECONDS'],
    type: 'number',
    min: 30,
    max: 300,
    defaultValue: '90',
  },
  {
    key: 'LLM_PROVIDER',
    category: 'ai_models',
    label: 'LLM provider',
    description: 'Primary evaluation provider (maps to TAKEHOME_LLM_PROVIDER).',
    envFallbacks: ['TAKEHOME_LLM_PROVIDER', 'LLM_PROVIDER'],
    type: 'enum',
    options: ['gemini', 'sarvam', 'openai', 'claude'],
    defaultValue: 'gemini',
  },
  {
    key: 'GEMINI_MODEL',
    category: 'ai_models',
    label: 'Gemini / evaluation model',
    description: 'Model id for take-home / project evaluation (TAKEHOME_LLM_MODEL).',
    envFallbacks: ['TAKEHOME_LLM_MODEL', 'GEMINI_MODEL'],
    type: 'enum',
    options: [
      'gemini-3.8-flash',
      'gemini-3.7-flash',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-2.5-flash',
    ],
    defaultValue: 'gemini-3.8-flash',
  },
  {
    key: 'REASONING_EFFORT',
    category: 'ai_models',
    label: 'Reasoning effort',
    description: 'Gemini thinking level (TAKEHOME_LLM_REASONING_EFFORT).',
    envFallbacks: ['TAKEHOME_LLM_REASONING_EFFORT', 'REASONING_EFFORT'],
    type: 'enum',
    options: ['none', 'low', 'medium', 'high'],
    defaultValue: 'low',
  },
  {
    key: 'MAX_TOKENS',
    category: 'ai_models',
    label: 'Max output tokens',
    description: 'Max tokens for evaluation responses (TAKEHOME_LLM_MAX_TOKENS).',
    envFallbacks: ['TAKEHOME_LLM_MAX_TOKENS', 'MAX_TOKENS'],
    type: 'number',
    min: 1024,
    max: 65536,
    defaultValue: '65536',
  },
  {
    key: 'SARVAM_TTS_SPEAKER',
    category: 'voice_audio',
    label: 'Sarvam TTS speaker',
    description: 'AI interviewer voice persona.',
    envFallbacks: ['SARVAM_TTS_SPEAKER'],
    type: 'enum',
    options: ['shubh', 'meera', 'arvind'],
    defaultValue: 'shubh',
  },
  {
    key: 'SARVAM_TTS_PACE',
    category: 'voice_audio',
    label: 'Sarvam TTS pace',
    description: 'Speaking speed (0.70 – 1.30).',
    envFallbacks: ['SARVAM_TTS_PACE'],
    type: 'number',
    min: 0.7,
    max: 1.3,
    step: 0.01,
    defaultValue: '0.90',
  },
  {
    key: 'RECORDING_MODE',
    category: 'voice_audio',
    label: 'Voice recording mode',
    description: 'Voice-engine audio track recording (track | off). Separate from LIVEKIT_RECORDING_MODE.',
    envFallbacks: ['RECORDING_MODE'],
    type: 'enum',
    options: ['track', 'off'],
    defaultValue: 'track',
  },
  {
    key: 'GEMINI_API_KEY',
    category: 'api_keys',
    label: 'Gemini API key',
    description: 'Used as TAKEHOME_LLM_KEY / GEMINI_API_KEY for evaluations.',
    envFallbacks: ['TAKEHOME_LLM_KEY', 'GEMINI_API_KEY'],
    type: 'string',
    secret: true,
  },
  {
    key: 'SARVAM_API_KEY',
    category: 'api_keys',
    label: 'Sarvam API key',
    description: 'Sarvam STT / TTS / LLM key.',
    envFallbacks: ['SARVAM_API_KEY'],
    type: 'string',
    secret: true,
  },
  {
    key: 'OPENAI_API_KEY',
    category: 'api_keys',
    label: 'OpenAI / Groq API key',
    description: 'OpenAI-compatible API key (OPENAI_API_KEY).',
    envFallbacks: ['OPENAI_API_KEY'],
    type: 'string',
    secret: true,
  },
  {
    key: 'DEEPFLAG_API_KEY',
    category: 'api_keys',
    label: 'DeepFlag API key',
    description: 'AI text detection key.',
    envFallbacks: ['DEEPFLAG_API_KEY'],
    type: 'string',
    secret: true,
  },
] as const;

export const SYSTEM_CONFIG_KEY_SET = new Set(SYSTEM_CONFIG_DEFS.map((d) => d.key));

export function getConfigDef(key: string): SystemConfigDef | undefined {
  return SYSTEM_CONFIG_DEFS.find((d) => d.key === key);
}

export function maskSecret(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  if (v.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(16, Math.max(8, v.length - 4)))}${v.slice(-4)}`;
}

export function looksMasked(value: string): boolean {
  const v = value.trim();
  return v.length > 0 && /^[•*]+/.test(v) && !/[A-Za-z0-9_\-]{6,}/.test(v.replace(/[•*]/g, ''));
}

export function envFallbackValue(def: SystemConfigDef): string {
  for (const name of def.envFallbacks) {
    const raw = process.env[name];
    if (raw != null && String(raw).trim() !== '') return String(raw).trim();
  }
  return def.defaultValue ?? '';
}

export function parseBooleanConfig(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function isFaceEnabledValue(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  if (!v) return true;
  return v === 'on' || v === 'true' || v === '1' || v === 'yes';
}
