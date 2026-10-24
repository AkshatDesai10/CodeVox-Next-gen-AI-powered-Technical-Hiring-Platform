/**
 * Cross-round hire evaluation helpers.
 * Assessment / AI Verbal weigh more than resume and behaviour.
 */

export type OverallHireDecision = 'strong_hire' | 'hire' | 'under_review' | 'do_not_hire';

export type OverallEvidenceItem = {
  source: string;
  stageType?: string | null;
  headline?: string | null;
  competency?: string | null;
  detail: string;
};

export type ShortlistBadge = 'top_pick' | 'hidden_gem' | 'score_inflated';

export type OverallEvaluation = {
  decision: OverallHireDecision;
  summary: string;
  whyHire: OverallEvidenceItem[];
  whyNotHire: OverallEvidenceItem[];
  weightedScorePct: number | null;
  sourceWeights: Record<string, number>;
  generatedAt: string;
  generatedBy: 'llm' | 'heuristic';
  /** Transcript & JD Qualitative Depth (0-100) evaluated from interview transcripts and PSV */
  holisticScore?: number | null;
  /** Composite shortlist score: 65% objective score + 35% transcript/JD depth */
  shortlistScore?: number | null;
  /** Categorical tag: top_pick, hidden_gem, or score_inflated */
  shortlistBadge?: ShortlistBadge | null;
  /** Concrete rationale explaining why candidate is higher/lower fit than score implies */
  shortlistRationale?: string | null;
};

/** Relative priority when rolling up numeric stage scores. */
export const STAGE_SCORE_WEIGHT: Record<string, number> = {
  coding: 1.5,
  take_home: 1.5,
  ai_verbal: 1.5,
  project_interview: 1.4,
  screening: 1.0,
  ai_screening: 0.9,
  hr_verbal: 0.5,
  panel: 0.5,
  custom: 1.0,
};

export const RESUME_SCORE_WEIGHT = 0.4;

export function stageWeight(stageType: string | null | undefined): number {
  const key = String(stageType || 'custom').toLowerCase();
  return STAGE_SCORE_WEIGHT[key] ?? 1.0;
}

export function isHighPriorityStage(stageType: string | null | undefined): boolean {
  const key = String(stageType || '').toLowerCase();
  return key === 'coding' || key === 'take_home' || key === 'ai_verbal' || key === 'project_interview';
}

export function isLowPriorityStage(stageType: string | null | undefined): boolean {
  const key = String(stageType || '').toLowerCase();
  return key === 'hr_verbal' || key === 'panel' || key === 'ai_screening' || key === 'screening';
}

export function computeWeightedOverallScore(input: {
  stages: Array<{ stageType: string; scorePct: number | null | undefined; label?: string }>;
  resumeScore: number | null | undefined;
}): { weightedScorePct: number | null; sourceWeights: Record<string, number> } {
  const sourceWeights: Record<string, number> = {};
  let weightedSum = 0;
  let weightTotal = 0;

  for (const stage of input.stages) {
    if (typeof stage.scorePct !== 'number' || Number.isNaN(stage.scorePct)) continue;
    const weight = stageWeight(stage.stageType);
    const key = stage.label || stage.stageType;
    sourceWeights[key] = weight;
    weightedSum += stage.scorePct * weight;
    weightTotal += weight;
  }

  if (typeof input.resumeScore === 'number' && !Number.isNaN(input.resumeScore)) {
    sourceWeights.resume = RESUME_SCORE_WEIGHT;
    weightedSum += input.resumeScore * RESUME_SCORE_WEIGHT;
    weightTotal += RESUME_SCORE_WEIGHT;
  }

  if (weightTotal <= 0) {
    return { weightedScorePct: null, sourceWeights };
  }
  return {
    weightedScorePct: Math.round((weightedSum / weightTotal) * 10) / 10,
    sourceWeights,
  };
}

export function heuristicOverallDecision(weightedScorePct: number | null): OverallHireDecision {
  if (weightedScorePct == null) return 'under_review';
  if (weightedScorePct >= 85) return 'strong_hire';
  if (weightedScorePct >= 70) return 'hire';
  if (weightedScorePct >= 55) return 'under_review';
  return 'do_not_hire';
}

/**
 * Composite Shortlist Score:
 * Scores remain the primary anchor (65%), but full transcript and JD depth (35%)
 * allows strong performers (e.g. 57% score with 92% depth) to outrank shallow test passers.
 */
export function computeCompositeShortlistScore(input: {
  weightedScorePct: number | null | undefined;
  holisticScore: number | null | undefined;
}): number | null {
  const score = input.weightedScorePct;
  const holistic = input.holisticScore;
  if (typeof score === 'number' && !Number.isNaN(score) && typeof holistic === 'number' && !Number.isNaN(holistic)) {
    return Math.round((score * 0.65 + holistic * 0.35) * 10) / 10;
  }
  if (typeof score === 'number' && !Number.isNaN(score)) return score;
  if (typeof holistic === 'number' && !Number.isNaN(holistic)) return holistic;
  return null;
}

/**
 * Determine if a candidate is a Consensus Top Pick, Hidden Gem, or Score Inflated
 */
export function determineShortlistBadge(input: {
  weightedScorePct: number | null | undefined;
  holisticScore: number | null | undefined;
  isDisqualified?: boolean;
}): ShortlistBadge | null {
  if (input.isDisqualified) return null;
  const score = typeof input.weightedScorePct === 'number' ? input.weightedScorePct : null;
  const holistic = typeof input.holisticScore === 'number' ? input.holisticScore : null;

  if (score == null && holistic == null) return null;

  // Consensus Top Pick: high objective score and high conceptual depth
  if (score != null && score >= 75 && holistic != null && holistic >= 75) {
    return 'top_pick';
  }

  // Hidden Gem: moderate score (e.g. 50-72%) but standout conceptual/transcript depth (>=80%)
  if (score != null && score >= 50 && score < 72 && holistic != null && holistic >= 80) {
    return 'hidden_gem';
  }

  // Score Inflated: high test score (>=75%) but notably weak qualitative depth (<60%)
  if (score != null && score >= 75 && holistic != null && holistic < 60) {
    return 'score_inflated';
  }

  return null;
}

export function isOverallEvaluation(raw: unknown): raw is OverallEvaluation {
  if (!raw || typeof raw !== 'object') return false;
  const row = raw as Record<string, unknown>;
  return (
    typeof row.decision === 'string' &&
    typeof row.summary === 'string' &&
    Array.isArray(row.whyHire) &&
    Array.isArray(row.whyNotHire)
  );
}
