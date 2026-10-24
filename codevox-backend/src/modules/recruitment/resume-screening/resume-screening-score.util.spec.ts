/**
 * Lightweight acceptance checks for Resume Screening score util (no Jest required).
 * Run: npx ts-node -r tsconfig-paths/register src/modules/recruitment/resume-screening/resume-screening-score.util.spec.ts
 */
import {
  aggregateResumeMatchScore,
  deriveMatchLabel,
} from './resume-screening-score.util';
import type { ScoreFactorInput } from './resume-screening.types';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function almostEq(a: number, b: number, tol = 0.02) {
  return Math.abs(a - b) <= tol;
}

const cv = { source: 'url_extract' as const, charCount: 4000 };

function factor(
  partial: Partial<ScoreFactorInput> & Pick<ScoreFactorInput, 'factorId' | 'factor' | 'importanceScore' | 'matchStrength'>,
): ScoreFactorInput {
  return {
    critical: false,
    evidenceAvailable: true,
    applicable: true,
    confidence: 0.9,
    ...partial,
  };
}

function testStrong95() {
  const r = aggregateResumeMatchScore(
    [
      factor({ factorId: '1', factor: 'Backend', importanceScore: 0.3, matchStrength: 0.99, critical: true }),
      factor({ factorId: '2', factor: 'Python', importanceScore: 0.25, matchStrength: 0.99, critical: true }),
      factor({ factorId: '3', factor: 'AWS', importanceScore: 0.15, matchStrength: 0.96 }),
      factor({ factorId: '4', factor: 'Dist', importanceScore: 0.12, matchStrength: 0.94 }),
      factor({ factorId: '5', factor: 'Arch', importanceScore: 0.1, matchStrength: 0.93 }),
      factor({ factorId: '6', factor: 'FinTech', importanceScore: 0.08, matchStrength: 0.8 }),
    ],
    cv,
  );
  assert(r.score === 95, `expected 95 got ${r.score}`);
  assert(almostEq(r.score0, 95.83), `score0 ${r.score0}`);
}

function test85() {
  const r = aggregateResumeMatchScore(
    [
      factor({ factorId: '1', factor: 'Backend', importanceScore: 0.28, matchStrength: 0.96, critical: true }),
      factor({ factorId: '2', factor: 'Python', importanceScore: 0.24, matchStrength: 0.97, critical: true }),
      factor({ factorId: '3', factor: 'AWS', importanceScore: 0.16, matchStrength: 0.75 }),
      factor({ factorId: '4', factor: 'Dist', importanceScore: 0.14, matchStrength: 0.91 }),
      factor({ factorId: '5', factor: 'Arch', importanceScore: 0.1, matchStrength: 0.87 }),
      factor({ factorId: '6', factor: 'FinTech', importanceScore: 0.08, matchStrength: 0.55 }),
    ],
    cv,
  );
  assert(r.score === 85, `expected 85 got ${r.score}`);
}

function test75() {
  const r = aggregateResumeMatchScore(
    [
      factor({ factorId: '1', factor: 'Backend', importanceScore: 0.3, matchStrength: 1, critical: true }),
      factor({ factorId: '2', factor: 'Python', importanceScore: 0.25, matchStrength: 1, critical: true }),
      factor({ factorId: '3', factor: 'AWS', importanceScore: 0.15, matchStrength: 0.62 }),
      factor({ factorId: '4', factor: 'Dist', importanceScore: 0.12, matchStrength: 0.58 }),
      factor({ factorId: '5', factor: 'Cloud', importanceScore: 0.1, matchStrength: 0.24 }),
      factor({ factorId: '6', factor: 'FinTech', importanceScore: 0.08, matchStrength: 0.18 }),
    ],
    cv,
  );
  assert(r.score === 75, `expected 75 got ${r.score}`);
}

function test61NoEvidence() {
  const r = aggregateResumeMatchScore(
    [
      factor({ factorId: '1', factor: 'Backend', importanceScore: 0.35, matchStrength: 0.9, critical: true }),
      factor({ factorId: '2', factor: 'Python', importanceScore: 0.2, matchStrength: 0, evidenceAvailable: false }),
      factor({ factorId: '3', factor: 'AWS', importanceScore: 0.15, matchStrength: 0, evidenceAvailable: false }),
      factor({ factorId: '4', factor: 'Dist', importanceScore: 0.1, matchStrength: 0.8 }),
      factor({ factorId: '5', factor: 'Lead', importanceScore: 0.1, matchStrength: 0, evidenceAvailable: false }),
      factor({ factorId: '6', factor: 'FinTech', importanceScore: 0.1, matchStrength: 0, evidenceAvailable: false }),
    ],
    cv,
  );
  assert(r.score === 61, `expected 61 got ${r.score}`);
}

function test40CriticalGap() {
  const r = aggregateResumeMatchScore(
    [
      factor({ factorId: '1', factor: 'Medical', importanceScore: 0.18, matchStrength: 0.2, critical: true }),
      factor({ factorId: '2', factor: 'Clinical', importanceScore: 0.32, matchStrength: 0.96, critical: true }),
      factor({ factorId: '3', factor: 'Care', importanceScore: 0.2, matchStrength: 0.94 }),
      factor({ factorId: '4', factor: 'Years', importanceScore: 0.15, matchStrength: 0.92 }),
      factor({ factorId: '5', factor: 'Comm', importanceScore: 0.1, matchStrength: 0.9 }),
      factor({ factorId: '6', factor: 'Research', importanceScore: 0.05, matchStrength: 0.88 }),
    ],
    cv,
  );
  assert(r.score === 40, `expected 40 got ${r.score}`);
}

function testMatchStrengthMonotonicity() {
  const base = [
    factor({ factorId: '1', factor: 'A', importanceScore: 0.5, matchStrength: 0.5, critical: true }),
    factor({ factorId: '2', factor: 'B', importanceScore: 0.5, matchStrength: 0.8 }),
  ];
  const low = aggregateResumeMatchScore(base, cv);
  const high = aggregateResumeMatchScore(
    [
      { ...base[0]!, matchStrength: 0.9 },
      base[1]!,
    ],
    cv,
  );
  assert(high.score >= low.score, 'matchStrength increase must not decrease score');
}

function testScaleInvariance() {
  const two = aggregateResumeMatchScore(
    [
      factor({ factorId: '1', factor: 'A', importanceScore: 0.6, matchStrength: 0.8 }),
      factor({ factorId: '2', factor: 'B', importanceScore: 0.4, matchStrength: 0.5 }),
    ],
    cv,
  );
  const four = aggregateResumeMatchScore(
    [
      factor({ factorId: '1', factor: 'A', importanceScore: 0.3, matchStrength: 0.8 }),
      factor({ factorId: '1b', factor: 'A2', importanceScore: 0.3, matchStrength: 0.8 }),
      factor({ factorId: '2', factor: 'B', importanceScore: 0.2, matchStrength: 0.5 }),
      factor({ factorId: '2b', factor: 'B2', importanceScore: 0.2, matchStrength: 0.5 }),
    ],
    cv,
  );
  // Same relative (w,r) mass → same score0
  assert(almostEq(two.score0, four.score0, 0.05), `scale invariance ${two.score0} vs ${four.score0}`);
}

function testDerivedLabels() {
  assert(deriveMatchLabel({ applicable: false, evidenceAvailable: true, matchStrength: 1 }) === 'NOT_APPLICABLE', 'na');
  assert(deriveMatchLabel({ applicable: true, evidenceAvailable: false, matchStrength: 0 }) === 'NO_EVIDENCE', 'ne');
  assert(deriveMatchLabel({ applicable: true, evidenceAvailable: true, matchStrength: 0.9 }) === 'STRONG_MATCH', 'sm');
  assert(deriveMatchLabel({ applicable: true, evidenceAvailable: true, matchStrength: 0.75 }) === 'MATCH', 'm');
  assert(deriveMatchLabel({ applicable: true, evidenceAvailable: true, matchStrength: 0.5 }) === 'PARTIAL_MATCH', 'pm');
  assert(deriveMatchLabel({ applicable: true, evidenceAvailable: true, matchStrength: 0.2 }) === 'GAP', 'gap');
}

function main() {
  testStrong95();
  test85();
  test75();
  test61NoEvidence();
  test40CriticalGap();
  testMatchStrengthMonotonicity();
  testScaleInvariance();
  testDerivedLabels();
  // eslint-disable-next-line no-console
  console.log('resume-screening-score.util.spec.ts: all passed');
}

main();
