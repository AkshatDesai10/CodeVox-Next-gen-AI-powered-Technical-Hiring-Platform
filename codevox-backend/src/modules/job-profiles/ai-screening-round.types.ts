/**
 * AI Screening round_config — shared shape with frontend ai-screening-round.types.ts
 */

export type AiScreeningTopicId =
  | 'professional_background'
  | 'education_background'
  | 'previous_employment'
  | 'reason_for_leaving'
  | 'career_motivation'
  | 'compensation'
  | 'notice_period_availability'
  | 'work_location_work_mode'
  | 'work_authorization'
  | 'career_goals'
  | 'behavioral_situational'
  | 'leadership_ownership'
  | 'strengths_development'
  | 'future_expectations'
  | 'personal_family_background';

export type AiScreeningTopicConfig = {
  id: AiScreeningTopicId | string;
  label: string;
  enabled: boolean;
};

export type AiScreeningRequirement = {
  id: string;
  question: string;
  expectedAnswer: string;
  predefined?: boolean;
  topicId?: string;
};

export type AiScreeningRoundConfig = {
  maxQuestions: number;
  maxTimeMinutes: number;
  topics: AiScreeningTopicConfig[];
  screeningRequirements: AiScreeningRequirement[];
};

export const AI_SCREENING_TOPIC_CATALOG: Array<{
  id: AiScreeningTopicId;
  label: string;
  defaultEnabled: boolean;
}> = [
  { id: 'professional_background', label: 'Professional Background', defaultEnabled: true },
  { id: 'education_background', label: 'Education Background', defaultEnabled: true },
  { id: 'previous_employment', label: 'Previous Employment', defaultEnabled: false },
  { id: 'reason_for_leaving', label: 'Reason for Leaving', defaultEnabled: true },
  { id: 'career_motivation', label: 'Career Motivation', defaultEnabled: true },
  { id: 'behavioral_situational', label: 'Behavioral / Situational', defaultEnabled: false },
  { id: 'leadership_ownership', label: 'Leadership / Ownership', defaultEnabled: false },
  { id: 'strengths_development', label: 'Strengths & Development', defaultEnabled: false },
  { id: 'career_goals', label: 'Career Goals', defaultEnabled: false },
  { id: 'future_expectations', label: 'Future Expectations', defaultEnabled: false },
  { id: 'work_location_work_mode', label: 'Work Location & Work Mode', defaultEnabled: true },
  { id: 'notice_period_availability', label: 'Notice Period & Availability', defaultEnabled: true },
  { id: 'compensation', label: 'Compensation', defaultEnabled: true },
  { id: 'work_authorization', label: 'Work Authorization', defaultEnabled: false },
  { id: 'personal_family_background', label: 'Personal / Family Background', defaultEnabled: false },
];

export const AI_SCREENING_REQUIREMENT_TOPICS: Record<string, AiScreeningTopicId> = {
  highest_education: 'education_background',
  work_location_mode: 'work_location_work_mode',
  relocate_if_required: 'work_location_work_mode',
  notice_period: 'notice_period_availability',
  expected_compensation: 'compensation',
};

export const AI_SCREENING_PREDEFINED_REQUIREMENTS: Array<{ id: string; question: string }> = [
  { id: 'expected_compensation', question: 'What is your expected compensation?' },
  { id: 'highest_education', question: 'What is your highest level of education?' },
  { id: 'notice_period', question: 'How soon can you join?' },
  {
    id: 'work_location_mode',
    question: 'What work mode/location are you comfortable with?',
  },
  {
    id: 'relocate_if_required',
    question: 'Are you open to relocation if required?',
  },
];

function normalizeRequirements(raw: unknown, legacyTopics: unknown): AiScreeningRequirement[] {
  const base = AI_SCREENING_PREDEFINED_REQUIREMENTS.map((r) => ({
    id: r.id,
    question: r.question,
    expectedAnswer: '',
    predefined: true as const,
    topicId: AI_SCREENING_REQUIREMENT_TOPICS[r.id],
  }));
  const byId = new Map(base.map((r) => [r.id, { ...r }]));
  const customs: AiScreeningRequirement[] = [];

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Record<string, unknown>;
      const id = typeof t.id === 'string' ? t.id : '';
      const question = typeof t.question === 'string' ? t.question : '';
      const expectedAnswer =
        typeof t.expectedAnswer === 'string'
          ? t.expectedAnswer
          : typeof t.expected_answer === 'string'
            ? t.expected_answer
            : typeof t.requirement === 'string'
              ? t.requirement
              : '';
      if (!id && !question) continue;
      if (byId.has(id)) {
        const prev = byId.get(id)!;
        byId.set(id, {
          ...prev,
          question: question || prev.question,
          expectedAnswer,
          predefined: true,
          topicId: prev.topicId,
        });
      } else {
        customs.push({
          id: id || `custom_${customs.length + 1}`,
          question,
          expectedAnswer,
          predefined: false,
        });
      }
    }
  } else if (Array.isArray(legacyTopics)) {
    const legacyMap: Record<string, string> = {
      compensation: 'expected_compensation',
      education_background: 'highest_education',
      notice_period_availability: 'notice_period',
      work_location_work_mode: 'work_location_mode',
    };
    for (const item of legacyTopics) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Record<string, unknown>;
      const tid = typeof t.id === 'string' ? t.id : '';
      const req = typeof t.requirement === 'string' ? t.requirement.trim() : '';
      if (!req) continue;
      const mapped = legacyMap[tid];
      if (mapped && byId.has(mapped)) {
        byId.set(mapped, { ...byId.get(mapped)!, expectedAnswer: req });
      } else {
        customs.push({
          id: `legacy_${tid || customs.length + 1}`,
          question: typeof t.label === 'string' ? String(t.label) : tid,
          expectedAnswer: req,
          predefined: false,
        });
      }
    }
  }

  return [...byId.values(), ...customs];
}

export function defaultAiScreeningRoundConfig(): AiScreeningRoundConfig {
  return {
    maxQuestions: 10,
    maxTimeMinutes: 15,
    topics: AI_SCREENING_TOPIC_CATALOG.map((t) => ({
      id: t.id,
      label: t.label,
      enabled: t.defaultEnabled,
    })),
    screeningRequirements: AI_SCREENING_PREDEFINED_REQUIREMENTS.map((r) => ({
      id: r.id,
      question: r.question,
      expectedAnswer: '',
      predefined: true,
      topicId: AI_SCREENING_REQUIREMENT_TOPICS[r.id],
    })),
  };
}

export function normalizeAiScreeningRoundConfig(raw: unknown): AiScreeningRoundConfig {
  const base = defaultAiScreeningRoundConfig();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const maxQuestions =
    typeof r.maxQuestions === 'number' && r.maxQuestions > 0
      ? Math.floor(r.maxQuestions)
      : base.maxQuestions;
  const maxTimeMinutes =
    typeof r.maxTimeMinutes === 'number' && r.maxTimeMinutes > 0
      ? Math.floor(r.maxTimeMinutes)
      : base.maxTimeMinutes;

  const byId = new Map<string, { enabled?: boolean; label?: string }>();
  if (Array.isArray(r.topics)) {
    for (const item of r.topics) {
      if (!item || typeof item !== 'object') continue;
      const t = item as Record<string, unknown>;
      if (typeof t.id !== 'string') continue;
      byId.set(t.id, {
        enabled: typeof t.enabled === 'boolean' ? t.enabled : undefined,
        label: typeof t.label === 'string' ? t.label : undefined,
      });
    }
  }

  return {
    maxQuestions,
    maxTimeMinutes,
    topics: AI_SCREENING_TOPIC_CATALOG.map((cat) => {
      const prev = byId.get(cat.id);
      return {
        id: cat.id,
        label: prev?.label ?? cat.label,
        enabled: prev?.enabled ?? cat.defaultEnabled,
      };
    }),
    screeningRequirements: normalizeRequirements(
      r.screeningRequirements ?? r.screening_requirements,
      r.topics,
    ),
  };
}

export function configuredAiScreeningRequirements(
  config: AiScreeningRoundConfig,
): AiScreeningRequirement[] {
  return config.screeningRequirements.filter((r) => (r.expectedAnswer || '').trim().length > 0);
}

export function validateAiScreeningStages(
  stages: Array<{ stageType: string; sortOrder: number; roundConfig?: unknown }>,
): string | null {
  const screening = stages.filter((s) => s.stageType === 'ai_screening');
  const merged = stages.filter((s) => {
    if (s.stageType !== 'ai_verbal') return false;
    const cfg = (s.roundConfig ?? {}) as Record<string, unknown>;
    return Boolean(cfg.merge_screening_verbal);
  });
  if (screening.length > 1) {
    return 'Only one AI Screening stage is allowed.';
  }
  if (screening.length > 0 && merged.length > 0) {
    return 'Use either a separate AI Screening stage or merged screening inside voice — not both.';
  }
  const target = screening[0] ?? merged[0];
  if (!target) return null;
  const cfg = normalizeAiScreeningRoundConfig(target.roundConfig);
  if (!cfg.topics.some((t) => t.enabled)) {
    return 'AI Screening requires at least one enabled topic.';
  }
  return null;
}
