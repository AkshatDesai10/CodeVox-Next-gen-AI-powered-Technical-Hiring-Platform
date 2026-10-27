/**
 * Canonical dashboard keys ↔ process.env aliases.
 * DB value wins when non-empty; otherwise first non-empty env alias, then default.
 */
export type ConfigMeta = {
  key: string;
  category: 'portal' | 'ai' | 'voice' | 'secrets';
  label: string;
  description: string;
  envAliases: string[];
  defaultValue: string;
  secret?: boolean;
  options?: string[];
  min?: number;
  max?: number;
  type: 'string' | 'boolean' | 'number' | 'enum';
};

export const SYSTEM_CONFIG_META: ConfigMeta[] = [
  {
    key: 'FACE',
    category: 'portal',
    label: 'Face verification',
    description: 'Face photo capture vs device-only readiness on the candidate portal.',
    envAliases: ['FACE', 'FACE_VERIFICATION'],
    defaultValue: 'on',
    type: 'enum',
    options: ['on', 'off'],
  },
  {
    key: 'PROCTOR_MAX_STRIKES',
    category: 'portal',
    label: 'Max proctor strikes',
    description: 'Maximum media/proctor strikes before termination.',
    envAliases: ['PROCTOR_MAX_STRIKES', 'NEXT_PUBLIC_PROCTOR_MAX_STRIKES'],
    defaultValue: '5',
    type: 'number',
    min: 1,
    max: 10,
  },
  {
    key: 'PROCTOR_AUTO_SUBMIT',
    category: 'portal',
    label: 'Auto-submit on max strike',
    description: 'Terminate / auto-submit the interview when max strikes are reached.',
    envAliases: ['PROCTOR_AUTO_SUBMIT_ON_STRIKE', 'NEXT_PUBLIC_PROCTOR_AUTO_SUBMIT_ON_STRIKE'],
    defaultValue: 'false',
    type: 'boolean',
  },
  {
    key: 'PROCTOR_GRACE_SECONDS',
    category: 'portal',
    label: 'Media grace period (seconds)',
    description: 'Time allowed to re-acquire camera/mic after an outage.',
    envAliases: ['PROCTOR_GRACE_SECONDS', 'NEXT_PUBLIC_PROCTOR_GRACE_SECONDS'],
    defaultValue: '90',
    type: 'number',
    min: 30,
    max: 300,
  },
  {
    key: 'LLM_PROVIDER',
    category: 'ai',
    label: 'Primary LLM provider',
    description: 'Preferred evaluation / generation provider.',
    envAliases: ['TAKEHOME_LLM_PROVIDER', 'RECRUITMENT_LLM_PROVIDER', 'LLM_PROVIDER'],
    defaultValue: 'gemini',
    type: 'enum',
    options: ['gemini', 'sarvam', 'openai'],
  },
  {
    key: 'GEMINI_MODEL',
    category: 'ai',
    label: 'Gemini model',
    description: 'Google Gemini model for evaluations and validation.',
    envAliases: ['TAKEHOME_LLM_MODEL', 'RECRUITMENT_GEMINI_MODEL', 'GEMINI_MODEL'],
    defaultValue: 'gemini-3.6-flash',
    type: 'enum',
    options: ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'],
  },
  {
    key: 'REASONING_EFFORT',
    category: 'ai',
    label: 'Reasoning effort',
    description: 'Gemini thinking / reasoning level.',
    envAliases: ['TAKEHOME_LLM_REASONING_EFFORT', 'RECRUITMENT_GEMINI_REASONING_EFFORT'],
    defaultValue: 'low',
    type: 'enum',
    options: ['none', 'low', 'medium', 'high'],
  },
  {
    key: 'MAX_TOKENS',
    category: 'ai',
    label: 'Max tokens',
    description: 'Maximum tokens for evaluation responses.',
    envAliases: ['TAKEHOME_LLM_MAX_TOKENS', 'OPENAI_MAX_TOKENS'],
    defaultValue: '16384',
    type: 'number',
    min: 256,
    max: 65536,
  },
  {
    key: 'SARVAM_TTS_SPEAKER',
    category: 'voice',
    label: 'Sarvam TTS speaker',
    description: 'AI interviewer voice persona.',
    envAliases: ['SARVAM_TTS_SPEAKER'],
    defaultValue: 'meera',
    type: 'enum',
    options: ['shubh', 'meera', 'arvind'],
  },
  {
    key: 'SARVAM_TTS_PACE',
    category: 'voice',
    label: 'Sarvam TTS pace',
    description: 'Speaking speed (0.70 – 1.30).',
    envAliases: ['SARVAM_TTS_PACE'],
    defaultValue: '0.90',
    type: 'number',
    min: 0.7,
    max: 1.3,
  },
  {
    key: 'RECORDING_MODE',
    category: 'voice',
    label: 'Recording mode',
    description: 'Audio track recording mode.',
    envAliases: ['RECORDING_MODE'],
    defaultValue: 'track',
    type: 'enum',
    options: ['track', 'off'],
  },
  {
    key: 'GEMINI_API_KEY',
    category: 'secrets',
    label: 'Gemini API key',
    description: 'Gemini / Google Generative Language API key.',
    envAliases: ['TAKEHOME_LLM_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
    defaultValue: '',
    type: 'string',
    secret: true,
  },
  {
    key: 'SARVAM_API_KEY',
    category: 'secrets',
    label: 'Sarvam API key',
    description: 'Sarvam TTS / STT API key.',
    envAliases: ['SARVAM_API_KEY'],
    defaultValue: '',
    type: 'string',
    secret: true,
  },
  {
    key: 'OPENAI_API_KEY',
    category: 'secrets',
    label: 'OpenAI / Groq API key',
    description: 'OpenAI-compatible API key used by shared LLM client.',
    envAliases: ['OPENAI_API_KEY'],
    defaultValue: '',
    type: 'string',
    secret: true,
  },
  {
    key: 'DEEPFLAG_API_KEY',
    category: 'secrets',
    label: 'DeepFlag API key',
    description: 'AI text detection API key.',
    envAliases: ['DEEPFLAG_API_KEY'],
    defaultValue: '',
    type: 'string',
    secret: true,
  },
];

export const SYSTEM_CONFIG_KEYS = SYSTEM_CONFIG_META.map((m) => m.key);

export function metaFor(key: string): ConfigMeta | undefined {
  return SYSTEM_CONFIG_META.find((m) => m.key === key);
}

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '••••';
  return `${'•'.repeat(Math.min(16, trimmed.length - 4))}${trimmed.slice(-4)}`;
}

export function looksMasked(value: string): boolean {
  return /•/.test(value);
}
