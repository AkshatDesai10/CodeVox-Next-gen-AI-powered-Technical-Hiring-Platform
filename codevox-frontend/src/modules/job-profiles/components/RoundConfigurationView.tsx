'use client';

import { useMemo, useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Code2, Sparkles, Scale } from 'lucide-react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { RoundQuestionProblemPicker } from '@/modules/job-profiles/components/RoundQuestionProblemPicker';
import { ProjectInterviewRoundConfigForm } from '@/modules/job-profiles/components/project-interview/ProjectInterviewRoundConfigForm';
import { AiScreeningRoundConfigForm } from '@/modules/job-profiles/components/AiScreeningRoundConfigForm';
import { CompetencyWeightRow } from '@/modules/job-profiles/components/CompetencyWeightRow';
import { NexusToggleSwitch } from '@/modules/job-profiles/components/NexusToggleSwitch';
import {
  allocatePrimaryQuestions,
  VERBAL_DURATION_KEY,
  VERBAL_MAX_TOTAL_KEY,
  VERBAL_MIN_PRIMARY_KEY,
  verbalBudgetCoverageError,
  verbalBudgetShapeError,
  verbalDurationError,
} from '@/modules/job-profiles/lib/verbal-interview-budget';
import { suggestRubricWeights, suggestCompetencies } from '@/modules/job-profiles/lib/job-profiles-api';
import {
  parseTakeHomeRoundConfig,
  DEFAULT_TAKE_HOME_VERIFICATION_WEIGHT_PCT,
  type TakeHomeRoundConfig,
} from '@/modules/job-profiles/lib/take-home-round.types';
import type { AiScreeningRoundConfig } from '@/modules/job-profiles/lib/ai-screening-round.types';
import { isProjectInterviewConfigured } from '@/modules/job-profiles/lib/project-interview-round.types';
import type {
  JobProfileCompetency,
  JobProfileQuestion,
  JobProfileStage,
  ProblemBankProblem,
  QuestionBankQuestion,
} from '@/modules/job-profiles/lib/job-profiles-api';

function bankIdsOnStage(questions: JobProfileQuestion[], stageId: string | null) {
  const questionBankIds = new Set<string>();
  const problemBankIds = new Set<string>();
  if (!stageId) return { questionBankIds, problemBankIds };
  for (const q of questions) {
    if (q.stage_id !== stageId) continue;
    const meta = q.metadata as Record<string, unknown> | null;
    if (!meta) continue;
    if (meta.source === 'question_bank' && meta.question_bank_id != null) {
      questionBankIds.add(String(meta.question_bank_id));
    }
    if (meta.source === 'problem_bank' && meta.problem_bank_id != null) {
      problemBankIds.add(String(meta.problem_bank_id));
    }
  }
  return { questionBankIds, problemBankIds };
}

type Props = {
  profileId: string;
  stages: JobProfileStage[];
  competencies: JobProfileCompetency[];
  questions: JobProfileQuestion[];
  aiBusy?: boolean;
  onStagesChange: (stages: JobProfileStage[]) => void;
  onCompetenciesChange: (competencies: JobProfileCompetency[]) => void;
  onQuestionsChange: (questions: JobProfileQuestion[]) => void;
  onAddQuestions: (rows: QuestionBankQuestion[], stageId: string | null) => void;
  onAddProblems: (rows: ProblemBankProblem[], stageId: string | null) => void;
  onAddContent?: (
    questionRows: QuestionBankQuestion[],
    problemRows: ProblemBankProblem[],
    stageId: string | null,
  ) => void;
  onMagicGenerate: (stageId: string | null) => void;
  onRoundConfigChange?: (stageKey: string, config: TakeHomeRoundConfig) => void;
  onSaveRound?: () => void;
  onFinish?: () => void;
  seniorityLevel?: string | null;
  savedStages?: Set<string>;
  onSavedStagesChange?: (savedStages: Set<string>) => void;
};

function stageIcon(stage: JobProfileStage): string {
  if (stage.stage_type === 'take_home') return 'home_work';
  if (stage.stage_type === 'project_interview') return 'rocket_launch';
  if (stage.stage_type === 'coding') return 'code';
  if (stage.stage_type === 'ai_screening') return 'person_search';
  if (/screen/i.test(stage.name) || stage.stage_type === 'screening') return 'call';
  if (/culture|fit/i.test(stage.name)) return 'group';
  return 'assignment';
}

function difficultyBadgeClass(difficulty: string | undefined): string {
  const d = (difficulty ?? '').toLowerCase();
  if (d === 'hard') return 'bg-[var(--assessment-error-container)] text-[var(--assessment-on-error-container)]';
  if (d === 'medium') return 'bg-[var(--assessment-tertiary-container)]/10 text-[var(--assessment-on-tertiary-container)] border border-[var(--assessment-tertiary-container)]/30';
  return 'bg-[var(--assessment-surface-container-high)] text-[var(--assessment-on-surface-variant)]';
}

function questionsForStage(questions: JobProfileQuestion[], stageId: string | null) {
  return questions
    .filter((q) => q.stage_id === stageId && q.kind !== 'ai_adaptive')
    .sort((a, b) => a.sort_order - b.sort_order);
}

function isProblemQuestion(q: JobProfileQuestion) {
  return (q.metadata as { source?: string } | null)?.source === 'problem_bank';
}

function competencyCovered(
  competency: JobProfileCompetency,
  questions: JobProfileQuestion[],
): boolean {
  const needle = competency.name.toLowerCase();
  return questions.some((q) => {
    const meta = q.metadata as Record<string, unknown> | null;
    const tags = [meta?.competency, meta?.topic, meta?.difficulty].filter(Boolean).map(String);
    return q.prompt.toLowerCase().includes(needle) || tags.some((t) => t.toLowerCase().includes(needle));
  });
}

function roundWeightPct(index: number, total: number): number {
  if (total <= 0) return 0;
  const base = Math.floor(100 / total);
  return index === total - 1 ? 100 - base * (total - 1) : base;
}

export function RoundConfigurationView(props: Props) {
  const { stages, competencies, questions, aiBusy } = props;
  const [activeStageKey, setActiveStageKey] = useState<string | null>(stages[0]?.stage_key ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [localSavedStages, setLocalSavedStages] = useState<Set<string>>(new Set());
  const savedStages = props.savedStages ?? localSavedStages;
  const setSavedStages = props.onSavedStagesChange ?? setLocalSavedStages;
  const [dragQIdx, setDragQIdx] = useState<number | null>(null);
  const [aiWeights, setAiWeights] = useState(true);
  const [justSaved, setJustSaved] = useState(false);

  const applyAiCompetencies = (
    suggestions: Array<{ id?: string; name: string; category: string; weight_pct?: number; target_score?: number }>,
    replace = false,
  ) => {
    if (!activeStageIdResolved) return;
    const stageId = activeStageIdResolved;
    let next = replace ? competencies.filter(c => c.stage_id !== stageId) : [...competencies];
    for (const s of suggestions) {
      if (!next.some((existing) => existing.stage_id === stageId && existing.name.toLowerCase() === s.name.toLowerCase())) {
        next.push({
          id: s.id ?? `ai-${Date.now()}-${Math.random()}`,
          stage_id: stageId,
          name: s.name,
          category: (s.category as 'hard' | 'soft') ?? 'hard',
          target_score: s.target_score ?? 8,
          weight_pct: s.weight_pct ?? 0,
          sort_order: next.length,
        });
      } else if (s.weight_pct != null) {
        next = next.map((existing) =>
          existing.stage_id === stageId && existing.name.toLowerCase() === s.name.toLowerCase()
            ? { ...existing, weight_pct: s.weight_pct! }
            : existing,
        );
      }
    }
    props.onCompetenciesChange(next);
  };

  const aiRubricMutation = useMutation({
    mutationFn: () => suggestCompetencies(props.profileId, activeStage?.stage_type),
    onSuccess: (data) => {
      if (data.suggestions?.length) {
        let runningTotal = 0;
        data.suggestions.forEach((s: any, i: number) => {
          if (s.weight_pct != null) {
            if (i === data.suggestions.length - 1) {
              s.weight_pct = Math.max(0, targetRubricWeight - runningTotal);
            } else {
              const scaled = Math.round(s.weight_pct * (targetRubricWeight / 100.0));
              s.weight_pct = scaled;
              runningTotal += scaled;
            }
          }
        });
        applyAiCompetencies(data.suggestions, true);
      }
    },
  });

  const aiBalanceMutation = useMutation({
    mutationFn: () => suggestRubricWeights(props.profileId),
    onSuccess: (data) => {
      if (data.suggestions) {
        const nextList = [...competencies];
        let runningTotal = 0;
        const matches: any[] = [];

        data.suggestions.forEach((w: any) => {
          const match = nextList.find(
            (c) =>
              c.stage_id === activeStageIdResolved &&
              c.name.toLowerCase() === w.name.toLowerCase()
          );
          if (match) {
            matches.push({ match, w });
          }
        });

        matches.forEach(({ match, w }, index) => {
          if (index === matches.length - 1) {
            match.weight_pct = Math.max(0, targetRubricWeight - runningTotal);
          } else {
            const scaled = Math.round(w.weight_pct * (targetRubricWeight / 100.0));
            match.weight_pct = scaled;
            runningTotal += scaled;
          }
          match.target_score = w.target_score;
        });
        
        props.onCompetenciesChange(nextList);
      }
    },
  });

  useEffect(() => {
    if (!stages.length) {
      setActiveStageKey(null);
      return;
    }
    if (activeStageKey && stages.some((s) => s.stage_key === activeStageKey)) return;
    setActiveStageKey(stages[0]?.stage_key ?? null);
  }, [stages, activeStageKey]);

  const activeStage = stages.find((s) => s.stage_key === activeStageKey) ?? stages[0] ?? null;
  const activeStageIdResolved = activeStage?.id ?? null;

  const isScreening = activeStage?.stage_type === 'screening';
  const isAiScreening =
    activeStage?.stage_type === 'ai_screening' ||
    (/screen/i.test(activeStage?.name || '') && activeStage?.stage_type !== 'coding' && activeStage?.stage_type !== 'project_interview' && activeStage?.stage_type !== 'take_home');
  const isHrVerbal = activeStage?.stage_type === 'hr_verbal' || (activeStage?.stage_type === 'verbal' && activeStage?.mode === 'human_led');
  const isCoding = activeStage?.stage_type === 'coding';
  const isTakeHome = activeStage?.stage_type === 'take_home';
  const isProjectInterview = activeStage?.stage_type === 'project_interview';
  const isAiVerbal =
    !isAiScreening &&
    !isScreening &&
    (activeStage?.stage_type === 'ai_verbal' ||
      (activeStage?.mode === 'ai_led' &&
        !['coding', 'take_home', 'project_interview', 'screening', 'ai_screening', 'hr_verbal', 'panel'].includes(
          activeStage?.stage_type || '',
        )));
  // BND (project_interview) handles its own code vs defense evaluation and does not require the separate rubric table
  const hasRubric = (isScreening && !isAiScreening) || isCoding || isAiVerbal || isTakeHome;

  const targetRubricWeight = useMemo(() => {
    if (isProjectInterview) {
      // Code vs defense weights live on the round; competency rubric is informational (still sums to 100%).
      return 100;
    }
    if (activeStage?.round_config?.include_take_home_verification) {
      const thWeight =
        (activeStage.round_config.take_home_weight_pct as number) ??
        DEFAULT_TAKE_HOME_VERIFICATION_WEIGHT_PCT;
      return Math.max(0, 100 - thWeight);
    }
    return 100;
  }, [isProjectInterview, activeStage?.round_config?.include_take_home_verification, activeStage?.round_config?.take_home_weight_pct]);

  const unassignedCompetencies = useMemo(
    () => competencies.filter((c) => c.stage_id == null),
    [competencies],
  );

  const assignUnassignedToActiveStage = () => {
    if (!activeStageIdResolved || !unassignedCompetencies.length) return;
    const ids = new Set(unassignedCompetencies.map((c) => c.id));
    props.onCompetenciesChange(
      competencies.map((c) => (ids.has(c.id) ? { ...c, stage_id: activeStageIdResolved } : c)),
    );
  };

  const stageCompetencies = useMemo(
    () => (activeStageIdResolved ? competencies.filter(c => c.stage_id === activeStageIdResolved) : []),
    [competencies, activeStageIdResolved],
  );

  const stageQuestions = useMemo(
    () => (activeStageIdResolved ? questionsForStage(questions, activeStageIdResolved) : []),
    [questions, activeStageIdResolved],
  );

  const codingItems = stageQuestions.filter(isProblemQuestion);
  const theoryItems = stageQuestions.filter((q) => !isProblemQuestion(q));

  const coveredCount = competencies.filter((c) => competencyCovered(c, questions)).length;
  const coveragePct = competencies.length
    ? Math.round((coveredCount / competencies.length) * 100)
    : 0;

  const missingCompetencies = competencies.filter((c) => !competencyCovered(c, questions));

  const { questionBankIds, problemBankIds } = useMemo(
    () => bankIdsOnStage(questions, activeStageIdResolved),
    [questions, activeStageIdResolved],
  );

  const existingQuestionBankIds = useMemo(() => [...questionBankIds], [questionBankIds]);
  const existingProblemBankIds = useMemo(() => [...problemBankIds], [problemBankIds]);

  const removeQuestion = (id: string) => {
    props.onQuestionsChange(questions.filter((q) => q.id !== id));
  };

  const reorderStageQuestions = (from: number, to: number) => {
    if (!activeStageIdResolved || from === to) return;
    const stageQs = questionsForStage(questions, activeStageIdResolved);
    const next = [...stageQs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    const other = questions.filter((q) => q.stage_id !== activeStageIdResolved);
    const reordered = next.map((q, i) => ({ ...q, sort_order: i }));
    props.onQuestionsChange([...other, ...reordered]);
  };

  const renderContentCard = (q: JobProfileQuestion, idx: number, isCoding: boolean) => {
    const meta = q.metadata as Record<string, unknown> | null;
    const aiGenerated = Boolean(meta?.ai_generated);
    const difficulty = meta?.difficulty ? String(meta.difficulty) : undefined;
    const topic = meta?.topic ? String(meta.topic) : meta?.questionType ? String(meta.questionType) : null;

    return (
      <div
        key={q.id}
        draggable
        onDragStart={() => setDragQIdx(idx)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          if (dragQIdx != null) reorderStageQuestions(dragQIdx, idx);
          setDragQIdx(null);
        }}
        className={`group relative flex items-center gap-4 rounded-xl p-4 transition-colors ${aiGenerated
            ? 'nexus-glass-lite border border-dashed border-[var(--nexus-secondary)]'
            : 'border border-[var(--assessment-outline-variant)] hover:bg-[var(--assessment-surface-container-low)]'
          }`}
      >
        {aiGenerated ? (
          <span className="absolute right-2 top-2">
            <AssessmentMaterialIcon name="auto_awesome" size={14} className="text-[var(--nexus-secondary)]" />
          </span>
        ) : null}
        <span className="cursor-grab text-[var(--assessment-outline-variant)]">
          <AssessmentMaterialIcon name="drag_indicator" size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className={`font-title-sm text-sm ${aiGenerated ? 'italic' : ''}`}>{q.prompt}</p>
            {isCoding && difficulty ? (
              <span className={`shrink-0 rounded px-1.5 font-mono text-[10px] uppercase ${difficultyBadgeClass(difficulty)}`}>
                {difficulty}
              </span>
            ) : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            {topic ? (
              <span className="rounded border border-[var(--nexus-secondary-container)]/20 bg-[var(--nexus-secondary-container)]/10 px-1.5 text-[11px] text-[var(--assessment-on-surface-variant)]">
                {topic}
              </span>
            ) : null}
            {!isCoding && meta?.competency ? (
              <span className="text-[10px] font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                Competency: {String(meta.competency)}
              </span>
            ) : null}
            {aiGenerated ? (
              <span className="rounded bg-[var(--nexus-secondary)]/10 px-1 text-[9px] font-bold text-[var(--nexus-secondary)]">
                AI SUGGESTED
              </span>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={() => removeQuestion(q.id)}
          className="rounded p-1 opacity-0 transition-all hover:bg-[var(--assessment-error-container)] hover:text-[var(--assessment-error)] group-hover:opacity-100"
        >
          <AssessmentMaterialIcon name="delete" size={20} />
        </button>
      </div>
    );
  };

  return (
    <>
      <div className="grid grid-cols-12 gap-6">
        {/* Left: rounds navigation */}
        <div className="col-span-12 space-y-2 lg:col-span-3">
          <h3 className="mb-4 font-label-caps text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
            Assessment Rounds
          </h3>
          {stages.map((stage, idx) => {
            const count = questionsForStage(questions, stage.id).length;
            const active = stage.stage_key === activeStageKey;
            const persistedConfigured =
              count > 0 ||
              competencies.some((c) => c.stage_id === stage.id) ||
              (stage.round_config != null && Object.keys(stage.round_config).length > 0);
            const isSaved = savedStages.has(stage.stage_key) || persistedConfigured;
            const configured =
              stage.stage_type === 'take_home'
                ? Boolean(
                  parseTakeHomeRoundConfig(stage.round_config).problem.title.trim() ||
                  parseTakeHomeRoundConfig(stage.round_config).problem.description_md.trim(),
                )
                : stage.stage_type === 'project_interview'
                  ? isProjectInterviewConfigured(stage.round_config)
                  : isSaved;
            return (
              <button
                key={`${stage.id}-${idx}`}
                type="button"
                onClick={() => setActiveStageKey(stage.stage_key)}
                className={`relative w-full rounded-xl border p-4 text-left transition-all ${active
                    ? 'border-2 border-[var(--assessment-primary)] bg-[var(--assessment-primary-fixed)]/20'
                    : configured
                      ? 'border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] hover:border-[var(--assessment-primary)]'
                      : 'border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] opacity-60 hover:border-[var(--assessment-primary)]'
                  }`}
              >
                {active ? (
                  <span className="absolute -left-1 top-1/2 h-8 w-1.5 -translate-y-1/2 rounded-full bg-[var(--assessment-primary)]" />
                ) : null}
                <div className="mb-1 flex items-center gap-2">
                  <AssessmentMaterialIcon
                    name={stageIcon(stage)}
                    size={18}
                    className={active ? 'text-[var(--assessment-primary)]' : 'text-[var(--assessment-on-surface-variant)]'}
                    style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
                  />
                  <h4 className={`font-title-sm text-sm ${active ? 'text-[var(--assessment-primary)]' : ''}`}>
                    {stage.name}
                  </h4>
                </div>
                <div className="flex items-center justify-between">
                  <span className={`text-xs ${active ? 'text-[var(--assessment-primary)]' : 'text-[var(--assessment-on-surface-variant)]'}`}>
                    {count > 0 ? `${count} Content Item${count === 1 ? '' : 's'}` : isSaved ? 'Configured' : 'Not Configured'}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${active
                        ? 'bg-[var(--assessment-primary)] text-white'
                        : configured
                          ? 'bg-[var(--assessment-surface-container-high)] text-[var(--assessment-on-surface-variant)]'
                          : 'bg-[var(--assessment-outline-variant)]/30 text-[var(--assessment-on-surface-variant)]'
                      }`}
                  >
                    {active ? 'EDITING' : configured ? 'CONFIGURED' : 'PENDING'}
                  </span>
                </div>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              const stageKey = `stage_${Date.now()}`;
              props.onStagesChange([
                ...stages,
                {
                  id: `new-${Date.now()}`,
                  stage_key: stageKey,
                  name: 'New Round',
                  description: '',
                  sort_order: stages.length,
                  mode: 'ai_led',
                  mandatory: true,
                  stage_type: 'custom',
                },
              ]);
              setActiveStageKey(stageKey);
            }}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--assessment-outline-variant)] py-2 text-sm text-[var(--assessment-on-surface-variant)] transition-all hover:border-[var(--assessment-primary)] hover:text-[var(--assessment-primary)]"
          >
            <AssessmentMaterialIcon name="add_circle" size={20} />
            Add Round
          </button>
        </div>

        {/* Center: active round content */}
        <div className="col-span-12 space-y-6 lg:col-span-9">
          <div className="overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] shadow-sm">
            <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/30 p-4">
              <div>
                <h3 className="flex items-center gap-2 font-headline-md text-lg font-bold">
                  {isCoding ? (
                    <Code2 className="h-5 w-5 text-[var(--color-primary)]" />
                  ) : (
                    <AssessmentMaterialIcon name={activeStage ? stageIcon(activeStage) : 'assignment'} />
                  )}
                  {activeStage?.name ?? 'Round'} Configuration
                </h3>
                <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                  Define how questions are sourced and which rubrics are evaluated.
                </p>
              </div>
            </div>

            <div className="space-y-8 p-6">
              {isScreening && (
                <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-6 text-center">
                  <AssessmentMaterialIcon name="description" size={32} className="mx-auto mb-2 text-[var(--assessment-on-surface-variant)]" />
                  <h4 className="font-title-sm text-sm font-bold text-[var(--assessment-on-surface)]">Resume Screening</h4>
                  <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">No configuration required for screening. The AI will shortlist candidates based on their resumes.</p>
                </div>
              )}

              {isAiScreening && activeStage && (
                <AiScreeningRoundConfigForm
                  config={activeStage.round_config}
                  onChange={(config: AiScreeningRoundConfig) => {
                    const next = stages.map((s) =>
                      s.stage_key === activeStage.stage_key
                        ? { ...s, round_config: config as unknown as Record<string, unknown> }
                        : s,
                    );
                    props.onStagesChange(next);
                  }}
                />
              )}

              {isHrVerbal && (
                <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-6 text-center">
                  <AssessmentMaterialIcon name="person" size={32} className="mx-auto mb-2 text-[var(--assessment-on-surface-variant)]" />
                  <h4 className="font-title-sm text-sm font-bold text-[var(--assessment-on-surface)]">Human Interview</h4>
                  <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">No configuration required. The human interviewer will evaluate the candidate.</p>
                </div>
              )}

              {isTakeHome && (
                <TakeHomeRoundConfigForm
                  config={activeStage.round_config}
                  onChange={(config) => {
                    if (!activeStage) return;
                    const next = stages.map((s) =>
                      s.stage_key === activeStage.stage_key
                        ? { ...s, round_config: config as unknown as Record<string, unknown> }
                        : s,
                    );
                    props.onStagesChange(next);
                    props.onRoundConfigChange?.(activeStage.stage_key, config);
                  }}
                />
              )}

              {isProjectInterview && activeStage && (
                <ProjectInterviewRoundConfigForm
                  config={activeStage.round_config}
                  onChange={(config) => {
                    const next = stages.map((s) =>
                      s.stage_key === activeStage.stage_key
                        ? { ...s, round_config: config as unknown as Record<string, unknown> }
                        : s,
                    );
                    props.onStagesChange(next);
                  }}
                />
              )}

                {(isAiVerbal || isCoding) && (
                  <>
                    {/* Question Strategy Section */}
                    <div className="space-y-4">
                      <div>
                        <h4 className="font-title-sm text-sm font-bold text-[var(--assessment-on-surface)] uppercase tracking-wide">
                          1. Question Strategy
                        </h4>
                        <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                          How should the AI engine source questions for this round?
                        </p>
                      </div>

                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {(isCoding ? [
                          { id: 'bank_only', title: <span className="flex items-center gap-2">Problem Bank <span className="rounded bg-[var(--color-primary)] px-1.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">RECOMMENDED</span></span>, desc: 'AI chooses dynamically from curated Problem Bank based on role attributes.' },
                          { id: 'manual', title: 'Hardcoded (Manual)', desc: 'Manually select specific problems from the repository for every candidate.' }
                        ] : [
                          { id: 'fully_dynamic', title: 'Fully Dynamic', desc: 'AI generates 100% of questions JIT based on candidate CV.' },
                          { id: 'bank_only', title: 'Bank Only', desc: 'AI fetches matching questions from the Question Bank.' },
                          { id: 'hybrid', title: 'Hybrid', desc: 'Mix of Bank questions and Dynamic CV-based questions.' },
                          { id: 'manual', title: 'Hardcoded (Manual)', desc: 'Manually select specific fixed questions from the Bank.' }
                        ]).map((strat) => (
                          <label
                            key={strat.id}
                            className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition-all ${(activeStage?.round_config?.question_strategy ?? 'fully_dynamic') === strat.id
                                ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary-fixed)]/10 ring-1 ring-[var(--assessment-primary)]'
                                : 'border-[var(--assessment-outline-variant)] hover:bg-[var(--assessment-surface-container-low)]'
                              }`}
                          >
                            <input
                              type="radio"
                              name="question_strategy"
                              className="mt-0.5 accent-[var(--assessment-primary)]"
                              checked={(activeStage?.round_config?.question_strategy ?? 'fully_dynamic') === strat.id}
                              onChange={() => {
                                if (!activeStage) return;
                                const nextConfig = { ...(activeStage.round_config as Record<string, unknown>), question_strategy: strat.id };
                                const next = stages.map((s) => s.stage_key === activeStage.stage_key ? { ...s, round_config: nextConfig } : s);
                                props.onStagesChange(next);
                              }}
                            />
                            <div>
                              <div className="font-semibold text-sm">{strat.title}</div>
                              <div className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">{strat.desc}</div>
                            </div>
                          </label>
                        ))}
                      </div>
                      {isCoding && activeStage?.round_config?.question_strategy === 'bank_only' && (
                        <div className="mt-4 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-4">
                          <label className="block text-sm font-semibold text-[var(--assessment-on-surface)]">
                            Problems per candidate
                          </label>
                          <p className="mb-3 mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                            How many coding vs SQL Problem Bank items should the AI pick for each candidate?
                          </p>
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div>
                              <div className="mb-1 flex items-center justify-between">
                                <label className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                                  Coding problems
                                </label>
                              </div>
                              <div className="relative">
                                <input
                                  type="number"
                                  min="0"
                                  max="8"
                                  className="w-full rounded border border-[var(--assessment-outline-variant)] px-3 py-2 pr-16 text-sm focus:border-[var(--assessment-primary)] focus:outline-none"
                                  value={
                                    (activeStage?.round_config?.coding_problem_count as number | undefined) ??
                                    (activeStage?.round_config?.sql_problem_count != null
                                      ? 0
                                      : ((activeStage?.round_config?.total_problems as number) ?? 3))
                                  }
                                  onChange={(e) => {
                                    if (!activeStage) return;
                                    const raw = parseInt(e.target.value, 10);
                                    const coding_problem_count = Number.isFinite(raw)
                                      ? Math.min(8, Math.max(0, raw))
                                      : 0;
                                    const sql_problem_count =
                                      (activeStage.round_config?.sql_problem_count as number | undefined) ?? 0;
                                    const nextConfig = {
                                      ...(activeStage.round_config as Record<string, unknown>),
                                      coding_problem_count,
                                      sql_problem_count,
                                      total_problems: coding_problem_count + sql_problem_count,
                                    };
                                    const next = stages.map((s) =>
                                      s.stage_key === activeStage.stage_key
                                        ? { ...s, round_config: nextConfig }
                                        : s,
                                    );
                                    props.onStagesChange(next);
                                  }}
                                />
                                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-medium text-slate-400">
                                  max 8
                                </div>
                              </div>
                            </div>
                            <div>
                              <div className="mb-1 flex items-center justify-between">
                                <label className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                                  SQL problems
                                </label>
                              </div>
                              <div className="relative">
                                <input
                                  type="number"
                                  min="0"
                                  max="8"
                                  className="w-full rounded border border-[var(--assessment-outline-variant)] px-3 py-2 pr-16 text-sm focus:border-[var(--assessment-primary)] focus:outline-none"
                                  value={(activeStage?.round_config?.sql_problem_count as number | undefined) ?? 0}
                                  onChange={(e) => {
                                    if (!activeStage) return;
                                    const raw = parseInt(e.target.value, 10);
                                    const sql_problem_count = Number.isFinite(raw)
                                      ? Math.min(8, Math.max(0, raw))
                                      : 0;
                                    const coding_problem_count =
                                      (activeStage.round_config?.coding_problem_count as number | undefined) ??
                                      (activeStage.round_config?.total_problems as number | undefined) ??
                                      3;
                                    const nextConfig = {
                                      ...(activeStage.round_config as Record<string, unknown>),
                                      coding_problem_count,
                                      sql_problem_count,
                                      total_problems: Number(coding_problem_count) + sql_problem_count,
                                    };
                                    const next = stages.map((s) =>
                                      s.stage_key === activeStage.stage_key
                                        ? { ...s, round_config: nextConfig }
                                        : s,
                                    );
                                    props.onStagesChange(next);
                                  }}
                                />
                                <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[10px] font-medium text-slate-400">
                                  max 8
                                </div>
                              </div>
                            </div>
                          </div>
                          <p className="mt-2 text-[10px] text-[var(--assessment-on-surface-variant)]">
                            Set either to 0 to skip that type.
                          </p>
                        </div>
                      )}
                      {isAiVerbal && activeStage?.round_config?.question_strategy !== 'manual' && (
                        <div className="mt-4 grid grid-cols-1 gap-4 sm:flex-row sm:items-start sm:justify-between rounded-xl border border-[var(--assessment-outline-variant)] p-4 bg-[var(--assessment-surface-container-lowest)]">

                          {activeStage?.round_config?.question_strategy === 'hybrid' && (
                            <div>
                              <label className="block text-sm font-semibold text-[var(--assessment-on-surface)]">
                                Dynamic / Bank Ratio
                              </label>
                              <p className="mb-2 text-xs text-[var(--assessment-on-surface-variant)]">
                                Percentage of questions generated dynamically from the CV.
                              </p>
                              <div className="flex items-center gap-3">
                                <input
                                  type="range"
                                  min="10"
                                  max="90"
                                  step="10"
                                  className="w-full accent-[var(--assessment-primary)]"
                                  value={(activeStage?.round_config?.dynamic_ratio_pct as number) ?? 50}
                                  onChange={(e) => {
                                    if (!activeStage) return;
                                    const nextConfig = { ...(activeStage.round_config as Record<string, unknown>), dynamic_ratio_pct: parseInt(e.target.value, 10) || 50 };
                                    const next = stages.map((s) => s.stage_key === activeStage.stage_key ? { ...s, round_config: nextConfig } : s);
                                    props.onStagesChange(next);
                                  }}
                                />
                                <span className="text-sm font-bold text-[var(--assessment-primary)] min-w-[3ch]">
                                  {(activeStage?.round_config?.dynamic_ratio_pct as number) ?? 50}%
                                </span>
                              </div>
                              <div className="mt-1 flex justify-between text-[10px] text-[var(--assessment-on-surface-variant)]">
                                <span>More Bank</span>
                                <span>More Dynamic</span>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {isAiVerbal && stages.findIndex(s => s.stage_type === 'take_home') !== -1 && (
                      <div className="mt-6 rounded-xl border border-[var(--assessment-outline-variant)] p-4 bg-[var(--assessment-surface-container-lowest)]">
                        <div className="flex items-center justify-between">
                          <div>
                            <h4 className="font-title-sm text-sm font-bold text-[var(--assessment-on-surface)]">
                              Take-Home Assessment Verification
                            </h4>
                            <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                              Optionally allocate a portion of the total rubric weight to verify the candidate's Take-Home submission.
                            </p>
                          </div>
                          <NexusToggleSwitch
                            checked={Boolean(activeStage?.round_config?.include_take_home_verification)}
                            onChange={(checked) => {
                              if (!activeStage) return;
                              const nextConfig: Record<string, unknown> = {
                                ...(activeStage.round_config as Record<string, unknown>),
                                include_take_home_verification: checked,
                              };
                              if (checked) {
                                // Persist default so UI/runtime never diverge (display 20 vs stored unsetâ†’0).
                                if (
                                  nextConfig.take_home_weight_pct === undefined ||
                                  nextConfig.take_home_weight_pct === null
                                ) {
                                  nextConfig.take_home_weight_pct =
                                    DEFAULT_TAKE_HOME_VERIFICATION_WEIGHT_PCT;
                                }
                              }
                              const next = stages.map((s) =>
                                s.stage_key === activeStage.stage_key
                                  ? { ...s, round_config: nextConfig }
                                  : s,
                              );
                              props.onStagesChange(next);
                            }}
                          />
                        </div>
                        {Boolean(activeStage?.round_config?.include_take_home_verification) && (
                          <div className="mt-4 border-t border-[var(--assessment-outline-variant)] pt-4">
                            <label className="block text-sm font-semibold text-[var(--assessment-on-surface)]">
                              Verification Rubric Weight %
                            </label>
                            <div className="mt-2 flex items-center gap-3">
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  className="w-24 rounded border border-[var(--assessment-outline-variant)] px-3 py-1.5 text-sm focus:border-[var(--assessment-primary)] focus:outline-none"
                                  value={
                                    (activeStage?.round_config?.take_home_weight_pct as number) ??
                                    DEFAULT_TAKE_HOME_VERIFICATION_WEIGHT_PCT
                                  }
                                  onChange={(e) => {
                                    if (!activeStage) return;
                                    const parsed = parseInt(e.target.value, 10);
                                    const nextConfig = {
                                      ...(activeStage.round_config as Record<string, unknown>),
                                      take_home_weight_pct: Number.isFinite(parsed)
                                        ? Math.max(0, Math.min(100, parsed))
                                        : DEFAULT_TAKE_HOME_VERIFICATION_WEIGHT_PCT,
                                    };
                                    const next = stages.map((s) =>
                                      s.stage_key === activeStage.stage_key
                                        ? { ...s, round_config: nextConfig }
                                        : s,
                                    );
                                    props.onStagesChange(next);
                                  }}
                                />
                                <span className="text-xs text-[var(--assessment-on-surface-variant)]">
                                  This weight will be factored into the total Technical Interview score. The remaining weight will be distributed among the competencies below.
                                </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {hasRubric && unassignedCompetencies.length > 0 && (
                  <div className="mt-6 rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-900">
                    <p className="font-semibold">
                      {unassignedCompetencies.length} saved rubric
                      {unassignedCompetencies.length === 1 ? ' is' : 's are'} saved at profile level
                    </p>
                    <p className="mt-1">
                      {unassignedCompetencies
                        .map((c) => `${c.name} (${Number(c.weight_pct.toFixed(2))}%)`)
                        .join(', ')}
                    </p>
                    <p className="mt-1 text-amber-800">
                      This profile was configured before rubrics became per-round. Assign them to the round
                      they belong to; once any round has its own rubric, profile-level rubrics are replaced.
                    </p>
                    <button
                      type="button"
                      onClick={assignUnassignedToActiveStage}
                      className="mt-3 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700"
                    >
                      Assign to {activeStage?.name?.trim() || 'this round'}
                    </button>
                  </div>
                )}

                {/* Competency Rubric Section */}
                {hasRubric && (
                  <div className="space-y-4 pt-6 border-t border-[var(--assessment-outline-variant)]">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-3">
                          <h4 className="font-title-sm text-sm font-bold text-[var(--assessment-on-surface)] uppercase tracking-wide">
                            2. Competency Rubric
                          </h4>
                          <div className="rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-2 py-0.5 text-[10px] font-bold text-[var(--assessment-on-surface-variant)] uppercase tracking-wider">
                            Total Weight: <span className={
                              Math.round(stageCompetencies.reduce((sum, c) => sum + c.weight_pct, 0)) === targetRubricWeight
                                ? 'text-green-600'
                                : 'text-[var(--assessment-primary)]'
                            }>{Number(stageCompetencies.reduce((sum, c) => sum + c.weight_pct, 0).toFixed(2))}% / {targetRubricWeight}%</span>
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                          Define the skills and score weights evaluated by the AI in this round. The same weights also decide how many primary questions each rubric receives.
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        <button
                          type="button"
                          disabled={aiBusy || aiRubricMutation.isPending}
                          onClick={() => aiRubricMutation.mutate()}
                          className="flex items-center gap-1.5 rounded-sm border border-[var(--color-primary-container)] bg-[var(--color-primary-container)] px-3 py-2 text-xs font-semibold text-[var(--color-on-primary-container)] hover:bg-[var(--color-primary-fixed-dim)] disabled:opacity-50"
                        >
                          <Sparkles className="h-4 w-4" />
                          {aiRubricMutation.isPending ? 'Generating...' : 'AI suggest skills'}
                        </button>
                        <button
                          type="button"
                          disabled={aiBusy || aiBalanceMutation.isPending || !stageCompetencies.length}
                          onClick={() => aiBalanceMutation.mutate()}
                          className="flex items-center gap-1.5 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-xs font-semibold text-[var(--assessment-on-surface-variant)] hover:border-[var(--assessment-primary)] hover:text-[var(--assessment-primary)] disabled:opacity-50"
                        >
                          <Scale className="h-4 w-4" />
                          {aiBalanceMutation.isPending ? 'Balancing...' : 'AI suggest weights'}
                        </button>
                      </div>
                    </div>

                    {isAiVerbal && activeStage ? (
                      <VerbalInterviewBudgetFields
                        rubricCount={stageCompetencies.length}
                        weights={stageCompetencies.map((c) => c.weight_pct ?? 0)}
                        names={stageCompetencies.map((c) => c.name)}
                        roundConfig={(activeStage.round_config as Record<string, unknown> | null) ?? null}
                        onChange={(nextConfig) => {
                          const next = stages.map((s) =>
                            s.stage_key === activeStage.stage_key ? { ...s, round_config: nextConfig } : s,
                          );
                          props.onStagesChange(next);
                        }}
                      />
                    ) : null}

                    <div className="overflow-x-auto rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]">
                      <table className="nexus-table-dense w-full">
                        <thead>
                          <tr className="border-b border-[var(--assessment-outline-variant)]">
                            <th className="font-label-caps text-[var(--assessment-on-surface-variant)]">Competency</th>
                            <th className="font-label-caps text-[var(--assessment-on-surface-variant)]">Target score</th>
                            <th className="text-right font-label-caps text-[var(--assessment-on-surface-variant)]">Weight %</th>
                            <th className="text-right font-label-caps text-[var(--assessment-on-surface-variant)]">Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stageCompetencies.map((c) => (
                            <CompetencyWeightRow
                              key={c.id}
                              name={c.name}
                              category={c.category}
                              targetScore={c.target_score ?? 8}
                              weightPct={c.weight_pct ?? 0}
                              aiIdentified={aiWeights && c.id.startsWith('ai-')}
                              onWeightChange={(val) => {
                                props.onCompetenciesChange(
                                  competencies.map((x) =>
                                    x.id === c.id ? { ...x, weight_pct: val } : x
                                  )
                                );
                              }}
                              onDelete={() => {
                                props.onCompetenciesChange(competencies.filter((x) => x.id !== c.id));
                              }}
                            />
                          ))}
                          {stageCompetencies.length === 0 && (
                            <tr>
                              <td colSpan={4} className="py-4 text-center text-xs italic text-[var(--assessment-on-surface-variant)]">
                                No rubrics defined. Use AI to suggest skills or add from library.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <div className="flex rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] overflow-hidden focus-within:border-[var(--assessment-primary)] focus-within:ring-1 focus-within:ring-[var(--assessment-primary)]">
                          <input
                            id="custom-skill-input"
                            type="text"
                            placeholder="Type custom skill(s) separated by commas..."
                            className="w-64 border-none px-3 py-1.5 text-sm focus:outline-none focus:ring-0"
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                const input = e.currentTarget;
                                const val = input.value;
                                if (!val.trim()) return;
                                const newSkills = val.split(',').map(s => s.trim()).filter(Boolean);
                                if (!newSkills.length) return;
                                
                                const newComps = newSkills.map((skillName, i) => ({
                                  id: `man-${Date.now()}-${i}`,
                                  stage_id: activeStageIdResolved,
                                  name: skillName,
                                  category: 'hard' as const,
                                  target_score: 8,
                                  weight_pct: 0,
                                  sort_order: competencies.length + i,
                                }));
                                
                                props.onCompetenciesChange([...competencies, ...newComps]);
                                input.value = '';
                              }
                            }}
                          />
                          <button
                            type="button"
                            className="bg-[var(--assessment-surface-container-high)] px-3 py-1.5 text-xs font-bold text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-outline-variant)]/30 hover:text-[var(--assessment-primary)] transition-colors border-l border-[var(--assessment-outline-variant)]"
                            onClick={() => {
                              const input = document.getElementById('custom-skill-input') as HTMLInputElement;
                              if (!input) return;
                              const val = input.value;
                              if (!val.trim()) return;
                              const newSkills = val.split(',').map(s => s.trim()).filter(Boolean);
                              if (!newSkills.length) return;
                              
                              const newComps = newSkills.map((skillName, i) => ({
                                id: `man-${Date.now()}-${i}`,
                                stage_id: activeStageIdResolved,
                                name: skillName,
                                category: 'hard' as const,
                                target_score: 8,
                                weight_pct: 0,
                                sort_order: competencies.length + i,
                              }));
                              
                              props.onCompetenciesChange([...competencies, ...newComps]);
                              input.value = '';
                            }}
                          >
                            Add
                          </button>
                        </div>
                        <select
                          value=""
                          onChange={(e) => {
                            const selectedName = e.target.value;
                            if (!selectedName) return;
                            props.onCompetenciesChange([
                              ...competencies,
                              {
                                id: `lib-${Date.now()}`,
                                stage_id: activeStageIdResolved,
                                name: selectedName,
                                category: 'hard' as const,
                                target_score: 8,
                                weight_pct: 0,
                                sort_order: competencies.length,
                              },
                            ]);
                          }}
                          className="rounded border border-[var(--assessment-primary)] bg-[var(--assessment-surface-container)] px-3 py-1.5 text-sm font-semibold text-[var(--assessment-primary)]"
                        >
                          <option value="">+ Add from Library</option>
                          {isScreening && (
                            <optgroup label="Screening & General">
                              <option value="Keyword & Tech Stack Match">Keyword & Tech Stack Match</option>
                              <option value="Work Experience Relevance">Work Experience Relevance</option>
                              <option value="Education & Certifications">Education & Certifications</option>
                              <option value="Project Quality">Project Quality</option>
                              <option value="Tenure & Stability">Tenure & Stability</option>
                            </optgroup>
                          )}
                          {isCoding && (
                            <optgroup label="Coding & Technical">
                              <option value="Code Correctness">Code Correctness</option>
                              <option value="Algorithm Efficiency">Algorithm Efficiency</option>
                              <option value="Code Readability & Style">Code Readability & Style</option>
                              <option value="Edge Case Handling">Edge Case Handling</option>
                              <option value="Modular Design & Reusability">Modular Design & Reusability</option>
                              <option value="React">React</option>
                              <option value="Angular">Angular</option>
                              <option value="Vue">Vue</option>
                              <option value="Node.js">Node.js</option>
                              <option value="Python">Python</option>
                              <option value="Java">Java</option>
                              <option value="C++">C++</option>
                              <option value="C#">C#</option>
                              <option value="Spring Boot">Spring Boot</option>
                              <option value="Django">Django</option>
                              <option value="System Design">System Design</option>
                              <option value="Database / SQL">Database / SQL</option>
                              <option value="AWS / Cloud">AWS / Cloud</option>
                              <option value="Docker / Kubernetes">Docker / Kubernetes</option>
                            </optgroup>
                          )}
                          {isAiVerbal && (
                            <>
                              <optgroup label="Technical & Frameworks">
                                <option value="React">React</option>
                                <option value="Angular">Angular</option>
                                <option value="Vue">Vue</option>
                                <option value="Python">Python</option>
                                <option value="Node.js">Node.js</option>
                                <option value="Java">Java</option>
                                <option value="C++">C++</option>
                                <option value="C#">C#</option>
                                <option value="Spring Boot">Spring Boot</option>
                                <option value="Django">Django</option>
                                <option value="AWS / Cloud">AWS / Cloud</option>
                                <option value="Docker / Kubernetes">Docker / Kubernetes</option>
                                <option value="SQL / MongoDB">SQL / MongoDB</option>
                                <option value="System Design">System Design</option>
                              </optgroup>
                              <optgroup label="Behavioral & Communication">
                                <option value="Spoken Communication">Spoken Communication</option>
                                <option value="Concept Articulation">Concept Articulation</option>
                                <option value="Spontaneous Problem Solving">Spontaneous Problem Solving</option>
                                <option value="Leadership & Mentorship">Leadership & Mentorship</option>
                              </optgroup>
                            </>
                          )}
                          {isTakeHome && (
                            <optgroup label="Take-Home Projects">
                              <option value="Code Quality & Readability">Code Quality & Readability</option>
                              <option value="Architecture & System Design">Architecture & System Design</option>
                              <option value="Testing & Test Coverage">Testing & Test Coverage</option>
                              <option value="Documentation & README">Documentation & README</option>
                              <option value="Requirement Fulfillment">Requirement Fulfillment</option>
                              <option value="Performance & Optimization">Performance & Optimization</option>
                              <option value="Security Best Practices">Security Best Practices</option>
                            </optgroup>
                          )}
                          {isProjectInterview && (
                            <optgroup label="Build & Defend">
                              <option value="Tech Stack Understanding">Tech Stack Understanding</option>
                              <option value="Business Logic & Roles">Business Logic & Roles</option>
                              <option value="Project Setup & Tooling">Project Setup & Tooling</option>
                              <option value="Architecture Decisions">Architecture Decisions</option>
                              <option value="Ownership & Authenticity">Ownership & Authenticity</option>
                              <option value="Spoken Communication">Spoken Communication</option>
                            </optgroup>
                          )}
                        </select>
                      </div>
                    </div>
                  </div>
                )}

                {/* Legacy UI: Only show if strategy is Manual */}
                {(activeStage?.round_config?.question_strategy === 'manual') && (
                  <div className="space-y-6 pt-6 border-t border-[var(--assessment-outline-variant)]">
                    <div className="flex items-center justify-between">
                      <h4 className="font-title-sm text-sm font-bold text-[var(--assessment-primary)]">
                        3. Specific Questions (Manual Mode)
                      </h4>
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="flex items-center gap-2 rounded-lg bg-[var(--assessment-primary)] px-3 py-1 text-xs font-bold text-white hover:bg-[var(--assessment-primary-container)]"
                      >
                        <AssessmentMaterialIcon name="add" size={14} />
                        Add Content
                      </button>
                    </div>

                    {codingItems.length > 0 ? (
                      <div className="space-y-2">
                        <h5 className="flex items-center gap-2 text-[10px] font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                          <AssessmentMaterialIcon name="terminal" size={14} />
                          Coding Problems
                        </h5>
                        {codingItems.map((q, idx) => renderContentCard(q, idx, true))}
                      </div>
                    ) : null}

                    {theoryItems.length > 0 ? (
                      <div className="space-y-2">
                        <h5 className="flex items-center gap-2 text-[10px] font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                          <AssessmentMaterialIcon name="forum" size={14} />
                          Behavioral &amp; Theory
                        </h5>
                        {theoryItems.map((q, idx) => renderContentCard(q, codingItems.length + idx, false))}
                      </div>
                    ) : null}

                    {stageQuestions.length === 0 ? (
                      <div className="rounded-xl border-2 border-dashed border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/20 p-8 text-center">
                        <AssessmentMaterialIcon name="add_circle" size={32} className="mx-auto text-[var(--assessment-outline)]" />
                        <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
                          No fixed questions yet. Use Add Content to pick from the bank.
                        </p>
                      </div>
                    ) : null}
                  </div>
                )}

                <div className="pt-6 mt-6 border-t border-[var(--assessment-outline-variant)] flex flex-col sm:flex-row justify-between items-center gap-4">
                  <span className="text-sm font-semibold text-[var(--assessment-on-surface-variant)]">
                    {hasRubric && Math.round(stageCompetencies.reduce((sum, c) => sum + c.weight_pct, 0)) !== targetRubricWeight
                      ? `Total rubric weight must equal ${targetRubricWeight}% to save.`
                      : 'Ready to continue.'}
                  </span>
                  <button
                    type="button"
                    disabled={hasRubric && Math.round(stageCompetencies.reduce((sum, c) => sum + c.weight_pct, 0)) !== targetRubricWeight}
                    className={`flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      justSaved
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[var(--assessment-primary)] text-white hover:bg-[var(--assessment-primary)]/90'
                    }`}
                    onClick={() => {
                      const totalW = Math.round(stageCompetencies.reduce((sum, c) => sum + c.weight_pct, 0));
                      if (hasRubric && totalW !== targetRubricWeight) {
                        alert(`Total weight is ${totalW}%. It must be exactly ${targetRubricWeight}%.`);
                        return;
                      }

                      const n = new Set(savedStages);
                      if (activeStageKey) n.add(activeStageKey);
                      setSavedStages(n);

                      setJustSaved(true);
                      setTimeout(() => setJustSaved(false), 2500);

                      const idx = stages.findIndex(s => s.stage_key === activeStageKey);
                      if (idx < stages.length - 1) {
                        props.onSaveRound?.();
                        setActiveStageKey(stages[idx + 1].stage_key);
                      } else {
                        props.onSaveRound?.();
                        props.onFinish?.();
                      }
                    }}
                  >
                    {justSaved ? (
                      <>
                        <AssessmentMaterialIcon name="check_circle" size={18} />
                        Saved!
                      </>
                    ) : (
                      stages.findIndex(s => s.stage_key === activeStageKey) === stages.length - 1
                        ? 'Save Round'
                        : 'Save Round & Continue'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        {/* Right sidebar */}
        <div className="col-span-12 space-y-6 lg:col-span-3">

          <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/50 p-4">
            <h4 className="mb-2 text-[10px] font-bold uppercase text-[var(--assessment-on-surface-variant)]">
              Round Weightage
            </h4>
            <div className="space-y-2">
              {stages.map((stage, idx) => {
                const pct = roundWeightPct(idx, stages.length);
                const active = stage.stage_key === activeStageKey;
                return (
                  <div
                    key={stage.id}
                    className={`flex items-center justify-between text-sm ${active ? 'font-bold text-[var(--assessment-primary)]' : ''}`}
                  >
                    <span>{stage.name}</span>
                    <span className="font-mono text-xs">{pct}%</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      

      <RoundQuestionProblemPicker
        open={pickerOpen}
        mode="drawer"
        profileId={props.profileId}
        stageId={activeStageIdResolved}
        roundName={activeStage?.name}
        roundStageType={activeStage?.stage_type}
        competencies={competencies.map((c) => c.name)}
        existingQuestionBankIds={existingQuestionBankIds}
        existingProblemBankIds={existingProblemBankIds}
        onClose={() => setPickerOpen(false)}
        onAddQuestions={(rows) => {
          props.onAddQuestions(rows, activeStageIdResolved);
          setPickerOpen(false);
        }}
        onAddProblems={(rows) => {
          props.onAddProblems(rows, activeStageIdResolved);
          setPickerOpen(false);
        }}
        onAddContent={({ questions, problems }) => {
          if (props.onAddContent) {
            props.onAddContent(questions, problems, activeStageIdResolved);
          } else {
            if (questions.length) props.onAddQuestions(questions, activeStageIdResolved);
            if (problems.length) props.onAddProblems(problems, activeStageIdResolved);
          }
          setPickerOpen(false);
        }}
      />
    </>
  );
}

function VerbalInterviewBudgetFields(props: {
  rubricCount: number;
  weights: number[];
  names: string[];
  roundConfig: Record<string, unknown> | null;
  onChange: (next: Record<string, unknown>) => void;
}) {
  const config = props.roundConfig ?? {};
  const savedMin = config[VERBAL_MIN_PRIMARY_KEY];
  const savedMax = config[VERBAL_MAX_TOTAL_KEY];
  const fallbackMin = Math.max(props.rubricCount, 1);
  const displayMin = typeof savedMin === 'number' ? savedMin : fallbackMin;
  const displayMax = typeof savedMax === 'number' ? savedMax : displayMin;
  const savedDuration = config[VERBAL_DURATION_KEY];
  const shapeError = verbalBudgetShapeError(displayMin, displayMax);
  const budgetSaved = savedMin != null || savedMax != null;
  const coverageError = budgetSaved || props.rubricCount > 0
    ? verbalBudgetCoverageError(displayMin, props.rubricCount)
    : null;
  const durationError = verbalDurationError(savedDuration);
  const error = shapeError || coverageError || durationError;
  const allocation = props.rubricCount > 0 && !shapeError && !coverageError
    ? allocatePrimaryQuestions(props.weights, displayMin)
    : null;
  const followups = Math.max(0, displayMax - displayMin);

  const write = (minimum: number, maximum: number, duration: number | null) => {
    const next: Record<string, unknown> = {
      ...config,
      [VERBAL_MIN_PRIMARY_KEY]: minimum,
      [VERBAL_MAX_TOTAL_KEY]: maximum,
    };
    if (duration == null) delete next[VERBAL_DURATION_KEY];
    else next[VERBAL_DURATION_KEY] = duration;
    props.onChange(next);
  };

  return (
    <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-4">
      <h5 className="text-sm font-bold text-[var(--assessment-on-surface)]">Interview question budget</h5>
      <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
        Set how many primary questions the interview must attempt, and the maximum including follow-ups.
        Categories are chosen from the role, each rubric, and the candidate resume. Extra room is kept for follow-ups and is not filled with extra primary questions.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
          Minimum primary questions
          <input
            type="number"
            min={1}
            max={40}
            className="mt-1 w-full rounded border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)]"
            value={displayMin}
            onChange={(event) => {
              const raw = Number.parseInt(event.target.value, 10);
              if (!Number.isFinite(raw)) return;
              write(raw, displayMax, typeof savedDuration === 'number' ? savedDuration : null);
            }}
          />
        </label>
        <label className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
          Maximum total questions
          <input
            type="number"
            min={1}
            max={40}
            className="mt-1 w-full rounded border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)]"
            value={displayMax}
            onChange={(event) => {
              const raw = Number.parseInt(event.target.value, 10);
              if (!Number.isFinite(raw)) return;
              write(displayMin, raw, typeof savedDuration === 'number' ? savedDuration : null);
            }}
          />
        </label>
        <label className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
          Duration limit (optional)
          <input
            type="number"
            min={10}
            max={50}
            placeholder="10â€“50 min"
            className="mt-1 w-full rounded border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)]"
            value={typeof savedDuration === 'number' ? savedDuration : ''}
            onChange={(event) => {
              if (event.target.value.trim() === '') {
                write(displayMin, displayMax, null);
                return;
              }
              const raw = Number.parseInt(event.target.value, 10);
              if (!Number.isFinite(raw)) return;
              write(displayMin, displayMax, raw);
            }}
          />
        </label>
      </div>
      {error ? (
        <p className="mt-2 text-xs font-semibold text-red-600">{error}</p>
      ) : (
        <p className="mt-2 text-xs text-[var(--assessment-on-surface-variant)]">
          {displayMin} primary {displayMin === 1 ? 'question' : 'questions'}, up to {followups} follow-up{followups === 1 ? '' : 's'}.
          {savedMin == null ? ' Shown until you edit it; nothing is saved yet.' : ''}
        </p>
      )}
      {Array.isArray(allocation) ? (
        <ul className="mt-2 space-y-1 text-xs text-[var(--assessment-on-surface)]">
          {props.names.map((name, index) => (
            <li key={`${name}-${index}`}>
              {name}: {allocation[index]} primary {allocation[index] === 1 ? 'question' : 'questions'} ({props.weights[index]}%)
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
