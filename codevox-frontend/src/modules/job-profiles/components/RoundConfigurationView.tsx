'use client';

import { useMemo, useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Code2, Sparkles, Scale } from 'lucide-react';
import { CompetencyWeightRow } from '@/modules/job-profiles/components/CompetencyWeightRow';
import { suggestCompetencies, suggestRubricWeights } from '@/modules/job-profiles/lib/job-profiles-api';
import {
  MERGE_SCREENING_VERBAL_KEY,
  VERBAL_MIN_PRIMARY_KEY,
  VERBAL_MAX_TOTAL_KEY,
  VERBAL_DURATION_KEY,
  verbalBudgetShapeError,
  verbalBudgetCoverageError,
  verbalDurationError,
  allocatePrimaryQuestions,
} from '@/modules/job-profiles/lib/verbal-interview-budget';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { RoundQuestionProblemPicker } from '@/modules/job-profiles/components/RoundQuestionProblemPicker';
import { ProjectInterviewRoundConfigForm } from '@/modules/job-profiles/components/project-interview/ProjectInterviewRoundConfigForm';
import { AiScreeningRoundConfigForm } from '@/modules/job-profiles/components/AiScreeningRoundConfigForm';


import {
  defaultAiScreeningRoundConfig,
  type AiScreeningRoundConfig,
} from '@/modules/job-profiles/lib/ai-screening-round.types';
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
  onRoundConfigChange?: (stageKey: string, config: any) => void;
  onSaveRound?: () => void;
  onFinish?: () => void;
  seniorityLevel?: string | null;
  savedStages?: Set<string>;
  onSavedStagesChange?: (savedStages: Set<string>) => void;
};


export function getFriendlyStageName(stage?: JobProfileStage | null): string {
  if (!stage) return 'Round';
  if (stage.stage_type === 'coding') return 'Coding Round';
  if (stage.stage_type === 'ai_verbal' || stage.stage_type === 'screening') return 'Interview Round';
  if (stage.stage_type === 'ai_screening') return 'AI Screening';
  if (stage.stage_type === 'hr_verbal') return 'HR Verbal Interview';
  if (stage.stage_type === 'project_interview') return 'Build & Defend';
  return stage.name || 'Round';
}

function stageIcon(stage: JobProfileStage): string {
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
  const [justSaved, setJustSaved] = useState(false);
  const [aiWeights, setAiWeights] = useState(true);
  const [newTopicName, setNewTopicName] = useState('');
  const [newTopicCategory, setNewTopicCategory] = useState<'hard' | 'soft'>('hard');

  const applyAiCompetencies = (
    suggestions: Array<{ id?: string; name: string; category?: string; weight_pct?: number; target_score?: number }>,
    replace = false,
  ) => {
    if (!activeStageIdResolved) return;
    const stageId = activeStageIdResolved;
    let next = replace ? competencies.filter(c => c.stage_id !== stageId) : [...competencies];
    for (const s of suggestions) {
      if (!next.some((existing) => existing.stage_id === stageId && existing.name.toLowerCase() === s.name.toLowerCase())) {
        next.push({
          id: s.id ?? `ai-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
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
              s.weight_pct = Math.max(0, 100 - runningTotal);
            } else {
              const scaled = Math.round(s.weight_pct);
              s.weight_pct = scaled;
              runningTotal += scaled;
            }
          }
        });
        applyAiCompetencies(data.suggestions, true);
        setAiWeights(true);
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
            match.weight_pct = Math.max(0, 100 - runningTotal);
          } else {
            const scaled = Math.round(w.weight_pct);
            match.weight_pct = scaled;
            runningTotal += scaled;
          }
          match.target_score = w.target_score;
        });

        props.onCompetenciesChange(nextList);
        setAiWeights(true);
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
    (/screen/i.test(activeStage?.name || '') && activeStage?.stage_type !== 'coding' && activeStage?.stage_type !== 'project_interview' );
  const isHrVerbal = activeStage?.stage_type === 'hr_verbal' || (activeStage?.stage_type === 'verbal' && activeStage?.mode === 'human_led');
  const isCoding = activeStage?.stage_type === 'coding';
  const isTakeHome = false;
  const isProjectInterview = activeStage?.stage_type === 'project_interview';
  const isAiVerbal =
    !isAiScreening &&
    !isScreening &&
    (activeStage?.stage_type === 'ai_verbal' ||
      (activeStage?.mode === 'ai_led' &&
        !['coding', 'project_interview', 'screening', 'ai_screening', 'hr_verbal', 'panel'].includes(
          activeStage?.stage_type || '',
        )));
  const mergeScreeningVerbal =
    isAiVerbal &&
    Boolean(
      (activeStage?.round_config as Record<string, unknown> | null | undefined)?.[
        MERGE_SCREENING_VERBAL_KEY
      ],
    );
  const hasRubric = isAiVerbal;
  const targetRubricWeight = 100;
  const stageCompetencies = useMemo(
    () => (activeStageIdResolved ? competencies.filter((c) => c.stage_id === activeStageIdResolved) : []),
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

  const handleAddTopic = () => {
    const trimmed = newTopicName.trim();
    if (!trimmed || !activeStageIdResolved) return;
    if (competencies.some((c) => c.stage_id === activeStageIdResolved && c.name.toLowerCase() === trimmed.toLowerCase())) {
      setNewTopicName('');
      return;
    }
    const currentStageCompetencies = competencies.filter((c) => c.stage_id === activeStageIdResolved);
    const newWeight = Math.max(0, 100 - currentStageCompetencies.reduce((sum, c) => sum + (c.weight_pct ?? 0), 0));

    const newComp: JobProfileCompetency = {
      id: `custom-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      stage_id: activeStageIdResolved,
      name: trimmed,
      category: newTopicCategory,
      target_score: 8,
      weight_pct: newWeight > 0 ? newWeight : 10,
      sort_order: competencies.length,
    };
    props.onCompetenciesChange([...competencies, newComp]);
    setNewTopicName('');
  };

  const handleUpdateTopicWeight = (compId: string, weight: number) => {
    props.onCompetenciesChange(
      competencies.map((c) => (c.id === compId ? { ...c, weight_pct: weight } : c))
    );
  };

  const handleUpdateTopicScore = (compId: string, score: number) => {
    props.onCompetenciesChange(
      competencies.map((c) => (c.id === compId ? { ...c, target_score: score } : c))
    );
  };

  const handleDeleteTopic = (compId: string) => {
    props.onCompetenciesChange(competencies.filter((c) => c.id !== compId));
  };

  const handleAutoBalanceWeights = () => {
    if (!activeStageIdResolved || stageCompetencies.length === 0) return;
    const count = stageCompetencies.length;
    const base = Math.floor(100 / count);
    const remainder = 100 - base * count;

    const next = competencies.map((c) => {
      if (c.stage_id !== activeStageIdResolved) return c;
      const idx = stageCompetencies.findIndex((sc) => sc.id === c.id);
      return {
        ...c,
        weight_pct: idx === 0 ? base + remainder : base,
      };
    });
    props.onCompetenciesChange(next);
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
              stage.stage_type === 'project_interview'
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
                    {getFriendlyStageName(stage)}
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
                  {getFriendlyStageName(activeStage)} Configuration
                </h3>
                <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                  Define how questions are sourced and evaluated.
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

              {(isAiScreening || mergeScreeningVerbal) && activeStage && (
                <div className="space-y-3">
                  {mergeScreeningVerbal ? (
                    <div className="rounded-xl border border-[var(--assessment-primary)]/30 bg-[var(--assessment-primary-fixed)]/10 px-4 py-3">
                      <h4 className="text-sm font-bold text-[var(--assessment-on-surface)]">
                        Part 1 — Screening (notice, logistics, behavioural)
                      </h4>
                      <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                        These questions run first in the same voice call, before the technical
                        deep-dive below. Turn topics on/off and fill expected answers as needed.
                      </p>
                    </div>
                  ) : null}
                  <AiScreeningRoundConfigForm
                    config={activeStage.round_config}
                    onChange={(config: AiScreeningRoundConfig) => {
                      const next = stages.map((s) => {
                        if (s.stage_key !== activeStage.stage_key) return s;
                        if (mergeScreeningVerbal) {
                          return {
                            ...s,
                            round_config: {
                              ...(s.round_config ?? {}),
                              ...config,
                              [MERGE_SCREENING_VERBAL_KEY]: true,
                            },
                          };
                        }
                        return {
                          ...s,
                          round_config: config as unknown as Record<string, unknown>,
                        };
                      });
                      props.onStagesChange(next);
                    }}
                  />
                  {mergeScreeningVerbal ? (
                    <div className="border-t border-[var(--assessment-outline-variant)] pt-6">
                      <h4 className="text-sm font-bold uppercase tracking-wide text-[var(--assessment-on-surface)]">
                        Part 2 — Technical verbal
                      </h4>
                      <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                        Question strategy and time budget for the technical half of the call.
                      </p>
                    </div>
                  ) : null}
                </div>
              )}

              {isHrVerbal && (
                <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-6 text-center">
                  <AssessmentMaterialIcon name="person" size={32} className="mx-auto mb-2 text-[var(--assessment-on-surface-variant)]" />
                  <h4 className="font-title-sm text-sm font-bold text-[var(--assessment-on-surface)]">Human Interview</h4>
                  <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">No configuration required. The human interviewer will evaluate the candidate.</p>
                </div>
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
                          Question Strategy
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

                    {/* Rubrics & Topic Competencies Section for Technical Verbal */}
                    {isAiVerbal && (
                      <div className="space-y-4 pt-6 border-t border-[var(--assessment-outline-variant)]">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <h4 className="font-title-sm text-sm font-bold text-[var(--assessment-on-surface)] uppercase tracking-wide">
                                Technical Evaluation Rubrics &amp; Topics
                              </h4>
                              <span className="rounded bg-[var(--assessment-primary)]/10 text-[var(--assessment-primary)] border border-[var(--assessment-primary)]/20 px-2 py-0.5 text-[10px] font-bold uppercase">
                                Active Voice Engine
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                              Define competencies/topics. The AI voice interviewer asks questions and probes candidate responses against each topic listed here.
                            </p>
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => aiRubricMutation.mutate()}
                              disabled={aiRubricMutation.isPending}
                              className="flex items-center gap-1.5 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-3 py-1.5 text-xs font-semibold text-[var(--assessment-on-surface)] transition hover:border-[var(--assessment-primary)] hover:text-[var(--assessment-primary)] disabled:opacity-50"
                            >
                              <Sparkles className="h-3.5 w-3.5 text-[var(--color-primary)]" />
                              {aiRubricMutation.isPending ? 'Generating...' : 'AI Suggest Topics'}
                            </button>

                            {stageCompetencies.length > 1 && (
                              <button
                                type="button"
                                onClick={handleAutoBalanceWeights}
                                className="flex items-center gap-1.5 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-3 py-1.5 text-xs font-semibold text-[var(--assessment-on-surface)] transition hover:border-[var(--assessment-primary)] hover:text-[var(--assessment-primary)]"
                                title="Balance weights equally to 100%"
                              >
                                <Scale className="h-3.5 w-3.5 text-[var(--assessment-on-surface-variant)]" />
                                Balance to 100%
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Add Topic Input Bar */}
                        <div className="flex flex-col sm:flex-row gap-2 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-3">
                          <input
                            type="text"
                            placeholder="Add evaluation topic (e.g. Distributed Systems, SQL Indexing, React Architecture)..."
                            value={newTopicName}
                            onChange={(e) => setNewTopicName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleAddTopic();
                              }
                            }}
                            className="flex-1 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-3 py-2 text-sm text-[var(--assessment-on-surface)] placeholder:text-[var(--assessment-on-surface-variant)]/60 focus:border-[var(--assessment-primary)] focus:outline-none"
                          />
                          <select
                            value={newTopicCategory}
                            onChange={(e) => setNewTopicCategory(e.target.value as 'hard' | 'soft')}
                            className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-3 py-2 text-xs font-medium text-[var(--assessment-on-surface)] focus:border-[var(--assessment-primary)] focus:outline-none"
                          >
                            <option value="hard">Technical (Hard skill)</option>
                            <option value="soft">Architectural / Soft skill</option>
                          </select>
                          <button
                            type="button"
                            onClick={handleAddTopic}
                            disabled={!newTopicName.trim()}
                            className="flex items-center justify-center gap-1.5 rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-xs font-bold text-white transition hover:bg-[var(--assessment-primary)]/90 disabled:opacity-40"
                          >
                            <AssessmentMaterialIcon name="add" size={16} />
                            Add Topic
                          </button>
                        </div>

                        {/* Topics List Table */}
                        {stageCompetencies.length === 0 ? (
                          <div className="rounded-xl border-2 border-dashed border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/20 p-8 text-center">
                            <AssessmentMaterialIcon name="tune" size={32} className="mx-auto text-[var(--assessment-on-surface-variant)]/50" />
                            <p className="mt-2 text-sm font-semibold text-[var(--assessment-on-surface)]">
                              No rubric topics defined yet for this round
                            </p>
                            <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                              Type a topic name above or click &ldquo;AI Suggest Topics&rdquo; to automatically build the question evaluation rubrics.
                            </p>
                          </div>
                        ) : (
                          <div className="overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)]">
                            <table className="w-full text-left text-sm">
                              <thead>
                                <tr className="border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/40 text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                                  <th className="px-4 py-3">Topic / Competency</th>
                                  <th className="px-4 py-3">Target Score (1-10)</th>
                                  <th className="px-4 py-3 text-right">Evaluation Weight (%)</th>
                                  <th className="px-4 py-3 text-right">Action</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-[var(--assessment-outline-variant)]">
                                {stageCompetencies.map((comp) => (
                                  <tr
                                    key={comp.id}
                                    className="transition-colors hover:bg-[var(--assessment-surface-container-low)]/50"
                                  >
                                    <td className="px-4 py-3">
                                      <div className="font-semibold text-sm text-[var(--assessment-on-surface)]">
                                        {comp.name}
                                      </div>
                                      <div className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                                        {comp.category === 'soft' ? 'Architectural / Soft' : 'Technical Skill'}
                                      </div>
                                    </td>
                                    <td className="px-4 py-3">
                                      <div className="flex items-center gap-2">
                                        <input
                                          type="number"
                                          min={1}
                                          max={10}
                                          step={0.5}
                                          value={comp.target_score ?? 8}
                                          onChange={(e) => {
                                            const val = Math.min(10, Math.max(1, Number(e.target.value) || 1));
                                            handleUpdateTopicScore(comp.id, val);
                                          }}
                                          className="w-16 rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-2 py-1 text-center font-mono text-sm text-[var(--assessment-on-surface)] focus:border-[var(--assessment-primary)] focus:outline-none"
                                        />
                                        <span className="text-xs text-[var(--assessment-on-surface-variant)]">/ 10</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                      <div className="flex items-center justify-end gap-1.5 font-mono text-sm">
                                        <input
                                          type="number"
                                          min={0}
                                          max={100}
                                          step={1}
                                          value={comp.weight_pct ?? 0}
                                          onChange={(e) => {
                                            const val = Math.min(100, Math.max(0, Number(e.target.value) || 0));
                                            handleUpdateTopicWeight(comp.id, val);
                                          }}
                                          className="w-16 rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-2 py-1 text-right font-mono text-sm text-[var(--assessment-on-surface)] focus:border-[var(--assessment-primary)] focus:outline-none"
                                        />
                                        <span className="text-xs text-[var(--assessment-on-surface-variant)]">%</span>
                                      </div>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteTopic(comp.id)}
                                        className="rounded p-1.5 text-[var(--assessment-on-surface-variant)] transition hover:bg-[var(--assessment-error-container)]/20 hover:text-rose-500"
                                        title="Remove topic"
                                      >
                                        <AssessmentMaterialIcon name="delete" size={18} />
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>

                            {/* Weight Total Footer */}
                            <div className="flex items-center justify-between border-t border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/30 px-4 py-3">
                              <span className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                                Total Weight Allocation
                              </span>
                              {(() => {
                                const total = Math.round(stageCompetencies.reduce((sum, c) => sum + (c.weight_pct ?? 0), 0));
                                const isValid = total === 100;
                                return (
                                  <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-2">
                                      <div className="h-2 w-28 overflow-hidden rounded-full bg-[var(--assessment-outline-variant)]/30">
                                        <div
                                          className={`h-full transition-all ${
                                            isValid
                                              ? 'bg-emerald-500'
                                              : total > 100
                                                ? 'bg-rose-500'
                                                : 'bg-amber-500'
                                          }`}
                                          style={{ width: `${Math.min(100, total)}%` }}
                                        />
                                      </div>
                                      <span
                                        className={`font-mono text-xs font-bold ${
                                          isValid
                                            ? 'text-emerald-400'
                                            : total > 100
                                              ? 'text-rose-400'
                                              : 'text-amber-400'
                                        }`}
                                      >
                                        {total}% / 100%
                                      </span>
                                    </div>
                                    {!isValid && (
                                      <button
                                        type="button"
                                        onClick={handleAutoBalanceWeights}
                                        className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-300 hover:bg-amber-500/20"
                                      >
                                        Auto-balance
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        )}

                        {/* Verbal Interview Question Budget based on rubrics */}
                        <VerbalInterviewBudgetFields
                          rubricCount={stageCompetencies.length}
                          weights={stageCompetencies.map((c) => c.weight_pct ?? 0)}
                          names={stageCompetencies.map((c) => c.name)}
                          roundConfig={activeStage?.round_config ?? null}
                          onChange={(nextConfig) => {
                            if (!activeStage) return;
                            const next = stages.map((s) =>
                              s.stage_key === activeStage.stage_key
                                ? { ...s, round_config: nextConfig }
                                : s,
                            );
                            props.onStagesChange(next);
                          }}
                        />
                      </div>
                    )}

                  </>
                )}

                {/* Legacy UI: Only show if strategy is Manual */}
                {(activeStage?.round_config?.question_strategy === 'manual') && (
                  <div className="space-y-6 pt-6 border-t border-[var(--assessment-outline-variant)]">
                    <div className="flex items-center justify-between">
                      <h4 className="font-title-sm text-sm font-bold text-[var(--assessment-primary)]">
                        Specific Questions (Manual Mode)
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
                    Ready to continue.
                  </span>
                  <button
                    type="button"
                    disabled={hasRubric && Math.round(stageCompetencies.reduce((sum, c) => sum + (c.weight_pct ?? 0), 0)) !== targetRubricWeight}
                    className={`flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed ${
                      justSaved
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[var(--assessment-primary)] text-white hover:bg-[var(--assessment-primary)]/90'
                    }`}
                    onClick={() => {
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
                    <span>{getFriendlyStageName(stage)}</span>
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
        roundName={getFriendlyStageName(activeStage)}
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
      <h5 className="text-sm font-bold text-[var(--assessment-on-surface)]">Interview Question Budget</h5>
      <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
        Set primary questions the AI interviewer must ask, and maximum questions including follow-ups.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
          Minimum primary questions
          <input
            type="number"
            min={1}
            max={40}
            className="mt-1 w-full rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)]"
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
            className="mt-1 w-full rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)]"
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
            placeholder="10–50 min"
            className="mt-1 w-full rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)]"
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
        <p className="mt-2 text-xs font-semibold text-rose-400">{error}</p>
      ) : (
        <p className="mt-2 text-xs text-[var(--assessment-on-surface-variant)]">
          {displayMin} primary {displayMin === 1 ? 'question' : 'questions'}, up to {followups} follow-up{followups === 1 ? '' : 's'}.
        </p>
      )}
      {Array.isArray(allocation) ? (
        <ul className="mt-2 space-y-1 text-xs text-[var(--assessment-on-surface)]">
          {props.names.map((name, index) => (
            <li key={`${name}-${index}`}>
              <span className="font-semibold text-violet-300">{name}:</span> {allocation[index]} primary {allocation[index] === 1 ? 'question' : 'questions'} ({props.weights[index]}%)
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
