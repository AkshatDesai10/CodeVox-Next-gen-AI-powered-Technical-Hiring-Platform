import { SCORE_CONSTANTS } from './resume-screening.constants';
import type {
  AggregatedScoreResult,
  CvCompletenessInput,
  DerivedMatchLabel,
  ScoreFactorInput,
} from './resume-screening.types';

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function deriveMatchLabel(input: {
  applicable: boolean;
  evidenceAvailable: boolean;
  matchStrength: number;
}): DerivedMatchLabel {
  if (!input.applicable) return 'NOT_APPLICABLE';
  if (!input.evidenceAvailable) return 'NO_EVIDENCE';
  const m = clamp(input.matchStrength, 0, 1);
  if (m >= SCORE_CONSTANTS.STRONG_MATCH) return 'STRONG_MATCH';
  if (m >= SCORE_CONSTANTS.MATCH) return 'MATCH';
  if (m >= SCORE_CONSTANTS.PARTIAL_MATCH) return 'PARTIAL_MATCH';
  return 'GAP';
}

export function cvCompletenessV(input: CvCompletenessInput): number {
  let v: number;
  if (input.source === 'url_extract') {
    if (input.charCount >= 3000) v = 1;
    else if (input.charCount >= 1000) v = 0.85;
    else if (input.charCount >= 400) v = 0.65;
    else v = 0.15;
  } else if (input.source === 'parsed_overlay') {
    v = 0.45;
  } else if (input.source === 'form_only') {
    v = 0.25;
  } else {
    v = 0.15;
  }
  if (input.truncated) v *= SCORE_CONSTANTS.V_TRUNCATION_PENALTY;
  return v;
}

/**
 * Nest-only aggregator: importanceScore × matchStrength + critical softmin gate.
 * Pure / bit-stable given identical sanitized inputs.
 */
export function aggregateResumeMatchScore(
  factors: ScoreFactorInput[],
  cv: CvCompletenessInput,
): AggregatedScoreResult {
  const applicable = factors
    .filter((f) => f.applicable !== false)
    .map((f) => {
      const importanceScore = round3(
        clamp(f.importanceScore, SCORE_CONSTANTS.IMPORTANCE_EPS, 1),
      );
      const matchStrength = round3(clamp(f.matchStrength ?? 0, 0, 1));
      const confidence = round3(clamp(f.confidence ?? 0.5, 0, 1));
      const evidenceAvailable = Boolean(f.evidenceAvailable);
      return {
        factorId: f.factorId,
        factor: f.factor,
        importanceScore,
        critical: Boolean(f.critical),
        matchStrength,
        evidenceAvailable,
        applicable: true as const,
        confidence,
        evidence: Array.isArray(f.evidence) ? f.evidence.slice(0, 8) : [],
        reasoning: typeof f.reasoning === 'string' ? f.reasoning.slice(0, 800) : '',
      };
    });

  const weightSum = applicable.reduce((s, f) => s + f.importanceScore, 0);
  const safeWeightSum = weightSum > 0 ? weightSum : 1;

  let score0Accum = 0;
  const evaluation: AggregatedScoreResult['evaluation'] = [];

  for (const f of applicable) {
    const W = f.importanceScore / safeWeightSum;
    const r = f.evidenceAvailable
      ? f.matchStrength
      : SCORE_CONSTANTS.NO_EVIDENCE_R;
    score0Accum += W * r;
    evaluation.push({
      ...f,
      weight: round3(W),
      match: deriveMatchLabel(f),
    });
  }

  const score0 = 100 * score0Accum;

  const criticals = applicable.filter((f) => f.critical);
  let criticalGeoMean = 1;
  if (criticals.length > 0) {
    let logSum = 0;
    for (const f of criticals) {
      const s = f.evidenceAvailable
        ? Math.max(f.matchStrength, SCORE_CONSTANTS.LOG_FLOOR)
        : SCORE_CONSTANTS.CRITICAL_NO_EVIDENCE_S;
      logSum += Math.log(s);
    }
    criticalGeoMean = Math.exp(logSum / criticals.length);
  }

  const gamma = SCORE_CONSTANTS.GAMMA;
  const rawScore = score0 * (gamma + (1 - gamma) * criticalGeoMean);
  const score = Math.round(clamp(rawScore, 0, 100));

  const n = applicable.length;
  const nNe = applicable.filter((f) => !f.evidenceAvailable).length;
  const nEv = n - nNe;
  const avgC =
    n > 0 ? applicable.reduce((s, f) => s + f.confidence, 0) / n : 0;
  const E = n > 0 ? nEv / n : 0;
  const V = cvCompletenessV(cv);
  const confidence = round3(
    clamp(
      SCORE_CONSTANTS.CONF_AVG * avgC +
        SCORE_CONSTANTS.CONF_EVIDENCE * E +
        SCORE_CONSTANTS.CONF_CV * V,
      0,
      1,
    ),
  );

  // Include NOT_APPLICABLE factors in evaluation for transparency (zero weight)
  for (const f of factors.filter((x) => x.applicable === false)) {
    evaluation.push({
      factorId: f.factorId,
      factor: f.factor,
      importanceScore: round3(clamp(f.importanceScore, 0, 1)),
      critical: Boolean(f.critical),
      weight: 0,
      matchStrength: round3(clamp(f.matchStrength ?? 0, 0, 1)),
      evidenceAvailable: Boolean(f.evidenceAvailable),
      applicable: false,
      match: 'NOT_APPLICABLE',
      confidence: round3(clamp(f.confidence ?? 0, 0, 1)),
      evidence: Array.isArray(f.evidence) ? f.evidence.slice(0, 8) : [],
      reasoning: typeof f.reasoning === 'string' ? f.reasoning.slice(0, 800) : '',
    });
  }

  return {
    score,
    confidence,
    score0: round3(score0),
    criticalGeoMean: round3(criticalGeoMean),
    gamma,
    evaluation,
  };
}

/** JD-language criticality backstop (§5). Mutates factor critical/importance in place copy. */
export function applyCriticalityBackstop<T extends {
  factor: string;
  description?: string;
  importanceScore: number;
  critical: boolean;
}>(factors: T[], jdBlob: string): T[] {
  const jd = jdBlob.toLowerCase();
  const hardSpans: string[] = [];
  const patterns = [
    /(?:must\s+have|must\s+be|required|mandatory|essential)[:\s]+([^\n.;]{3,80})/gi,
    /(?:degree|license|licence|certification)\s+(?:in\s+)?([^\n.;]{3,60})/gi,
  ];
  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(jd)) !== null) {
      const span = (m[1] ?? m[0]).toLowerCase().trim();
      if (span.length >= 3) hardSpans.push(span);
    }
  }

  return factors.map((f) => {
    if (f.critical) return f;
    const hay = `${f.factor} ${f.description ?? ''}`.toLowerCase();
    const overlaps = hardSpans.some(
      (span) =>
        span.length >= 4 &&
        (hay.includes(span.slice(0, Math.min(40, span.length))) ||
          span.includes(hay.slice(0, Math.min(40, hay.length)))),
    );
    if (!overlaps) return f;
    return {
      ...f,
      critical: true,
      importanceScore: Math.max(
        f.importanceScore,
        SCORE_CONSTANTS.CRITICALITY_IMPORTANCE_FLOOR,
      ),
    };
  });
}
