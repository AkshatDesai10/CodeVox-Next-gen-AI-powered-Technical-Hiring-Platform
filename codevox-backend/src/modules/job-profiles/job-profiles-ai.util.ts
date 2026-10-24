import { createHash } from 'crypto';

export function jdTextFingerprint(profile: {
  title?: string;
  responsibilities?: string[];
  required_skills?: string[];
  nice_to_have_skills?: string[];
  seniority_level?: string | null;
  location_text?: string | null;
  language_required?: string | null;
  experience_min?: string | number | null;
  experience_max?: string | number | null;
}): string {
  const blob = [
    profile.title ?? '',
    ...(profile.responsibilities ?? []),
    ...(profile.required_skills ?? []),
    ...(profile.nice_to_have_skills ?? []),
    profile.seniority_level ?? '',
    profile.location_text ?? '',
    profile.language_required ?? '',
    String(profile.experience_min ?? ''),
    String(profile.experience_max ?? ''),
  ]
    .join(' ')
    .toLowerCase();
  return createHash('sha256').update(blob).digest('hex').slice(0, 32);
}

/** Lightweight bag-of-words embedding for duplicate similarity (no external API). */
export function embedJdText(text: string): number[] {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const vec = new Array(64).fill(0);
  for (const w of words) {
    const h = createHash('md5').update(w).digest();
    const idx = h[0]! % 64;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  for (let i = 0; i < len; i += 1) dot += (a[i] ?? 0) * (b[i] ?? 0);
  return dot;
}

export type AiHealthInputs = {
  profileStatus: string;
  rubricComplete: boolean;
  stageCount: number;
  applicationCount: number;
  biasCritical: boolean;
  funnelConversion: number;
  questionCount: number;
};

export function computeAiHealthScore(input: AiHealthInputs): number {
  let score = 0;
  if (input.profileStatus === 'active') score += 20;
  if (input.rubricComplete) score += 20;
  if (input.stageCount >= 2) score += 15;
  if (input.applicationCount > 0) score += 15;
  if (!input.biasCritical) score += 15;
  score += Math.min(15, Math.round(input.funnelConversion * 15));
  if (input.questionCount >= 3) score += 10;
  return Math.min(100, score);
}

export const SENIORITY_RUBRIC_WEIGHTS: Record<string, Record<string, number>> = {
  junior: { hard: 45, soft: 25, leadership: 10, domain: 20 },
  mid: { hard: 40, soft: 25, leadership: 15, domain: 20 },
  senior: { hard: 35, soft: 20, leadership: 25, domain: 20 },
  lead: { hard: 30, soft: 20, leadership: 30, domain: 20 },
  principal: { hard: 25, soft: 15, leadership: 35, domain: 25 },
};
