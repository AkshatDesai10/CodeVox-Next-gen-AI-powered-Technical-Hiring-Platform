import type {
  JobProfileCompetency,
  JobProfileDetail,
  JobProfileStage,
  JobProfileSummary,
} from '@/modules/job-profiles/lib/job-profiles-api';
import { isProjectInterviewConfigured } from '@/modules/job-profiles/lib/project-interview-round.types';

export function isBasicsStepComplete(profile: JobProfileSummary): boolean {
  const skills = profile.required_skills?.filter((s) => s.trim()) ?? [];
  const responsibilities = profile.responsibilities?.filter((s) => s.trim()) ?? [];
  return skills.length > 0 || responsibilities.length > 0;
}

export function isRubricStepComplete(competencies: JobProfileCompetency[]): boolean {
  return competencies.length > 0;
}

export function isTakeHomeStageConfigured(stage: JobProfileStage): boolean {
  if (stage.stage_type !== 'take_home') return false;
  const config = parseTakeHomeRoundConfig(stage.round_config);
  return Boolean(
    config.problem.title.trim() || config.problem.description_md.trim(),
  );
}

export function isQuestionsStepComplete(
  questions: Array<{ prompt: string; kind?: string }>,
  stages: JobProfileStage[] = [],
): boolean {
  const hasInterviewQuestions = questions.some((q) => q.prompt.trim().length > 0);
  const hasTakeHomeRounds = stages.some((s) => isTakeHomeStageConfigured(s));
  const hasAiScreening = stages.some((s) => s.stage_type === 'ai_screening');
  const hasAiRounds = stages.some(
    (s) =>
      s.stage_type === 'ai_verbal' ||
      (s.mode === 'ai_led' && s.stage_type !== 'ai_screening'),
  );
  return hasInterviewQuestions || hasTakeHomeRounds || hasAiRounds || hasAiScreening;
}

/** Scale competency weights so they sum to 100%. */
export function normalizeCompetencyWeights<T extends { weight_pct: number }>(
  rows: T[],
): T[] {
  if (!rows.length) return rows;
  const total = rows.reduce((sum, row) => sum + row.weight_pct, 0);
  if (total <= 0) {
    const base = Math.floor((100 / rows.length) * 10) / 10;
    let remaining = 100;
    return rows.map((row, index) => {
      const weight_pct =
        index === rows.length - 1
          ? Math.round(remaining * 10) / 10
          : base;
      remaining -= weight_pct;
      return { ...row, weight_pct };
    });
  }
  if (Math.abs(total - 100) < 0.01) return rows;
  let remaining = 100;
  return rows.map((row, index) => {
    if (index === rows.length - 1) {
      return { ...row, weight_pct: Math.round(remaining * 10) / 10 };
    }
    const weight_pct = Math.round((row.weight_pct / total) * 1000) / 10;
    remaining -= weight_pct;
    return { ...row, weight_pct };
  });
}

export function canPublishJobProfile(input: {
  competencies: JobProfileCompetency[];
  questions: Array<{ prompt: string }>;
  stages?: JobProfileStage[];
}): boolean {
  const stages = input.stages ?? [];
  const onlyAiScreeningOrHuman =
    stages.length > 0 &&
    stages.every(
      (s) =>
        s.stage_type === 'ai_screening' ||
        s.stage_type === 'hr_verbal' ||
        s.stage_type === 'panel' ||
        s.mode === 'human_led',
    );
  const hasScoredAiRound = stages.some(
    (s) =>
      s.stage_type === 'ai_verbal' ||
      s.stage_type === 'coding' ||
      s.stage_type === 'screening' ||
      s.stage_type === 'take_home' ||
      s.stage_type === 'project_interview',
  );
  const projectRoundsReady = stages
    .filter((s) => s.stage_type === 'project_interview')
    .every((s) => isProjectInterviewConfigured(s.round_config));
  if (!projectRoundsReady) return false;
  if (onlyAiScreeningOrHuman && !hasScoredAiRound) {
    return isQuestionsStepComplete(input.questions, stages);
  }
  return (
    isRubricStepComplete(input.competencies) &&
    isQuestionsStepComplete(input.questions, stages)
  );
}

export function firstIncompleteSetupStep(data: JobProfileDetail): 1 | 2 | 3 {
  if (!isBasicsStepComplete(data.profile)) return 1;
  if (!isRubricStepComplete(data.competencies)) return 2;
  return 3;
}

export function setupPathForProfile(profileId: string, step: 1 | 2 | 3): string {
  if (step === 1) return `/assessments/job-profiles/${profileId}/basics`;
  if (step === 2) return `/assessments/job-profiles/${profileId}/configure?step=rubric`;
  return `/assessments/job-profiles/${profileId}/configure?step=questions`;
}

export function configureStepFromSearchParam(step: string | null): 2 | 3 {
  return step === 'questions' ? 3 : 2;
}

export function setupPathForDetail(data: JobProfileDetail): string {
  return setupPathForProfile(data.profile.id, firstIncompleteSetupStep(data));
}
