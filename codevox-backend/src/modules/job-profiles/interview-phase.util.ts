import {
  AutonomousInterviewPhase,
} from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import {
  JobStageMode,
  JobStageType,
  JobProfileStageMysql,
} from './entities/job-profile-stage.mysql.entity';

type StagePick = Pick<JobProfileStageMysql, 'id' | 'stageType' | 'mode' | 'sortOrder'>;

/** First AI interview stage by sort_order: hr_verbal+ai_led or ai_verbal. */
export function firstInterviewStage(
  stages: StagePick[],
): StagePick | undefined {
  const ordered = [...stages].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
  );
  return ordered.find(
    (s) =>
      s.stageType === JobStageType.AI_VERBAL ||
      s.stageType === JobStageType.AI_SCREENING ||
      s.stageType === JobStageType.PROJECT_INTERVIEW ||
      (s.stageType === JobStageType.HR_VERBAL && s.mode === JobStageMode.AI_LED),
  );
}

/**
 * Seed phase from the first interview round in the pipeline.
 * Behavioural-first profiles → HR_VERBAL; otherwise INTRO_VERBAL (technical).
 */
export function resolveInitialInterviewPhase(
  stages: StagePick[],
): AutonomousInterviewPhase {
  const first = firstInterviewStage(stages);
  if (first) {
    if (first.stageType === JobStageType.AI_SCREENING) {
      return AutonomousInterviewPhase.AI_SCREENING;
    }
    if (first.stageType === JobStageType.PROJECT_INTERVIEW) {
      return AutonomousInterviewPhase.BND_INTERVIEW;
    }
    if (first.stageType === JobStageType.HR_VERBAL && first.mode === JobStageMode.AI_LED) {
      return AutonomousInterviewPhase.HR_VERBAL;
    }
  }
  return AutonomousInterviewPhase.INTRO_VERBAL;
}

/** True when this stage should run the behavioural voice engine. */
export function isBehaviouralAiStage(
  stage: Pick<JobProfileStageMysql, 'stageType' | 'mode'> | null | undefined,
): boolean {
  return (
    !!stage &&
    (stage.stageType === JobStageType.AI_SCREENING ||
      (stage.stageType === JobStageType.HR_VERBAL && stage.mode === JobStageMode.AI_LED))
  );
}