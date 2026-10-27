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

export function isRubricStepComplete(competencies: JobProfileCompetency[], stages?: JobProfileStage[]): boolean {
  if (stages && stages.length > 0) {
    const hasVerbal = stages.some((s) => s.stage_type === 'ai_verbal' || (s.mode === 'ai_led' && !['coding', 'project_interview', 'screening', 'ai_screening', 'hr_verbal', 'panel'].includes(s.stage_type || '')));
    if (!hasVerbal) return true;
  }
  return competencies.length > 0;
}

export function isTakeHomeStageConfigured(_stage: JobProfileStage): boolean {
  return false;
}

export function isQuestionsStepComplete(
  questions: Array<{ prompt: string; kind?: string }>,
  stages: JobProfileStage[] = [],
): boolean {
  // If pipeline stages are configured, CodeVox generates/selects questions dynamically
  if (stages && stages.length > 0) {
    const hasManualCoding = stages.some(
      (s) => s.stage_type === 'coding' && (s.round_config as any)?.question_strategy === 'manual'
    );
    const hasManualVerbal = stages.some(
      (s) => s.stage_type === 'ai_verbal' && (s.round_config as any)?.question_strategy === 'manual'
    );
    if (hasManualCoding && !questions.some((q) => q.kind === 'coding')) return false;
    if (hasManualVerbal && !questions.some((q) => q.kind !== 'coding')) return false;
    return true;
  }
  return true;
}

export function normalizeCompetencyWeights<T extends { weight_pct: number }>(
  items: T[],
): T[] {
  if (items.length === 0) return items;
  const sum = items.reduce((acc, x) => acc + (x.weight_pct || 0), 0);
  if (sum === 0) {
    const each = Number((100 / items.length).toFixed(1));
    return items.map((x, i) => ({
      ...x,
      weight_pct: i === items.length - 1 ? 100 - each * (items.length - 1) : each,
    }));
  }
  const scaled = items.map((x) => ({
    ...x,
    weight_pct: Math.round(((x.weight_pct || 0) / sum) * 1000) / 10,
  }));
  const diff = 100 - scaled.reduce((acc, x) => acc + x.weight_pct, 0);
  if (scaled.length > 0 && Math.abs(diff) > 0.01) {
    scaled[scaled.length - 1].weight_pct = Number(
      (scaled[scaled.length - 1].weight_pct + diff).toFixed(1),
    );
  }
  return scaled;
}

export function canPublishJobProfile(input: {
  competencies: JobProfileCompetency[];
  questions: Array<{ prompt: string; kind?: string }>;
  stages?: JobProfileStage[];
}): boolean {
  const stages = input.stages ?? [];
  if (!stages.length) return false;

  const projectRoundsReady = stages
    .filter((s) => s.stage_type === 'project_interview')
    .every((s) => isProjectInterviewConfigured(s.round_config));
  if (!projectRoundsReady) return false;

  return isQuestionsStepComplete(input.questions, stages);
}

export function firstIncompleteSetupStep(data: JobProfileDetail): 1 | 2 | 3 {
  if (!isBasicsStepComplete(data.profile)) return 1;
  if (!isRubricStepComplete(data.competencies, data.stages)) return 2;
  return 3;
}

export function configureStepFromSearchParam(param: string | null): 1 | 2 | 3 | null {
  if (param === '1' || param === 'basics') return 1;
  if (param === '2' || param === 'stages') return 2;
  if (param === '3' || param === 'round-config') return 3;
  return null;
}

export function setupPathForProfile(id: string, step: 1 | 2 | 3): string {
  const map: Record<1 | 2 | 3, string> = {
    1: 'basics',
    2: 'stages',
    3: 'round-config',
  };
  return `/assessments/job-profiles/${id}/configure?step=${map[step]}`;
}

export function setupPathForDetail(data: JobProfileDetail): string {
  return setupPathForProfile(data.profile.id, firstIncompleteSetupStep(data));
}
