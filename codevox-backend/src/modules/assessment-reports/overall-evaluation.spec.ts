/**
 * Lightweight acceptance checks for overall evaluation weighting (no Jest required).
 * Run: npx ts-node -r tsconfig-paths/register src/modules/assessment-reports/overall-evaluation.spec.ts
 */
import {
  computeWeightedOverallScore,
  heuristicOverallDecision,
  stageWeight,
  RESUME_SCORE_WEIGHT,
  computeCompositeShortlistScore,
  determineShortlistBadge,
} from './overall-evaluation';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function testWeightsPreferAssessment() {
  assert(stageWeight('coding') > stageWeight('hr_verbal'), 'coding should outweigh behaviour');
  assert(stageWeight('ai_verbal') > stageWeight('hr_verbal'), 'AI verbal should outweigh behaviour');
  assert(stageWeight('coding') > RESUME_SCORE_WEIGHT, 'coding should outweigh resume');

  const result = computeWeightedOverallScore({
    stages: [
      { stageType: 'coding', scorePct: 90, label: 'Coding' },
      { stageType: 'ai_verbal', scorePct: 80, label: 'AI Verbal' },
      { stageType: 'hr_verbal', scorePct: 40, label: 'Behaviour' },
    ],
    resumeScore: 50,
  });
  assert(result.weightedScorePct != null, 'expected weighted score');
  assert(
    (result.weightedScorePct as number) > 70,
    `expected weighted score > 70, got ${result.weightedScorePct}`,
  );
  console.log('OK weights', result.weightedScorePct, result.sourceWeights);
}

function testHeuristicDecision() {
  assert(heuristicOverallDecision(90) === 'strong_hire', '90 => strong_hire');
  assert(heuristicOverallDecision(75) === 'hire', '75 => hire');
  assert(heuristicOverallDecision(60) === 'under_review', '60 => under_review');
  assert(heuristicOverallDecision(40) === 'do_not_hire', '40 => do_not_hire');
  assert(heuristicOverallDecision(null) === 'under_review', 'null => under_review');
  console.log('OK heuristic decisions');
}

function testCompositeShortlistScore() {
  // Scenario: Candidate A scored 60% test score, but only 55% transcript/JD depth
  const candidateAScore = computeCompositeShortlistScore({ weightedScorePct: 60, holisticScore: 55 });
  // Scenario: Candidate B (Hidden Gem) scored 57% test score, but demonstrated 90% transcript/JD depth
  const candidateBScore = computeCompositeShortlistScore({ weightedScorePct: 57, holisticScore: 90 });

  assert(candidateAScore != null && candidateBScore != null, 'both composite scores must exist');
  // Candidate B (57% test) should OUTRANK Candidate A (60% test) due to superior transcript depth!
  assert(
    (candidateBScore as number) > (candidateAScore as number),
    `Candidate B (${candidateBScore}) should outrank Candidate A (${candidateAScore})`,
  );

  // Badging test
  assert(
    determineShortlistBadge({ weightedScorePct: 57, holisticScore: 90 }) === 'hidden_gem',
    'Candidate B should be tagged as hidden_gem',
  );
  assert(
    determineShortlistBadge({ weightedScorePct: 88, holisticScore: 85 }) === 'top_pick',
    'High scorer with high transcript depth should be top_pick',
  );
  assert(
    determineShortlistBadge({ weightedScorePct: 80, holisticScore: 50 }) === 'score_inflated',
    'High scorer with shallow transcript depth should be score_inflated',
  );
  console.log('OK composite shortlist score & badges:', { candidateAScore, candidateBScore });
}

testWeightsPreferAssessment();
testHeuristicDecision();
testCompositeShortlistScore();
console.log('overall-evaluation.spec.ts passed');

