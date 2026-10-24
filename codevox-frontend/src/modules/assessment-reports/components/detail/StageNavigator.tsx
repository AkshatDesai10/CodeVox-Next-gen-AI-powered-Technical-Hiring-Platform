'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type {
  AiScreeningStageReport,
  AssessmentStageReport,
  CodingStageReport,
  TakeHomeStageReport,
  VerbalStageReport,
} from '../../types/assessment-report';
import { formatPct, roundPillClass, scoreBarColor, stageStatusLabel } from '../../utils/format';

function isCoding(stage: AssessmentStageReport): stage is CodingStageReport {
  return stage.stageType === 'coding';
}

function isTakeHome(stage: AssessmentStageReport): stage is TakeHomeStageReport {
  return stage.stageType === 'take_home';
}

function isAiScreening(stage: AssessmentStageReport): stage is AiScreeningStageReport {
  return stage.stageType === 'ai_screening';
}

function isVerbal(stage: AssessmentStageReport): stage is VerbalStageReport {
  return (
    stage.stageType === 'screening' ||
    stage.stageType === 'ai_verbal' ||
    stage.stageType === 'hr_verbal' ||
    stage.stageType === 'project_interview'
  );
}

const STAGE_ICONS: Record<string, string> = {
  coding: 'code',
  take_home: 'assignment',
  ai_screening: 'fact_check',
  screening: 'record_voice_over',
  ai_verbal: 'smart_toy',
  hr_verbal: 'groups',
  project_interview: 'construction',
};

export function stageIcon(stage: AssessmentStageReport): string {
  return STAGE_ICONS[stage.stageType] ?? 'task_alt';
}

/** AI screening is a pass/fail requirement check and never carries a score. */
export function stageHasScore(stage: AssessmentStageReport): boolean {
  return !isAiScreening(stage) && stage.scorePct != null;
}

export function stageSubtitle(stage: AssessmentStageReport): string {
  if (isCoding(stage)) {
    const q =
      stage.questionsPassed != null && stage.questionsTotal != null
        ? `${stage.questionsPassed}/${stage.questionsTotal} questions passed`
        : 'Coding round';
    const dur = stage.durationMinutes != null ? ` · ${stage.durationMinutes}m` : '';
    return `${q}${dur}`;
  }
  if (isTakeHome(stage)) {
    if (stage.subtitle) return stage.subtitle;
    if (stage.status === 'in_review') return 'Pending sign-off';
    if (stage.status === 'completed') return 'Submitted';
    if (stage.status === 'evaluating') return 'Evaluating';
    return stage.status === 'pending' ? 'Not started' : stageStatusLabel(stage.status);
  }
  if (isAiScreening(stage)) {
    const n = stage.checks?.length ?? 0;
    return `${n} requirement checks · ${String(stage.analyzerStatus ?? 'PENDING').toLowerCase()}`;
  }
  if (isVerbal(stage)) {
    if (stage.endedByCandidate) return 'Self-terminated by candidate';
    const n = stage.competencies?.length ?? 0;
    const dur = stage.durationMinutes != null ? ` · ${stage.durationMinutes}m` : '';
    return `${n} competencies evaluated${dur}`;
  }
  return stageStatusLabel(stage.status);
}

export function StageStatusBadge(props: { stage: AssessmentStageReport }) {
  const { status } = props.stage;
  const endedByCandidate =
    'endedByCandidate' in props.stage && Boolean(props.stage.endedByCandidate);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        endedByCandidate
          ? 'bg-amber-50 text-amber-800 border-amber-200'
          : roundPillClass(status)
      }`}
    >
      {status === 'evaluating' || status === 'in_progress' ? (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
      ) : null}
      {endedByCandidate
        ? 'Self-terminated'
        : status === 'in_review' && props.stage.scorePct != null
          ? 'Pending sign-off'
          : stageStatusLabel(status)}
    </span>
  );
}

export function StageNavigator(props: {
  stages: AssessmentStageReport[];
  activeStageId: string | null;
  onSelect: (stageId: string) => void;
}) {
  return (
    <nav aria-label="Assessment rounds" className="assessment-card p-2">
      <div className="flex items-center justify-between px-3 pb-2 pt-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
          Assessment rounds
        </span>
        <span className="rounded-full bg-[var(--assessment-surface-container)] px-2 py-0.5 text-[11px] font-semibold text-[var(--assessment-on-surface-variant)]">
          {props.stages.length}
        </span>
      </div>
      <ol className="flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0">
        {props.stages.map((stage, index) => {
          const active = stage.stageId === props.activeStageId;
          const hasScore = stageHasScore(stage);
          return (
            <li key={stage.stageId} className="min-w-[240px] lg:min-w-0">
              <button
                type="button"
                onClick={() => props.onSelect(stage.stageId)}
                aria-current={active ? 'step' : undefined}
                className={`flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition ${
                  active
                    ? 'bg-[var(--assessment-primary-container)] ring-1 ring-[var(--assessment-primary)]'
                    : 'hover:bg-[var(--assessment-surface-container)]'
                }`}
              >
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                    active
                      ? 'bg-[var(--assessment-primary)] text-white'
                      : 'bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)]'
                  }`}
                >
                  <AssessmentMaterialIcon name={stageIcon(stage)} size={20} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold text-[var(--assessment-on-surface)]">
                      <span className="mr-1 text-[var(--assessment-on-surface-variant)]">{index + 1}.</span>
                      {stage.label}
                    </span>
                    {hasScore ? (
                      <span className="shrink-0 text-sm font-bold tabular-nums text-[var(--assessment-on-surface)]">
                        {formatPct(stage.scorePct)}
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-[var(--assessment-on-surface-variant)]">
                    {stageSubtitle(stage)}
                  </span>
                  <span className="mt-2 flex items-center gap-2">
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--assessment-surface-container-high)]">
                      <span
                        className={`block h-full rounded-full ${scoreBarColor(hasScore ? stage.scorePct : null)}`}
                        style={{ width: `${hasScore ? Math.min(100, Math.max(0, stage.scorePct ?? 0)) : 0}%` }}
                      />
                    </span>
                    {'interviewReportPath' in stage && stage.interviewReportPath ? (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-full border border-[var(--assessment-primary)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--assessment-primary)]"
                        title="Full interview report available"
                      >
                        <AssessmentMaterialIcon name="description" size={12} />
                        Report
                      </span>
                    ) : null}
                    <StageStatusBadge stage={stage} />
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
