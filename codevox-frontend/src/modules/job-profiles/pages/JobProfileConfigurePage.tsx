'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { JobProfilePhase2Panel } from '@/modules/job-profiles/components/JobProfilePhase2Panel';
import { RoundConfigurationView } from '@/modules/job-profiles/components/RoundConfigurationView';
import {
  defaultTakeHomeRoundConfig,
  type JobStageType,
} from '@/modules/job-profiles/lib/take-home-round.types';
import { defaultProjectInterviewRoundConfig } from '@/modules/job-profiles/lib/project-interview-round.types';
import {
  defaultAiScreeningRoundConfig,
  normalizeAiScreeningRoundConfig,
  validateAiScreeningStages,
} from '@/modules/job-profiles/lib/ai-screening-round.types';
import { questionPlanError } from '@/modules/job-profiles/lib/rubric-question-plan';
import { verbalBudgetSaveError } from '@/modules/job-profiles/lib/verbal-interview-budget';
import {
  biasScreenJobProfile,
  compensationBenchmark,
  generateAiQuestions,
  generateFaq,
  getJobProfile,
  nlEditJobProfile,
  publishJobProfile,
  reorderJobProfileStages,
  suggestCompetencies,
  suggestRubricWeights,
  updateJobProfileCompetencies,
  updateJobProfileQuestions,
  updateJobProfileStages,
  type JobProfileCompetency,
  type JobProfileDetail,
  type JobProfileQuestion,
  type JobProfileStage,
  type ProblemBankProblem,
  type QuestionBankQuestion,
} from '@/modules/job-profiles/lib/job-profiles-api';
import {
  canPublishJobProfile,
  configureStepFromSearchParam,
  isBasicsStepComplete,
  isRubricStepComplete,
  normalizeCompetencyWeights,
  setupPathForProfile,
} from '@/modules/job-profiles/lib/job-profile-setup';

const STAGE_TYPE_OPTIONS: { value: JobStageType; label: string; duration: string }[] = [
  { value: 'ai_screening', label: 'AI Screening', duration: '5 mins' },
  { value: 'screening', label: 'AI Technical Screening', duration: '30 mins (Strict)' },
  { value: 'coding', label: 'Coding Assessment', duration: '60 mins (Strict)' },
  { value: 'ai_verbal', label: 'AI Verbal Interview', duration: '15 mins (Strict)' },
  { value: 'hr_verbal', label: 'HR Verbal Interview', duration: '30 mins' },
  { value: 'take_home', label: 'Take-home Assessment', duration: '48 hours' },
  { value: 'project_interview', label: 'Build & Defend', duration: 'Build window + 20 mins' },
  { value: 'panel', label: 'Panel Interview', duration: '60 mins' },
  { value: 'custom', label: 'Custom Round', duration: '45 mins (Strict)' },
];

const getStageDurationMinutes = (stageType: string): number => {
  switch (stageType) {
    case 'ai_screening':
      return 15;
    case 'screening':
      return 30;
    case 'coding':
      return 60;
    case 'ai_verbal':
      return 45;
    case 'hr_verbal':
      return 30;
    case 'take_home':
      return 120;
    case 'project_interview':
      return 20;
    case 'panel':
      return 60;
    default:
      return 45;
  }
};

const getStageDurationLabel = (stageType: string): string => {
  switch (stageType) {
    case 'screening':
      return '30 mins (Strict)';
    case 'coding':
      return '60 mins (Strict)';
    case 'ai_verbal':
      return '45 mins (Strict)';
    case 'hr_verbal':
      return '30 mins';
    case 'take_home':
      return '48 hours';
    case 'project_interview':
      return 'Build window + 20 mins';
    case 'panel':
      return '60 mins';
    default:
      return '45 mins (Strict)';
  }
};

export function JobProfileConfigurePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = String(params?.id ?? '');
  const queryClient = useQueryClient();

  const detailQuery = useQuery({
    queryKey: ['job-profile', id],
    queryFn: () => getJobProfile(id),
  });

  const [stages, setStages] = useState<JobProfileStage[]>([]);
  const [competencies, setCompetencies] = useState<JobProfileCompetency[]>([]);
  const [questions, setQuestions] = useState<JobProfileQuestion[]>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showAiTip, setShowAiTip] = useState(true);
  const [nlInstruction, setNlInstruction] = useState('');
  const [aiActionPending, setAiActionPending] = useState<string | null>(null);

  const viewStep = configureStepFromSearchParam(searchParams?.get('step') ?? null);

  // Local state is the editing buffer: hydrate it from the server once per profile (after a
  // fresh fetch), never on background refetches, or unsaved edits get overwritten.
  const hydratedForIdRef = useRef<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const syncSeqRef = useRef(0);
  const pendingSyncRef = useRef<Promise<unknown> | null>(null);

  const hydrateFrom = useCallback((detail: JobProfileDetail) => {
    setStages(detail.stages);
    setCompetencies(detail.competencies);
    setQuestions(detail.questions);
  }, []);

  useEffect(() => {
    if (!detailQuery.data || !detailQuery.isFetchedAfterMount || detailQuery.isFetching) return;
    if (hydratedForIdRef.current === id) return;
    hydratedForIdRef.current = id;
    hydrateFrom(detailQuery.data);
    setHydrated(true);
  }, [detailQuery.data, detailQuery.isFetchedAfterMount, detailQuery.isFetching, id, hydrateFrom]);

  useEffect(() => {
    if (!detailQuery.isSuccess || detailQuery.isFetching || !detailQuery.data) return;
    if (!isBasicsStepComplete(detailQuery.data.profile)) {
      router.replace(setupPathForProfile(id, 1));
      return;
    }
  }, [detailQuery.isSuccess, detailQuery.isFetching, detailQuery.data, id, router, viewStep]);

  const goToSetupStep = (step: number) => {
    if (step === 1) router.push(setupPathForProfile(id, 1));
    else if (step === 2) router.push(setupPathForProfile(id, 2));
    else if (step === 3) router.push(setupPathForProfile(id, 3));
  };

  const stagePayload = (list: JobProfileStage[]) =>
    list.map((s) => ({
      stage_key: s.stage_key,
      name: s.name,
      description: s.description,
      mode: s.mode,
      mandatory: s.mandatory,
      stage_type: s.stage_type,
      skip_rules: s.skip_rules ?? null,
      round_config: s.round_config ?? null,
    }));

  const remapQuestionStageIds = (
    qs: JobProfileQuestion[],
    localStages: JobProfileStage[],
    savedStages: JobProfileStage[],
  ) => {
    const keyByLocalId = new Map(localStages.map((s) => [s.id, s.stage_key]));
    const idByKey = new Map(savedStages.map((s) => [s.stage_key, s.id]));
    return qs.map((q) => ({
      stage_id:
        q.stage_id != null
          ? (idByKey.get(keyByLocalId.get(q.stage_id) ?? '') ?? q.stage_id)
          : null,
      kind: q.kind,
      prompt: q.prompt,
      metadata: q.metadata,
    }));
  };

  const remapCompetencyStageIds = (localStages: JobProfileStage[], savedStages: JobProfileStage[]) => {
    const keyByLocalId = new Map(localStages.map((s) => [s.id, s.stage_key]));
    const idByKey = new Map(savedStages.map((s) => [s.stage_key, s.id]));
    setCompetencies((prev) =>
      prev.map((c) => {
        if (c.stage_id == null) return c;
        const nextId = idByKey.get(keyByLocalId.get(c.stage_id) ?? '');
        return nextId && nextId !== c.stage_id ? { ...c, stage_id: nextId } : c;
      }),
    );
  };

  const syncStagesAndQuestions = async (
    localStages: JobProfileStage[],
    localQuestions: JobProfileQuestion[],
  ) => {
    const seq = ++syncSeqRef.current;
    const run = (async () => {
      const savedStages = await updateJobProfileStages(id, stagePayload(localStages));
      const savedQuestions = await updateJobProfileQuestions(
        id,
        remapQuestionStageIds(localQuestions, localStages, savedStages),
      );
      // A newer autosave was issued while this one was in flight; its payload is fresher.
      if (seq === syncSeqRef.current) {
        remapCompetencyStageIds(localStages, savedStages);
        setStages(savedStages);
        setQuestions(savedQuestions);
      }
      return { savedStages, savedQuestions };
    })();
    pendingSyncRef.current = run;
    try {
      return await run;
    } finally {
      if (pendingSyncRef.current === run) pendingSyncRef.current = null;
    }
  };

  const saveAll = async () => {
    if (pendingSyncRef.current) {
      await pendingSyncRef.current.catch(() => undefined);
    }
    syncSeqRef.current += 1;
    const screeningErr = validateAiScreeningStages(
      stages.map((s, i) => ({
        stage_type: s.stage_type,
        sort_order: i,
        round_config: s.round_config,
      })),
    );
    if (screeningErr) throw new Error(screeningErr);

    for (const stage of stages) {
      if (stage.stage_type !== 'ai_verbal') continue;
      const rubricCount = competencies.filter((competency) => competency.stage_id === stage.id).length;
      const budgetError = verbalBudgetSaveError(stage.round_config, rubricCount);
      if (budgetError) throw new Error(budgetError);
    }

    const stagesToSave = stages.map((s, i) =>
      s.stage_type === 'ai_screening'
        ? {
            ...s,
            sort_order: i,
            round_config: normalizeAiScreeningRoundConfig(s.round_config) as unknown as Record<
              string,
              unknown
            >,
          }
        : { ...s, sort_order: i },
    );

    const savedStages = await updateJobProfileStages(id, stagePayload(stagesToSave));
    setStages(savedStages);
    const keyByLocalId = new Map(stagesToSave.map((s) => [s.id, s.stage_key]));
    const idByKey = new Map(savedStages.map((s) => [s.stage_key, s.id]));
    const remappedCompetencies = competencies.map(c => ({
      ...c,
      stage_id: c.stage_id != null ? (idByKey.get(keyByLocalId.get(c.stage_id) ?? '') ?? c.stage_id) : null
    }));
    const savedStageIds = new Set(savedStages.map((s) => s.id));
    const linkedCompetencies = remappedCompetencies.filter(
      (c) => c.stage_id != null && savedStageIds.has(c.stage_id),
    );
    const competenciesToSave = linkedCompetencies.length
      ? linkedCompetencies
      : remappedCompetencies.filter((c) => c.stage_id == null);

    for (const competency of competenciesToSave) {
      if (competency.question_plan == null) continue;
      const planError = questionPlanError(competency.question_plan);
      if (planError) throw new Error(`${competency.name}: ${planError}`);
    }

    const savedCompetencies = await updateJobProfileCompetencies(
      id,
      competenciesToSave.map((c) => ({
        stage_id: c.stage_id,
        name: c.name,
        category: c.category,
        target_score: c.target_score ?? 8,
        weight_pct: c.weight_pct ?? 0,
        question_plan: c.question_plan ?? null,
      })),
    );
    setCompetencies(savedCompetencies);
    const savedQuestions = await updateJobProfileQuestions(
      id,
      remapQuestionStageIds(questions, stagesToSave, savedStages),
    );
    setQuestions(savedQuestions);
  };

  const roundConfigSaveMutation = useMutation({
    mutationFn: (payload: { questions: JobProfileQuestion[]; stages?: JobProfileStage[] }) =>
      syncStagesAndQuestions(payload.stages ?? stages, payload.questions),
    onSuccess: () => {
      setMessage('Round configuration saved.');
      void queryClient.invalidateQueries({ queryKey: ['job-profile', id] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const persistRoundConfig = useCallback(
    (nextQuestions: JobProfileQuestion[], nextStages?: JobProfileStage[]) => {
      if (viewStep !== 3) return;
      roundConfigSaveMutation.mutate({ questions: nextQuestions, stages: nextStages });
    },
    [roundConfigSaveMutation, viewStep],
  );

  const saveMutation = useMutation({
    mutationFn: saveAll,
    onSuccess: () => {
      setMessage('Draft saved.');
      void queryClient.invalidateQueries({ queryKey: ['job-profile', id] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      await saveAll();
      return publishJobProfile(id);
    },
    onSuccess: () => {
      setMessage('Profile published successfully.');
      void queryClient.invalidateQueries({ queryKey: ['job-profile', id] });
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const reorderAfterDrop = useCallback(
    async (from: number, to: number) => {
      if (from === to) return;
      const next = [...stages];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved!);
      if (next.filter((s) => s.stage_type === 'ai_screening').length > 1) {
        setMessage('Only one AI Screening stage is allowed.');
        return;
      }
      setStages(next);
      await reorderJobProfileStages(id, next.map((s) => s.id));
      void queryClient.invalidateQueries({ queryKey: ['job-profile', id] });
    },
    [id, queryClient, stages],
  );

  const weightTotal = competencies.reduce((s, c) => s + c.weight_pct, 0);
  const rubricReady = isRubricStepComplete(competencies);
  const aiStageCount = stages.filter((s) => s.mode === 'ai_led').length;
  const publishReady = canPublishJobProfile({ competencies, questions, stages });

  const applyAiCompetencies = (
    rows: Array<{ name: string; category: string; target_score: number; weight_pct: number }>,
    replace = true,
  ) => {
    const targetStage =
      stages.find(
        (s) =>
          s.stage_type === 'screening' ||
          s.stage_type === 'coding' ||
          s.stage_type === 'ai_verbal' ||
          s.mode === 'ai_led',
      )?.id ??
      stages[0]?.id ??
      null;
    const mapped = rows.map((r, i) => ({
      id: `ai-c-${Date.now()}-${i}`,
      stage_id: targetStage,
      name: r.name,
      category: r.category as 'hard' | 'soft',
      target_score: r.target_score,
      weight_pct: r.weight_pct,
      sort_order: i,
    }));
    const next = normalizeCompetencyWeights(mapped);
    setCompetencies(replace ? next : normalizeCompetencyWeights([...competencies, ...next]));
    setMessage(`AI rubric: ${next.length} competencies (weights total 100%).`);
  };

  const applyAiQuestions = (
    rows: Array<{ prompt: string; kind: string; stage_id?: string | null; metadata?: Record<string, unknown> }>,
    stageId?: string | null,
  ) => {
    const normalize = (value: string) => value.trim().toLowerCase();
    const targetStage = stageId ?? stages[0]?.id ?? null;
    const kept = questions.filter((q) => {
      const aiGenerated = (q.metadata as { ai_generated?: boolean } | null)?.ai_generated;
      if (aiGenerated && q.stage_id === targetStage) return false;
      return true;
    });
    const seen = new Set(kept.map((q) => normalize(q.prompt)));
    const added = rows
      .filter((r) => r.prompt.trim())
      .filter((r) => {
        const key = normalize(r.prompt);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((r, i) => ({
        id: `ai-q-${Date.now()}-${i}`,
        stage_id: r.stage_id ?? targetStage,
        kind: (r.kind as 'anchor' | 'manual' | 'ai_adaptive') ?? 'anchor',
        prompt: r.prompt,
        sort_order: kept.length + i,
        metadata: { ai_generated: true, ...(r.metadata ?? {}) },
      }));
    setQuestions([...kept, ...added]);
    setMessage(`AI generated ${added.length} interview question${added.length === 1 ? '' : 's'}.`);
    persistRoundConfig([...kept, ...added]);
  };

  const aiRubricMutation = useMutation({
    mutationFn: () => suggestCompetencies(id),
    onSuccess: (data) => {
      if (!data.suggestions.length) {
        setMessage('AI returned no competencies. Add skills on the basics step and try again.');
        return;
      }
      applyAiCompetencies(data.suggestions, true);
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const aiBalanceMutation = useMutation({
    mutationFn: () => suggestRubricWeights(id),
    onSuccess: (data) => {
      const suggestions = data.suggestions ?? [];
      if (!suggestions.length) {
        setMessage('No weight suggestions returned.');
        return;
      }
      if ('id' in suggestions[0]!) {
        const byId = new Map(
          suggestions
            .filter((s): s is { id: string; weight_pct: number } => 'id' in s)
            .map((s) => [s.id, s.weight_pct]),
        );
        setCompetencies(
          normalizeCompetencyWeights(
            competencies.map((c) =>
              byId.has(c.id) ? { ...c, weight_pct: byId.get(c.id)! } : c,
            ),
          ),
        );
        setMessage('AI balanced rubric weights to 100%.');
        return;
      }
      applyAiCompetencies(
        suggestions.map((s) => ({
          name: (s as { name: string }).name,
          category: (s as { category: string }).category,
          target_score: (s as { target_score: number }).target_score ?? 8,
          weight_pct: (s as { weight_pct: number }).weight_pct,
        })),
        true,
      );
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const aiQuestionsMutation = useMutation({
    mutationFn: (stageId?: string | null) => generateAiQuestions(id, 5, stageId ?? undefined),
    onSuccess: (data, stageId) => {
      if (!data.questions.length) {
        setMessage('AI returned no questions. Try again or add manually.');
        return;
      }
      applyAiQuestions(data.questions, stageId ?? data.stage_id ?? null);
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const aiBusy =
    aiRubricMutation.isPending ||
    aiBalanceMutation.isPending ||
    aiQuestionsMutation.isPending;

  const runAiAction = async (name: string, fn: () => Promise<unknown>, successMsg: string) => {
    try {
      setAiActionPending(name);
      await fn();
      setMessage(successMsg);
      void queryClient.invalidateQueries({ queryKey: ['job-profile', id] });
      void queryClient.invalidateQueries({ queryKey: ['job-profile-ai-insights', id] });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : `${name} failed`);
    } finally {
      setAiActionPending(null);
    }
  };

  const nlMutation = useMutation({
    mutationFn: () => nlEditJobProfile(id, nlInstruction),
    onSuccess: async () => {
      setNlInstruction('');
      setMessage('NL edit applied successfully.');
      const fresh = await queryClient.fetchQuery({
        queryKey: ['job-profile', id],
        queryFn: () => getJobProfile(id),
      });
      hydrateFrom(fresh);
    },
    onError: (e: Error) => setMessage(e.message),
  });

  const handleStageNameChange = (idx: number, name: string) => {
    const next = [...stages];
    next[idx] = { ...next[idx]!, name };
    setStages(next);
  };

  const handleStageTypeChange = (idx: number, stageType: JobStageType) => {
    if (
      stageType === 'take_home' &&
      stages.some((other, otherIdx) => otherIdx !== idx && other.stage_type === 'take_home')
    ) {
      setMessage('Only one Take-home Assessment round is allowed per job profile.');
      return;
    }
    if (
      stageType === 'project_interview' &&
      stages.some((other, otherIdx) => otherIdx !== idx && other.stage_type === 'project_interview')
    ) {
      setMessage('Only one Build & Defend round is allowed per job profile.');
      return;
    }
    if (
      stageType === 'ai_screening' &&
      stages.some((other, otherIdx) => otherIdx !== idx && other.stage_type === 'ai_screening')
    ) {
      setMessage('Only one AI Screening stage is allowed.');
      return;
    }
    const next = [...stages];
    const stage = next[idx]!;
    next[idx] = {
      ...stage,
      stage_type: stageType,
      mode:
        stageType === 'ai_screening' ||
        stageType === 'ai_verbal' ||
        stageType === 'coding' ||
        stageType === 'screening' ||
        stageType === 'project_interview'
          ? 'ai_led'
          : stageType === 'hr_verbal' || stageType === 'panel'
            ? 'human_led'
            : stage.mode,
      name:
        stageType === 'ai_screening' && (stage.name === 'New stage' || !stage.name)
          ? 'AI Screening'
          : stageType === 'ai_verbal' && (stage.name === 'New stage' || !stage.name)
            ? 'AI Verbal Interview'
          : stageType === 'take_home' && (stage.name === 'New stage' || !stage.name)
            ? 'Take-home Assessment'
            : stageType === 'project_interview' && (stage.name === 'New stage' || !stage.name)
              ? 'Build & Defend'
              : stage.name,
      round_config:
        stageType === 'ai_screening'
          ? (defaultAiScreeningRoundConfig() as unknown as Record<string, unknown>)
          : stageType === 'take_home'
            ? (stage.round_config ??
              (defaultTakeHomeRoundConfig() as unknown as Record<string, unknown>))
            : stageType === 'project_interview'
              ? stage.stage_type === 'project_interview' && stage.round_config
                ? stage.round_config
                : (defaultProjectInterviewRoundConfig() as unknown as Record<string, unknown>)
              : stage.round_config,
    };
    setStages(next);
  };

  const handleModeChange = (idx: number, mode: 'ai_led' | 'human_led') => {
    const next = [...stages];
    next[idx] = { ...next[idx]!, mode };
    setStages(next);
  };

  const handleDeleteStage = (idx: number) => {
    if (stages.length <= 1) return;
    setStages(stages.filter((_, i) => i !== idx));
  };

  const handleAddStage = () => {
    setStages([
      ...stages,
      {
        id: `new-${Date.now()}`,
        stage_key: `stage_${Date.now()}`,
        name: 'New stage',
        description: '',
        sort_order: stages.length,
        mode: 'ai_led',
        mandatory: false,
        stage_type: 'custom',
      },
    ]);
  };

  const isTakeHomeDisabledForIdx = (idx: number, optValue: string) => {
    if (optValue !== 'take_home' && optValue !== 'project_interview') return false;
    return stages.some((other, otherIdx) => otherIdx !== idx && other.stage_type === optValue);
  };

  const addQuestionBankRows = (rows: QuestionBankQuestion[], stageId: string | null = null) => {
    const next = [...questions];
    const targetStage = stageId ?? stages[0]?.id ?? null;
    const existingQuestionIds = new Set(
      next
        .filter((q) => q.stage_id === targetStage)
        .map((q) => (q.metadata as Record<string, unknown> | null)?.question_bank_id)
        .filter((i) => i != null)
        .map(String),
    );
    for (const row of rows) {
      if (existingQuestionIds.has(row.id)) continue;
      existingQuestionIds.add(row.id);
      next.push({
        id: `qb-${row.id}-${Date.now()}`,
        stage_id: targetStage,
        kind: 'anchor',
        prompt: row.questionText,
        sort_order: next.length,
        metadata: {
          source: 'question_bank',
          question_bank_id: row.id,
          difficulty: row.difficulty,
          questionType: row.questionType,
          competency: row.competencyTags?.[0] ?? null,
          required_flag: true,
        },
      });
    }
    setQuestions(next);
    persistRoundConfig(next);
  };

  const addProblemBankRows = (rows: ProblemBankProblem[], stageId: string | null = null) => {
    const next = [...questions];
    const targetStage =
      stageId ?? stages.find((s) => s.stage_type === 'coding')?.id ?? stages[0]?.id ?? null;
    const existingProblemIds = new Set(
      next
        .filter((q) => q.stage_id === targetStage)
        .map((q) => (q.metadata as Record<string, unknown> | null)?.problem_bank_id)
        .filter((i) => i != null)
        .map(String),
    );
    for (const row of rows) {
      if (existingProblemIds.has(row.id)) continue;
      existingProblemIds.add(row.id);
      next.push({
        id: `pb-${row.id}-${Date.now()}`,
        stage_id: targetStage,
        kind: 'manual',
        prompt: row.title,
        sort_order: next.length,
        metadata: {
          source: 'problem_bank',
          problem_bank_id: row.id,
          difficulty: row.difficulty,
          allowed_languages: row.allowedLanguages,
          competency: row.topicTags?.[0] ?? null,
          topic: row.topicTags?.[0] ?? null,
          required_flag: true,
        },
      });
    }
    setQuestions(next);
    persistRoundConfig(next);
  };

  const addBankContentRows = (
    questionRows: QuestionBankQuestion[],
    problemRows: ProblemBankProblem[],
    stageId: string | null = null,
  ) => {
    const next = [...questions];
    const targetStage = stageId ?? stages[0]?.id ?? null;

    const existingQuestionIds = new Set(
      next
        .filter((q) => q.stage_id === targetStage)
        .map((q) => (q.metadata as Record<string, unknown> | null)?.question_bank_id)
        .filter((i) => i != null)
        .map(String),
    );
    for (const row of questionRows) {
      if (existingQuestionIds.has(row.id)) continue;
      existingQuestionIds.add(row.id);
      next.push({
        id: `qb-${row.id}-${Date.now()}`,
        stage_id: targetStage,
        kind: 'anchor',
        prompt: row.questionText,
        sort_order: next.length,
        metadata: {
          source: 'question_bank',
          question_bank_id: row.id,
          difficulty: row.difficulty,
          questionType: row.questionType,
          competency: row.competencyTags?.[0] ?? null,
          required_flag: true,
        },
      });
    }

    const existingProblemIds = new Set(
      next
        .filter((q) => q.stage_id === targetStage)
        .map((q) => (q.metadata as Record<string, unknown> | null)?.problem_bank_id)
        .filter((i) => i != null)
        .map(String),
    );
    for (const row of problemRows) {
      if (existingProblemIds.has(row.id)) continue;
      existingProblemIds.add(row.id);
      next.push({
        id: `pb-${row.id}-${Date.now()}`,
        stage_id: targetStage,
        kind: 'manual',
        prompt: row.title,
        sort_order: next.length,
        metadata: {
          source: 'problem_bank',
          problem_bank_id: row.id,
          difficulty: row.difficulty,
          allowed_languages: row.allowedLanguages,
          competency: row.topicTags?.[0] ?? null,
          topic: row.topicTags?.[0] ?? null,
          required_flag: true,
        },
      });
    }

    setQuestions(next);
    persistRoundConfig(next);
  };

  const handleQuestionsChange = (next: JobProfileQuestion[]) => {
    setQuestions(next);
    persistRoundConfig(next);
  };

  if (detailQuery.isError) {
    return <p className="text-sm text-[var(--assessment-error)] p-6">Failed to load profile.</p>;
  }
  if (detailQuery.isLoading || !detailQuery.data || !hydrated) {
    return <p className="text-sm p-6 text-[var(--assessment-on-surface-variant)]">Loading configuration...</p>;
  }

  const profile = detailQuery.data.profile;

  return (
    <div className="w-full space-y-6">
      {/* Top Header / Stepper Container */}
      <div className="nexus-card p-3 px-6 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          {/* Step 1: Job Details (Completed) */}
          <button
            type="button"
            onClick={() => goToSetupStep(1)}
            className="flex items-center gap-2 text-xs font-semibold text-[var(--assessment-on-surface)] hover:text-[var(--assessment-primary)] transition-colors"
          >
            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
            <span>1. Job Details</span>
          </button>

          <div className="hidden sm:block w-8 h-[1px] bg-[var(--assessment-outline-variant)]" />

          {/* Step 2: Stages Allotment */}
          {viewStep === 2 ? (
            <div className="bg-[var(--assessment-primary)] text-[var(--assessment-on-primary)] text-xs font-semibold px-4 py-1.5 rounded-full flex items-center gap-2 shadow-sm">
              <span className="font-bold">2.</span> Stages Allotment
            </div>
          ) : (
            <button
              type="button"
              onClick={() => goToSetupStep(2)}
              className="flex items-center gap-2 text-xs font-semibold text-[var(--assessment-on-surface)] hover:text-[var(--assessment-primary)] transition-colors"
            >
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-white">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </span>
              <span>2. Stages Allotment</span>
            </button>
          )}

          <div className="hidden sm:block w-8 h-[1px] bg-[var(--assessment-outline-variant)]" />

          {/* Step 3: Round Configuration */}
          {viewStep === 3 ? (
            <div className="bg-[var(--assessment-primary)] text-[var(--assessment-on-primary)] text-xs font-semibold px-4 py-1.5 rounded-full flex items-center gap-2 shadow-sm">
              <span className="font-bold">3.</span> Rubric &amp; Round Configuration
            </div>
          ) : (
            <button
              type="button"
              disabled
              className="bg-[var(--assessment-surface-container-low)] text-[var(--nexus-secondary)] text-xs font-medium px-3.5 py-1.5 rounded-full opacity-60 cursor-not-allowed"
              title="Please click Continue to Stages at the bottom to proceed"
            >
              3. Round Configuration
            </button>
          )}
        </div>

        {/* Right Header Buttons */}
        <div className="flex items-center gap-3 ml-auto">
          <button
            type="button"
            disabled={saveMutation.isPending || aiBusy || roundConfigSaveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] hover:bg-[var(--assessment-surface-container-low)] text-[var(--assessment-on-surface)] text-xs font-bold px-4 py-2 rounded-lg transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4"
              />
            </svg>
            {saveMutation.isPending ? 'SAVING...' : 'SAVE DRAFT'}
          </button>

          <button
            type="button"
            onClick={() => {
              if (viewStep === 2) {
                saveMutation.mutate(undefined, {
                  onSuccess: () => goToSetupStep(3),
                });
                return;
              }
              if (profile.status === 'draft') {
                publishMutation.mutate();
              } else {
                router.push(`/assessments/job-profiles/${id}/analytics`);
              }
            }}
            disabled={
              viewStep === 2
                ? saveMutation.isPending
                : profile.status === 'draft' && !publishReady
            }
            className="bg-[var(--assessment-primary)] hover:opacity-90 text-[var(--assessment-on-primary)] text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {viewStep === 2
              ? saveMutation.isPending
                ? 'CONTINUING...'
                : 'CONTINUE TO ROUND CONFIGURATION'
              : profile.status === 'draft'
                ? publishMutation.isPending
                  ? 'PUBLISHING...'
                  : 'PUBLISH'
                : 'VIEW ANALYTICS'}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>

      {/* Sub-header Meta Row */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-sm text-[var(--assessment-on-surface-variant)]">
        <div className="flex items-center flex-wrap gap-2">
          <Link href="/assessments/job-profiles" className="hover:text-[var(--assessment-primary)] transition-colors">
            ← All job profiles
          </Link>
          <span className="text-[var(--assessment-outline-variant)]">/</span>
          <span className="font-bold text-[var(--assessment-on-surface)] text-base">
            {profile.title || 'PHP Developer Junior'}
          </span>
          <span className="ml-1.5 bg-[var(--assessment-surface-container-low)] text-[var(--nexus-secondary)] border border-[var(--assessment-outline-variant)] font-mono text-xs font-bold px-2.5 py-0.5 rounded tracking-wider">
            ID: {id}
          </span>
        </div>
        <div className="flex items-center gap-2 ml-auto text-xs font-medium text-[var(--assessment-on-surface-variant)]">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          Autosaved 1m ago
        </div>
      </div>

      {/* Publishing draft alert if on Step 3 */}
      {profile.status === 'draft' && !publishReady && viewStep === 3 ? (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          To publish: Complete your round configuration, ensuring all rounds have rubrics and questions configured, then save draft.
        </div>
      ) : null}

      {/* Main Step 2 or Step 3 View */}
      {viewStep === 2 ? (
        <div className="grid grid-cols-12 gap-6 items-start">
          {/* Left Column: Pipeline Stages (8 cols) */}
          <div className="col-span-12 space-y-6 lg:col-span-8">
            <section className="nexus-card p-6 shadow-sm">
              {/* Header with Title, Badge, and Add Stage Button */}
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-lg font-bold text-[var(--assessment-on-surface)]">Pipeline configuration</h3>
                    <span className="bg-[var(--assessment-surface-container-low)] text-[var(--assessment-primary)] border border-[var(--assessment-outline-variant)] text-xs font-bold px-2.5 py-0.5 rounded-full">
                      {stages.length} Stages Active
                    </span>
                  </div>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)] mt-1">
                    Define sequence and ownership for each evaluation stage.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleAddStage}
                  className="bg-[var(--assessment-primary)] hover:opacity-90 text-[var(--assessment-on-primary)] text-xs font-bold px-3.5 py-2 rounded-lg flex items-center gap-1.5 transition-all shadow-sm"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                  </svg>
                  ADD STAGE
                </button>
              </div>

              {/* Stages List with Drag-and-Drop */}
              <div className="space-y-4">
                {stages.map((stage, idx) => {
                  const isAiForced =
                    stage.stage_type === 'ai_verbal' ||
                    stage.stage_type === 'coding' ||
                    stage.stage_type === 'screening' ||
                    stage.stage_type === 'project_interview';
                  const isHumanForced =
                    stage.stage_type === 'hr_verbal' || stage.stage_type === 'panel';
                  const displayMode = isAiForced ? 'ai_led' : isHumanForced ? 'human_led' : stage.mode;

                  return (
                    <div
                      key={stage.id}
                      draggable
                      onDragStart={() => setDragIdx(idx)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (dragIdx != null) void reorderAfterDrop(dragIdx, idx);
                        setDragIdx(null);
                      }}
                      className="relative transition-all"
                    >
                      <div
                        className={`p-5 rounded-xl border bg-[var(--assessment-surface-container)] shadow-xs transition-shadow hover:shadow-sm ${
                          stage.stage_type === 'coding' || stage.mode === 'ai_led'
                            ? 'border-dashed border-[var(--nexus-secondary)]/50'
                            : 'border-dashed border-[var(--assessment-outline-variant)]'
                        }`}
                      >
                        {/* Stage Top Meta Row */}
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          {/* Left: Drag handle, Stage Number, Badges */}
                          <div className="flex items-center flex-wrap gap-2.5">
                            <span
                              className="cursor-grab text-[var(--assessment-outline)] hover:text-[var(--assessment-on-surface)]"
                              title="Drag to reorder stage"
                            >
                              <svg className="w-4 h-4 text-[var(--assessment-outline)]" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M7 4a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0zM7 16a2 2 0 11-4 0 2 2 0 014 0zM17 4a2 2 0 11-4 0 2 2 0 014 0zM17 10a2 2 0 11-4 0 2 2 0 014 0zM17 16a2 2 0 11-4 0 2 2 0 014 0z" />
                              </svg>
                            </span>

                            <span className="font-bold text-sm text-[var(--assessment-on-surface)] font-mono">
                              {String(idx + 1).padStart(2, '0')}
                            </span>

                            {stage.stage_type === 'coding' || stage.mode === 'ai_led' ? (
                              <span className="bg-[var(--assessment-surface-container-low)] text-[var(--nexus-secondary)] border border-[var(--assessment-outline-variant)] text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 uppercase tracking-wider">
                                <svg
                                  className="w-2.5 h-2.5 text-[var(--nexus-secondary)]"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2.5}
                                    d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                                  />
                                </svg>
                                AI SUGGESTED
                              </span>
                            ) : (
                              <span className="bg-[var(--assessment-surface-container-low)] text-[var(--assessment-on-surface-variant)] border border-[var(--assessment-outline-variant)] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                CUSTOM ROUND
                              </span>
                            )}

                            {stage.mandatory ? (
                              <span className="bg-[var(--assessment-surface-container-low)] text-[var(--assessment-on-surface-variant)] border border-[var(--assessment-outline-variant)] text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                MANDATORY
                              </span>
                            ) : null}

                            <span className="bg-[var(--assessment-surface-container-low)] text-[var(--assessment-primary)] border border-[var(--assessment-outline-variant)] text-[10px] font-medium px-2 py-0.5 rounded-full flex items-center gap-1">
                              <svg className="w-2.5 h-2.5 text-[var(--assessment-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              {getStageDurationLabel(stage.stage_type)}
                            </span>
                          </div>

                          {/* Right: Segmented AI-LED / HUMAN Toggle and Delete Button */}
                          <div className="flex items-center gap-2 ml-auto" onMouseDown={(e) => e.stopPropagation()}>
                            <div className="flex items-center rounded-lg bg-[var(--assessment-surface-container-low)] p-1 border border-[var(--assessment-outline-variant)]">
                              <button
                                type="button"
                                disabled={isAiForced || isHumanForced}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleModeChange(idx, 'ai_led');
                                }}
                                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-bold uppercase transition-all ${
                                  displayMode === 'ai_led'
                                    ? 'bg-[var(--assessment-primary)] text-white shadow-xs'
                                    : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)]'
                                } disabled:cursor-not-allowed`}
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                                  />
                                </svg>
                                AI-LED
                              </button>
                              <button
                                type="button"
                                disabled={isAiForced || isHumanForced}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleModeChange(idx, 'human_led');
                                }}
                                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[10px] font-bold uppercase transition-all ${
                                  displayMode === 'human_led'
                                    ? 'bg-[var(--assessment-primary)] text-white shadow-xs'
                                    : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)]'
                                } disabled:cursor-not-allowed`}
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                                  />
                                </svg>
                                HUMAN
                              </button>
                            </div>

                            {stages.length > 1 ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteStage(idx);
                                }}
                                className="p-1.5 rounded-lg text-[var(--assessment-outline)] hover:text-[var(--assessment-error)] hover:bg-[var(--assessment-error-container)]/20 transition-colors ml-0.5 cursor-pointer"
                                title="Delete stage"
                              >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                  />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        </div>

                        {/* Stage Two-Column Inputs: Name & Type */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t border-[var(--assessment-outline-variant)]/40" onMouseDown={(e) => e.stopPropagation()}>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] mb-1.5 block">
                              STAGE NAME
                            </label>
                            <input
                              type="text"
                              value={stage.name}
                              onChange={(e) => handleStageNameChange(idx, e.target.value)}
                              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3.5 py-2 text-sm text-[var(--assessment-on-surface)] font-medium focus:outline-none focus:border-[var(--assessment-primary)] focus:ring-1 focus:ring-[var(--assessment-primary)]"
                              placeholder="Stage name..."
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] mb-1.5 block">
                              STAGE TYPE
                            </label>
                            <select
                              value={stage.stage_type ?? 'custom'}
                              onChange={(e) => handleStageTypeChange(idx, e.target.value as JobStageType)}
                              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3.5 py-2 text-sm text-[var(--assessment-on-surface)] font-medium focus:outline-none focus:border-[var(--assessment-primary)] focus:ring-1 focus:ring-[var(--assessment-primary)]"
                            >
                              {STAGE_TYPE_OPTIONS.map((opt) => (
                                <option
                                  key={opt.value}
                                  value={opt.value}
                                  disabled={isTakeHomeDisabledForIdx(idx, opt.value)}
                                >
                                  {opt.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Add Another Stage Dashed Button */}
              <button
                type="button"
                onClick={handleAddStage}
                className="w-full mt-4 py-3.5 border-2 border-dashed border-[var(--assessment-outline-variant)] hover:border-[var(--assessment-primary)] hover:bg-[var(--assessment-surface-container-low)] rounded-xl text-xs font-bold text-[var(--assessment-primary)] flex items-center justify-center gap-2 transition-all shadow-xs"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
                </svg>
                + Add another interview stage
              </button>
            </section>
          </div>

          {/* Right Column: AI Assistant, NL Editing, Pipeline Velocity (4 cols) */}
          <aside className="col-span-12 space-y-6 lg:col-span-4">
            {/* Card 1: AI Assistant Actions */}
            <div className="nexus-card p-5 shadow-sm space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-[var(--assessment-surface-container-low)] text-[var(--nexus-secondary)] border border-[var(--assessment-outline-variant)]">
                  <svg className="w-4 h-4 text-[var(--nexus-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z"
                    />
                  </svg>
                </div>
                <div>
                  <h4 className="text-sm font-bold text-[var(--assessment-on-surface)]">AI assistant</h4>
                  <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                    Optimize your pipeline with one-click actions.
                  </p>
                </div>
              </div>

              <div className="space-y-2.5">
                <button
                  type="button"
                  disabled={aiActionPending !== null}
                  onClick={() => void runAiAction('bias', () => biasScreenJobProfile(id), 'Bias screen complete.')}
                  className="w-full text-left p-3 rounded-lg border border-[var(--assessment-outline-variant)] hover:bg-[var(--assessment-surface-container-low)] hover:border-[var(--assessment-primary)] transition-all flex items-center justify-between group disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-[var(--assessment-surface-container-low)] text-[var(--nexus-secondary)] border border-[var(--assessment-outline-variant)] group-hover:bg-[var(--assessment-surface-container)] transition-colors">
                      <svg className="w-4 h-4 text-[var(--nexus-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                        />
                      </svg>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-[var(--assessment-on-surface)] block">Bias screen</span>
                      <span className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                        Screen job descriptions for non-inclusive terms
                      </span>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-[var(--assessment-outline)] group-hover:text-[var(--assessment-primary)] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <button
                  type="button"
                  disabled={aiActionPending !== null}
                  onClick={() => void runAiAction('comp', () => compensationBenchmark(id), 'Compensation benchmark ready.')}
                  className="w-full text-left p-3 rounded-lg border border-[var(--assessment-outline-variant)] hover:bg-[var(--assessment-surface-container-low)] hover:border-[var(--assessment-primary)] transition-all flex items-center justify-between group disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-[var(--assessment-surface-container-low)] text-[var(--assessment-primary)] border border-[var(--assessment-outline-variant)] group-hover:bg-[var(--assessment-surface-container)] transition-colors">
                      <svg className="w-4 h-4 text-[var(--assessment-primary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-[var(--assessment-on-surface)] block">Comp benchmark</span>
                      <span className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                        Real-time compensation analytics &amp; ranges
                      </span>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-[var(--assessment-outline)] group-hover:text-[var(--assessment-primary)] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                <button
                  type="button"
                  disabled={aiActionPending !== null}
                  onClick={() => void runAiAction('faq', () => generateFaq(id), 'Candidate FAQ generated.')}
                  className="w-full text-left p-3 rounded-lg border border-[var(--assessment-outline-variant)] hover:bg-[var(--assessment-surface-container-low)] hover:border-[var(--assessment-primary)] transition-all flex items-center justify-between group disabled:opacity-50"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-emerald-50 text-emerald-600 group-hover:bg-emerald-100 transition-colors">
                      <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                        />
                      </svg>
                    </div>
                    <div>
                      <span className="text-xs font-bold text-[var(--assessment-on-surface)] block">Generate FAQ</span>
                      <span className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                        Automate candidate FAQ from profile details
                      </span>
                    </div>
                  </div>
                  <svg className="w-4 h-4 text-[var(--assessment-outline)] group-hover:text-[var(--assessment-primary)] transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Card 2: NL Profile Editing */}
            <div className="nexus-card p-5 shadow-sm space-y-3">
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] mb-1">
                  NL PROFILE EDITING
                </h4>
                <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                  Describe changes in natural language to update this job profile.
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={nlInstruction}
                  onChange={(e) => setNlInstruction(e.target.value)}
                  placeholder="e.g. Add Kubernetes to skills and raise seniority..."
                  className="flex-1 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-xs text-[var(--assessment-on-surface)] focus:outline-none focus:border-[var(--assessment-primary)] focus:ring-1 focus:ring-[var(--assessment-primary)]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && nlInstruction.trim() && !nlMutation.isPending) {
                      nlMutation.mutate();
                    }
                  }}
                />
                <button
                  type="button"
                  disabled={!nlInstruction.trim() || nlMutation.isPending}
                  onClick={() => nlMutation.mutate()}
                  className="rounded-lg bg-[var(--assessment-primary)] hover:opacity-90 px-3.5 py-2 text-xs font-bold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                >
                  {nlMutation.isPending ? 'Applying...' : 'Apply'}
                </button>
              </div>
            </div>

            {/* Card 3: Pipeline Velocity */}
            <div className="nexus-card p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-[var(--assessment-on-surface)]">Pipeline velocity</h4>
                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Optimal
                </span>
              </div>

              <div className="space-y-3">
                <div>
                  <div className="mb-1 flex justify-between text-[11px] font-bold">
                    <span className="text-[var(--assessment-on-surface-variant)]">Est. time to hire</span>
                    <span className="text-[var(--assessment-primary)]">14 days</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--assessment-surface-container-high)]">
                    <div className="h-full w-[65%] bg-[var(--assessment-primary)] rounded-full" />
                  </div>
                </div>

                <div>
                  <div className="mb-1 flex justify-between text-[11px] font-bold">
                    <span className="text-[var(--assessment-on-surface-variant)]">AI efficiency gain</span>
                    <span className="text-[var(--nexus-secondary)]">+{Math.min(95, aiStageCount * 11)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-[var(--assessment-surface-container-high)]">
                    <div
                      className="h-full bg-[var(--nexus-secondary)] rounded-full transition-all"
                      style={{ width: `${Math.min(100, Math.max(20, aiStageCount * 22))}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-[var(--assessment-outline-variant)]/40">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] mb-2 block">
                  STAGE DURATION BREAKDOWN
                </span>
                <div className="h-2 w-full rounded-full overflow-hidden flex bg-[var(--assessment-surface-container-high)]">
                  {stages.map((st, i) => {
                    const mins = getStageDurationMinutes(st.stage_type);
                    const totalDuration =
                      stages.reduce((acc, s) => acc + getStageDurationMinutes(s.stage_type), 0) || 1;
                    const pct = Math.max(5, (mins / totalDuration) * 100);
                    const colors = [
                      'bg-[var(--assessment-primary)]',
                      'bg-[var(--nexus-secondary)]',
                      'bg-[var(--nexus-tertiary)]',
                      'bg-[var(--assessment-primary-container)]',
                      'bg-[var(--recruitment-secondary)]',
                      'bg-[var(--nexus-secondary-container)]',
                    ];
                    const color = colors[i % colors.length];
                    return (
                      <div
                        key={st.id}
                        style={{ width: `${pct}%` }}
                        className={`h-full ${color} border-r border-white last:border-0`}
                        title={`${st.name}: ${mins}m`}
                      />
                    );
                  })}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2 text-[10px]">
                  {stages.map((st, i) => {
                    const mins = getStageDurationMinutes(st.stage_type);
                    const colors = [
                      'bg-[var(--assessment-primary)]',
                      'bg-[var(--nexus-secondary)]',
                      'bg-[var(--nexus-tertiary)]',
                      'bg-[var(--assessment-primary-container)]',
                      'bg-[var(--recruitment-secondary)]',
                      'bg-[var(--nexus-secondary-container)]',
                    ];
                    const color = colors[i % colors.length];
                    return (
                      <span key={st.id} className="flex items-center gap-1 text-[var(--assessment-on-surface-variant)] font-medium">
                        <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
                        {String(i + 1).padStart(2, '0')}: {mins}m
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* AI Rubric Tip Box */}
            {showAiTip && weightTotal < 100 && competencies.length > 0 ? (
              <div className="nexus-glass-lite rounded-xl border border-[var(--nexus-secondary)]/30 p-4 shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <svg className="w-4 h-4 text-[var(--nexus-secondary)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="text-xs font-bold text-[var(--nexus-secondary)]">CodeVox AI assistant</span>
                </div>
                <p className="text-xs italic text-[var(--assessment-on-surface)] mb-3">
                  &ldquo;Rubric weights total {weightTotal.toFixed(0)}%. Should I balance them to 100%?&rdquo;
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={aiBusy}
                    onClick={() => setCompetencies(normalizeCompetencyWeights(competencies))}
                    className="flex-1 rounded-lg bg-[var(--nexus-secondary)] hover:opacity-90 py-1.5 text-[10px] font-bold uppercase text-white transition-all"
                  >
                    Balance to 100%
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowAiTip(false)}
                    className="flex-1 rounded-lg border border-[var(--nexus-secondary)] py-1.5 text-[10px] font-bold uppercase text-[var(--nexus-secondary)] hover:bg-[var(--assessment-surface-container-low)] transition-all"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ) : null}
          </aside>
        </div>
      ) : (
        <RoundConfigurationView
          profileId={id}
          stages={stages}
          competencies={competencies}
          questions={questions}
          aiBusy={aiBusy}
          onStagesChange={(next) => {
            setStages(next);
            persistRoundConfig(questions, next);
          }}
          onCompetenciesChange={setCompetencies}
          onQuestionsChange={handleQuestionsChange}
          onAddQuestions={addQuestionBankRows}
          onAddProblems={addProblemBankRows}
          onAddContent={addBankContentRows}
          onMagicGenerate={(stageId) => aiQuestionsMutation.mutate(stageId)}
          onSaveRound={() => saveMutation.mutate()}
          onFinish={() => saveMutation.mutate()}
          seniorityLevel={detailQuery.data?.profile.seniority_level ?? null}
        />
      )}

      {/* Action status message */}
      {message ? (
        <div
          className={`p-3 rounded-lg text-xs font-medium ${
            message.includes('fail') || message.includes('error')
              ? 'bg-[var(--assessment-error-container)]/20 text-[var(--assessment-error)] border border-[var(--assessment-error)]/30'
              : 'bg-emerald-50 text-emerald-800 border border-emerald-200'
          }`}
        >
          {message}
        </div>
      ) : null}

      {/* Advanced settings accordion */}
      <details className="nexus-card p-5 shadow-sm rounded-xl border border-[var(--assessment-outline-variant)]">
        <summary className="cursor-pointer font-bold text-sm text-[var(--assessment-on-surface)] flex items-center justify-between select-none">
          <span>Advanced settings (approval, thresholds)</span>
          <svg className="w-4 h-4 text-[var(--assessment-on-surface-variant)] transition-transform duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </summary>
        <div className="mt-4 pt-4 border-t border-[var(--assessment-outline-variant)]">
          <JobProfilePhase2Panel
            profileId={id}
            profile={profile}
            showOrgLibraries={false}
            showVersionHistory={false}
            showStallNotifications={false}
            onAddCompetency={(row) =>
              setCompetencies([
                ...competencies,
                {
                  id: `lib-${Date.now()}`,
                  stage_id: stages[0]?.id ?? null,
                  name: row.name,
                  category: row.category as 'hard' | 'soft',
                  target_score: row.target_score,
                  weight_pct: row.weight_pct,
                  sort_order: competencies.length,
                },
              ])
            }
            onAddQuestion={(row) =>
              setQuestions([
                ...questions,
                {
                  id: `lib-q-${Date.now()}`,
                  stage_id: stages[0]?.id ?? null,
                  kind: row.kind as 'anchor' | 'manual' | 'ai_adaptive',
                  prompt: row.prompt,
                  sort_order: questions.length,
                  metadata: null,
                },
              ])
            }
          />
        </div>
      </details>

      {/* Bottom Footer Navigation Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--assessment-outline-variant)] py-6">
        <Link
          href={viewStep === 3 ? setupPathForProfile(id, 2) : `/assessments/job-profiles/${id}/basics`}
          className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-2 text-xs font-bold text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container-low)] transition-colors shadow-sm"
        >
          {viewStep === 3 ? '← Rubric & stages' : '← Job details'}
        </Link>

        <div className="flex items-center gap-4">
          <Link
            href={`/assessments/job-profiles/${id}/analytics`}
            className="flex items-center gap-1.5 text-xs font-bold text-[var(--assessment-primary)] hover:underline"
          >
            View analytics
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
              />
            </svg>
          </Link>

          <button
            type="button"
            onClick={() => {
              if (viewStep === 2) {
                saveMutation.mutate(undefined, {
                  onSuccess: () => goToSetupStep(3),
                });
                return;
              }
              if (profile.status === 'draft') {
                publishMutation.mutate();
              } else {
                router.push(`/assessments/job-profiles/${id}/analytics`);
              }
            }}
            disabled={
              viewStep === 2
                ? saveMutation.isPending
                : profile.status === 'draft' && !publishReady
            }
            className="bg-[var(--assessment-primary)] hover:opacity-90 text-[var(--assessment-on-primary)] text-xs font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-all shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {viewStep === 2
              ? saveMutation.isPending
                ? 'CONTINUING...'
                : 'CONTINUE TO ROUND CONFIGURATION'
              : profile.status === 'draft'
                ? publishMutation.isPending
                  ? 'PUBLISHING...'
                  : 'PUBLISH PROFILE'
                : 'VIEW ANALYTICS'}
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
