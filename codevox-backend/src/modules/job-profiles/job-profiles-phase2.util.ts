export type StageSkipRules = {
  min_experience_years?: number;
  max_experience_years?: number;
  required_skills_any?: string[];
  min_voice_score?: number;
};

export function evaluateStageSkipRules(
  rules: StageSkipRules | null | undefined,
  ctx: {
    experienceYears?: number | null;
    skills?: string[];
    voiceScore?: number | null;
  },
): boolean {
  if (!rules || Object.keys(rules).length === 0) return false;

  if (rules.min_experience_years != null) {
    const exp = ctx.experienceYears ?? 0;
    if (exp < rules.min_experience_years) return false;
  }
  if (rules.max_experience_years != null) {
    const exp = ctx.experienceYears ?? 0;
    if (exp > rules.max_experience_years) return false;
  }
  if (rules.required_skills_any?.length) {
    const skills = new Set((ctx.skills ?? []).map((s) => s.toLowerCase()));
    const hasAny = rules.required_skills_any.some((s) => skills.has(s.toLowerCase()));
    if (!hasAny) return false;
  }
  if (rules.min_voice_score != null) {
    const score = ctx.voiceScore ?? 0;
    if (score < rules.min_voice_score) return false;
  }

  return true;
}

export type ComplianceConfig = {
  approval_required?: boolean;
  disclosure_text?: string;
  retention_days?: number;
  gdpr_region?: string;
};

export type NotificationConfig = {
  stall_days_threshold?: number;
  notify_owner?: boolean;
  notify_hiring_manager?: boolean;
};

export type ThresholdConfig = {
  auto_advance_min_score?: number;
  auto_reject_max_score?: number;
  require_human_review?: boolean;
};

export type ProgressionMode = 'sequential' | 'elimination';

export type ProgressionConfig = {
  mode?: ProgressionMode;
  elimination_threshold?: number;
};

export const DEFAULT_PROGRESSION_CONFIG: Required<ProgressionConfig> = {
  mode: 'sequential',
  elimination_threshold: 50,
};

export function parseProgressionConfig(
  raw: Record<string, unknown> | null | undefined,
): Required<ProgressionConfig> {
  const mode = raw?.mode === 'elimination' ? 'elimination' : 'sequential';
  const thresholdRaw = Number(raw?.elimination_threshold);
  const elimination_threshold = Number.isFinite(thresholdRaw)
    ? Math.max(0, Math.min(100, thresholdRaw))
    : DEFAULT_PROGRESSION_CONFIG.elimination_threshold;
  return { mode, elimination_threshold };
}

export type RoundFinishOutcome = 'advanced' | 'completed' | 'eliminated';

export type RoundFinishResult = {
  outcome: RoundFinishOutcome;
  score: number;
  threshold: number | null;
  mode: ProgressionMode;
  next_stage: { id: string; name: string; type: string } | null;
  message: string;
};

export function evaluateInterviewThreshold(
  config: ThresholdConfig | null | undefined,
  scores: { voiceScore?: number | null; codeScore?: number | null },
): {
  suggested: 'advance' | 'reject' | 'review';
  pendingHumanReview: boolean;
  autoAction: string | null;
} {
  const voice = scores.voiceScore ?? null;
  const code = scores.codeScore ?? null;
  const composite =
    voice != null && code != null
      ? (voice + code) / 2
      : voice ?? code ?? null;

  const cfg = config ?? {};
  const requireHuman = cfg.require_human_review !== false;

  if (composite == null) {
    return { suggested: 'review', pendingHumanReview: true, autoAction: null };
  }

  if (cfg.auto_reject_max_score != null && composite <= cfg.auto_reject_max_score) {
    return {
      suggested: 'reject',
      pendingHumanReview: requireHuman,
      autoAction: requireHuman ? 'pending_reject' : 'reject',
    };
  }
  if (cfg.auto_advance_min_score != null && composite >= cfg.auto_advance_min_score) {
    return {
      suggested: 'advance',
      pendingHumanReview: requireHuman,
      autoAction: requireHuman ? 'pending_advance' : 'advance',
    };
  }

  return { suggested: 'review', pendingHumanReview: true, autoAction: null };
}

export function diffSnapshots(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Array<{ path: string; before: unknown; after: unknown }> {
  const changes: Array<{ path: string; before: unknown; after: unknown }> = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    const b = before[key];
    const a = after[key];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes.push({ path: key, before: b, after: a });
    }
  }
  return changes;
}

export function filterProfileFields<T extends Record<string, unknown>>(
  profile: T,
  actor: { isOwner?: boolean; canWrite?: boolean; canApprove?: boolean },
  fieldPermissions?: Record<string, string[]> | null,
): T {
  if (!fieldPermissions || Object.keys(fieldPermissions).length === 0) {
    return profile;
  }
  const out = { ...profile };
  for (const [field, roles] of Object.entries(fieldPermissions)) {
    const allowed =
      (roles.includes('owner') && actor.isOwner) ||
      (roles.includes('writer') && actor.canWrite) ||
      (roles.includes('approver') && actor.canApprove) ||
      roles.includes('reader');
    if (!allowed && field in out) {
      delete out[field];
    }
  }
  return out;
}
