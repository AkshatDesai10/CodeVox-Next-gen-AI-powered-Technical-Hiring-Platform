'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { CompetencyLibrarySearchSelect } from '@/modules/job-profiles/components/CompetencyLibrarySearchSelect';
import { QuestionBankRichTextEditor, type QuestionEditorValue } from '@/modules/job-profiles/components/QuestionBankRichTextEditor';
import {
  createQuestionBankQuestion,
  generateQuestionBankAiDrafts,
  getQuestionBankQuestion,
  listCompetencyLibrary,
  updateQuestionBankQuestion,
  type QuestionBankAiDraft,
  type QuestionBankQuestionDetail,
} from '@/modules/job-profiles/lib/job-profiles-api';
import { buildCompetencyGeneratorContext } from '@/modules/job-profiles/lib/question-bank-generator-context';
import {
  DEFAULT_MAGIC_QUESTION_TYPES,
  DEFAULT_QUESTION_COUNT,
  GENERATOR_DIFFICULTY_OPTIONS,
  MAGIC_QUESTION_TYPE_OPTIONS,
  QUESTION_COUNT_OPTIONS,
  QUESTION_TYPE_OPTIONS,
  type GeneratorDifficulty,
} from '@/modules/job-profiles/lib/question-bank-options';

const QUESTION_TYPES = QUESTION_TYPE_OPTIONS;

type Difficulty = 'easy' | 'medium' | 'hard';

type KeywordTag = { label: string; aiSuggested?: boolean };

const DEFAULT_KEYWORDS: KeywordTag[] = [
  { label: 'Scalability' },
  { label: 'Latency' },
  { label: 'Resilience', aiSuggested: true },
];

function qualityAuditNotes(questionText: string) {
  const notes: Array<{ type: 'error' | 'info'; title: string; message: string }> = [];
  const lower = questionText.toLowerCase();
  if (!questionText.trim()) {
    return [
      {
        type: 'error' as const,
        title: 'Vague Phrasing',
        message: 'The phrase "tell me about a time" is too generic for L6 evaluations.',
      },
      {
        type: 'info' as const,
        title: 'Leading Question',
        message: "Question implies a 'successful' outcome; try asking for a 'significant' outcome instead.",
      },
    ];
  }
  if (lower.includes('tell me about a time')) {
    notes.push({
      type: 'error',
      title: 'Vague Phrasing',
      message: 'The phrase "tell me about a time" is too generic for L6 evaluations.',
    });
  }
  if (lower.includes('successful')) {
    notes.push({
      type: 'info',
      title: 'Leading Question',
      message: "Question implies a 'successful' outcome; try asking for a 'significant' outcome instead.",
    });
  }
  if (!notes.length) {
    notes.push({
      type: 'info',
      title: 'Structure Check',
      message: 'Question length and framing look suitable for competency-based evaluation.',
    });
  }
  return notes;
}

function toEditorHtml(text: string) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<p>${escaped}</p>`;
}

function loadQuestionDetailIntoForm(
  detail: QuestionBankQuestionDetail,
  setters: {
    setQuestionDraft: (v: QuestionEditorValue) => void;
    setEditorInitialHtml: (v: string) => void;
    setEditorKey: React.Dispatch<React.SetStateAction<number>>;
    setQuestionType: (v: string) => void;
    setDifficulty: (v: Difficulty) => void;
    setCompetency: (v: string) => void;
    setExpectedAnswerNotes: (v: string) => void;
    setKeywords: (v: KeywordTag[]) => void;
    setFollowUpQuestion: (v: string) => void;
    setFollowUpTrigger: (v: string) => void;
    setFollowUpEnabled: (v: boolean) => void;
    setRedFlagSignals: (v: string[]) => void;
    setBiasCheckPassed: (v: boolean) => void;
    setBiasCheckNotes: (v: string) => void;
    setTimeGuidanceMinutes: (v: number) => void;
  },
) {
  const plain = detail.questionTextPlain?.trim() || detail.questionText.replace(/<[^>]+>/g, ' ').trim();
  const html = detail.questionText.includes('<') ? detail.questionText : toEditorHtml(plain);
  setters.setQuestionDraft({ html, text: plain });
  setters.setEditorInitialHtml(html);
  setters.setEditorKey((key) => key + 1);
  setters.setQuestionType(detail.questionType);
  setters.setDifficulty(detail.difficulty as Difficulty);
  if (detail.competencyTags?.[0]) setters.setCompetency(detail.competencyTags[0]);
  setters.setExpectedAnswerNotes(detail.expectedAnswerNotes ?? '');
  const keywordSource = detail.idealAnswerKeywords?.length ? detail.idealAnswerKeywords : detail.topicTags ?? [];
  setters.setKeywords(keywordSource.map((label) => ({ label })));
  setters.setFollowUpEnabled(Boolean(detail.followUpQuestion?.trim()));
  setters.setFollowUpQuestion(detail.followUpQuestion ?? '');
  setters.setFollowUpTrigger(detail.followUpTrigger ?? '');
  setters.setRedFlagSignals(detail.redFlagSignals ?? []);
  setters.setBiasCheckPassed(detail.biasCheckPassed !== false);
  setters.setBiasCheckNotes(detail.biasCheckNotes ?? '');
  if (detail.timeGuidanceSeconds) setters.setTimeGuidanceMinutes(Math.max(1, Math.round(detail.timeGuidanceSeconds / 60)));
}

function applyAiDraftToForm(
  draft: QuestionBankAiDraft,
  setters: {
    setQuestionDraft: (v: QuestionEditorValue) => void;
    setEditorInitialHtml: (v: string) => void;
    setEditorKey: React.Dispatch<React.SetStateAction<number>>;
    setFollowUpQuestion: (v: string) => void;
    setFollowUpTrigger: (v: string) => void;
    setCompetency: (v: string) => void;
    setQuestionType: (v: string) => void;
    setDifficulty: (v: Difficulty) => void;
    setExpectedAnswerNotes: (v: string) => void;
    setKeywords: (v: KeywordTag[]) => void;
    setBiasCheckPassed: (v: boolean) => void;
    setBiasCheckNotes: (v: string) => void;
    setBiasAcknowledged: (v: boolean) => void;
    setTimeGuidanceMinutes: (v: number) => void;
  },
) {
  if (typeof draft.question_text === 'string') {
    const text = draft.question_text;
    const html = toEditorHtml(text);
    setters.setQuestionDraft({ html, text });
    setters.setEditorInitialHtml(html);
    setters.setEditorKey((key) => key + 1);
  }
  if (typeof draft.follow_up_question === 'string') setters.setFollowUpQuestion(draft.follow_up_question);
  if (typeof draft.follow_up_trigger === 'string') setters.setFollowUpTrigger(draft.follow_up_trigger);
  if (Array.isArray(draft.competency_tags) && draft.competency_tags[0]) {
    setters.setCompetency(String(draft.competency_tags[0]));
  }
  if (typeof draft.question_type === 'string') {
    setters.setQuestionType(String(draft.question_type));
  }
  if (typeof draft.difficulty === 'string') {
    setters.setDifficulty(draft.difficulty as Difficulty);
  }
  if (typeof draft.expected_answer_notes === 'string') setters.setExpectedAnswerNotes(draft.expected_answer_notes);
  const keywordSource = draft.ideal_answer_keywords?.length
    ? draft.ideal_answer_keywords
    : draft.topic_tags ?? [];
  if (keywordSource.length) {
    setters.setKeywords(keywordSource.map((label) => ({ label, aiSuggested: true })));
  }
  setters.setBiasCheckPassed(draft.bias_check_passed !== false);
  setters.setBiasCheckNotes(draft.bias_check_notes?.trim() ?? '');
  setters.setBiasAcknowledged(false);
  if (typeof draft.time_guidance_minutes === 'number') {
    setters.setTimeGuidanceMinutes(draft.time_guidance_minutes);
  }
}

type QuestionFormSnapshot = {
  questionDraft: QuestionEditorValue;
  questionType: string;
  difficulty: Difficulty;
  competency: string;
  followUpEnabled: boolean;
  followUpQuestion: string;
  followUpTrigger: string;
  expectedAnswerNotes: string;
  keywords: KeywordTag[];
  redFlagSignals: string[];
  biasCheckPassed: boolean;
  biasCheckNotes: string;
  timeGuidanceMinutes: number;
};

function buildDraftFromForm(snapshot: QuestionFormSnapshot): QuestionBankAiDraft {
  const keywordLabels = snapshot.keywords.map((k) => k.label);
  return {
    question_text: snapshot.questionDraft.text.trim(),
    question_type: snapshot.questionType,
    difficulty: snapshot.difficulty,
    competency_tags: snapshot.competency ? [snapshot.competency] : [],
    follow_up_question: snapshot.followUpEnabled ? snapshot.followUpQuestion.trim() || undefined : undefined,
    follow_up_trigger: snapshot.followUpEnabled ? snapshot.followUpTrigger.trim() || undefined : undefined,
    expected_answer_notes: snapshot.expectedAnswerNotes.trim() || undefined,
    ideal_answer_keywords: keywordLabels.length ? keywordLabels : undefined,
    red_flag_signals: snapshot.redFlagSignals.length ? snapshot.redFlagSignals : undefined,
    topic_tags: keywordLabels.length ? keywordLabels : undefined,
    bias_check_passed: snapshot.biasCheckPassed,
    bias_check_notes: snapshot.biasCheckNotes.trim() || undefined,
    time_guidance_minutes: snapshot.timeGuidanceMinutes,
  };
}

function draftToSaveBody(
  draft: QuestionBankAiDraft,
  input: { status: 'draft' | 'published'; biasAcknowledged?: boolean },
) {
  const keywordLabels = draft.ideal_answer_keywords?.length
    ? draft.ideal_answer_keywords
    : draft.topic_tags ?? [];
  const plain = draft.question_text.trim();
  const html = plain.includes('<') ? plain : toEditorHtml(plain);
  const difficulty = (draft.difficulty?.toLowerCase() ?? 'medium') as Difficulty;
  return {
    questionText: html,
    questionTextPlain: plain || undefined,
    questionType: draft.question_type,
    difficulty,
    status: input.status,
    competencyTags: draft.competency_tags?.length ? draft.competency_tags : undefined,
    topicTags: keywordLabels.length ? keywordLabels : undefined,
    expectedAnswerNotes: draft.expected_answer_notes?.trim() || undefined,
    idealAnswerKeywords: keywordLabels.length ? keywordLabels : undefined,
    followUpQuestion: draft.follow_up_question?.trim() || undefined,
    followUpTrigger: draft.follow_up_trigger?.trim() || undefined,
    redFlagSignals: draft.red_flag_signals?.length ? draft.red_flag_signals : undefined,
    biasCheckPassed: draft.bias_check_passed !== false,
    biasCheckNotes: draft.bias_check_notes?.trim() || undefined,
    bias_check_acknowledged: input.biasAcknowledged || draft.bias_check_passed !== false,
    timeGuidanceSeconds:
      typeof draft.time_guidance_minutes === 'number' && draft.time_guidance_minutes > 0
        ? draft.time_guidance_minutes * 60
        : undefined,
  };
}

function buildAiGeneratePayload(
  generatorContext: NonNullable<ReturnType<typeof buildCompetencyGeneratorContext>>,
  input: {
    selectedQuestionTypes: string[];
    generatorDifficulty: GeneratorDifficulty;
    additionalContext: string;
    questionCount: number;
  },
) {
  return {
    competency_name: generatorContext.competencyName,
    competency_description: generatorContext.competencyDescription,
    competency_rubric_criteria: generatorContext.rubricCriteria,
    seniority_level: generatorContext.seniorityLevel,
    job_role: generatorContext.competencyName,
    industry_domain: generatorContext.industryDomain,
    tech_stack: generatorContext.techStack,
    question_types: input.selectedQuestionTypes,
    difficulty: input.generatorDifficulty,
    additional_context: input.additionalContext.trim() || undefined,
    question_count: input.questionCount,
  };
}

function DifficultySegmentedControl(props: {
  value: Difficulty;
  onChange: (value: Difficulty) => void;
  label: string;
  labelClassName?: string;
}) {
  return (
    <div>
      <label className={`mb-2 block font-label-caps ${props.labelClassName ?? 'text-[var(--assessment-on-surface-variant)]'}`}>
        {props.label}
      </label>
      <div className="flex gap-1">
        {(['easy', 'medium', 'hard'] as Difficulty[]).map((level, index) => {
          const active = props.value === level;
          const rounded = index === 0 ? 'rounded-l-lg' : index === 2 ? 'rounded-r-lg' : '';
          const border =
            index === 1 && active
              ? 'border-y border-[var(--assessment-outline-variant)]'
              : 'border border-[var(--assessment-outline-variant)]';
          return (
            <button
              key={level}
              type="button"
              onClick={() => props.onChange(level)}
              className={`flex-1 py-2 text-xs font-bold capitalize ${rounded} ${border} ${
                active
                  ? 'bg-[var(--assessment-primary)] text-white'
                  : 'bg-[var(--assessment-surface-container-high)] text-[var(--assessment-on-surface)]'
              }`}
            >
              {level}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function QuestionBankCreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams?.get('edit') ?? '';

  const editQuery = useQuery({
    queryKey: ['question-bank', editId, 'edit'],
    queryFn: () => getQuestionBankQuestion(editId),
    enabled: Boolean(editId),
  });

  const [editLoaded, setEditLoaded] = useState(false);

  const [competency, setCompetency] = useState('');
  const [seniorityLevel, setSeniorityLevel] = useState('MID-LEVEL');
  const [industryDomain] = useState('General');

  const competencyLibQuery = useQuery({
    queryKey: ['job-profile-competency-catalog', 'question-bank-create'],
    queryFn: () => listCompetencyLibrary(),
  });

  const selectedCompetencyEntry = useMemo(
    () => competencyLibQuery.data?.find((item) => item.name === competency) ?? null,
    [competencyLibQuery.data, competency],
  );

  const generatorContext = useMemo(
    () =>
      buildCompetencyGeneratorContext(selectedCompetencyEntry, {
        seniorityLevel,
        industryDomain,
      }),
    [selectedCompetencyEntry, seniorityLevel, industryDomain],
  );

  const [generatorDifficulty, setGeneratorDifficulty] = useState<GeneratorDifficulty>('mixed');
  const [showGeneratorAdvanced, setShowGeneratorAdvanced] = useState(false);

  const [questionDraft, setQuestionDraft] = useState<QuestionEditorValue>({ html: '', text: '' });
  const [editorKey, setEditorKey] = useState(0);
  const [editorInitialHtml, setEditorInitialHtml] = useState('');
  const [questionType, setQuestionType] = useState('technical');

  const [selectedQuestionTypes, setSelectedQuestionTypes] = useState<string[]>(DEFAULT_MAGIC_QUESTION_TYPES);
  const [additionalContext, setAdditionalContext] = useState('');
  const [questionCount, setQuestionCount] = useState(DEFAULT_QUESTION_COUNT);
  const [generatedDrafts, setGeneratedDrafts] = useState<QuestionBankAiDraft[]>([]);
  const [selectedDraftIndex, setSelectedDraftIndex] = useState(0);
  const [regeneratingDraftIndex, setRegeneratingDraftIndex] = useState<number | null>(null);
  const [aiCoverageNotes, setAiCoverageNotes] = useState('');
  const [seniorityCalibrationNotes, setSeniorityCalibrationNotes] = useState('');
  const [timeGuidanceMinutes, setTimeGuidanceMinutes] = useState(4);
  const [expectedAnswerNotes, setExpectedAnswerNotes] = useState('');
  const [redFlagSignals, setRedFlagSignals] = useState<string[]>([]);
  const [keywords, setKeywords] = useState<KeywordTag[]>(DEFAULT_KEYWORDS);
  const [keywordInput, setKeywordInput] = useState('');
  const [followUpEnabled, setFollowUpEnabled] = useState(true);
  const [followUpQuestion, setFollowUpQuestion] = useState(
    'If the initial architectural choice resulted in a single point of failure, how would you remediate the system without complete downtime?',
  );
  const [followUpTrigger, setFollowUpTrigger] = useState('');
  const [biasCheckPassed, setBiasCheckPassed] = useState(true);
  const [biasCheckNotes, setBiasCheckNotes] = useState('');
  const [biasAcknowledged, setBiasAcknowledged] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');

  const detailSetters = {
    setQuestionDraft,
    setEditorInitialHtml,
    setEditorKey,
    setQuestionType,
    setDifficulty,
    setCompetency,
    setExpectedAnswerNotes,
    setKeywords,
    setFollowUpQuestion,
    setFollowUpTrigger,
    setFollowUpEnabled,
    setRedFlagSignals,
    setBiasCheckPassed,
    setBiasCheckNotes,
    setTimeGuidanceMinutes,
  };

  useEffect(() => {
    if (!editId || !editQuery.data || editLoaded) return;
    loadQuestionDetailIntoForm(editQuery.data, detailSetters);
    setEditLoaded(true);
  }, [editId, editQuery.data, editLoaded]);

  const canGenerateAi =
    Boolean(generatorContext) && selectedQuestionTypes.length > 0 && Boolean(competency);

  const auditNotes = useMemo(() => qualityAuditNotes(questionDraft.text), [questionDraft.text]);
  const signalBars = [30, 45, 85, 60, 75];
  const predictedAccuracy = questionDraft.text.trim()
    ? Math.min(98, 70 + Math.floor(questionDraft.text.trim().length / 8))
    : 92;

  const canPublish = questionDraft.text.trim() && (biasCheckPassed || biasAcknowledged);

  const saveMutation = useMutation({
    mutationFn: async (input: { status: 'draft' | 'published'; biasAcknowledged?: boolean }) => {
      const body =
        generatedDrafts.length > 0
          ? draftToSaveBody(buildDraftFromForm(getFormSnapshot()), input)
          : (() => {
              const keywordLabels = keywords.map((k) => k.label);
              return {
                questionText: questionDraft.html,
                questionTextPlain: questionDraft.text.trim() || undefined,
                questionType,
                difficulty,
                status: input.status,
                competencyTags: [competency],
                topicTags: keywordLabels.length ? keywordLabels : undefined,
                expectedAnswerNotes: expectedAnswerNotes.trim() || undefined,
                idealAnswerKeywords: keywordLabels.length ? keywordLabels : undefined,
                followUpQuestion: followUpEnabled ? followUpQuestion.trim() || undefined : undefined,
                followUpTrigger: followUpEnabled ? followUpTrigger.trim() || undefined : undefined,
                redFlagSignals: redFlagSignals.length ? redFlagSignals : undefined,
                biasCheckPassed,
                biasCheckNotes: biasCheckNotes.trim() || undefined,
                bias_check_acknowledged: input.biasAcknowledged || biasCheckPassed,
                timeGuidanceSeconds: timeGuidanceMinutes > 0 ? timeGuidanceMinutes * 60 : undefined,
              };
            })();
      if (generatedDrafts.length > 0) {
        setGeneratedDrafts((prev) => {
          const next = [...prev];
          next[selectedDraftIndex] = buildDraftFromForm(getFormSnapshot());
          return next;
        });
      }
      if (editId) {
        return updateQuestionBankQuestion(editId, body);
      }
      return createQuestionBankQuestion(body);
    },
    onSuccess: () => router.push('/assessments/job-profiles/question-bank'),
  });

  const draftSetters = {
    setQuestionDraft,
    setEditorInitialHtml,
    setEditorKey,
    setFollowUpQuestion,
    setFollowUpTrigger,
    setCompetency,
    setQuestionType,
    setDifficulty,
    setExpectedAnswerNotes,
    setKeywords,
    setBiasCheckPassed,
    setBiasCheckNotes,
    setBiasAcknowledged,
    setTimeGuidanceMinutes,
  };

  const getFormSnapshot = (): QuestionFormSnapshot => ({
    questionDraft,
    questionType,
    difficulty,
    competency,
    followUpEnabled,
    followUpQuestion,
    followUpTrigger,
    expectedAnswerNotes,
    keywords,
    redFlagSignals,
    biasCheckPassed,
    biasCheckNotes,
    timeGuidanceMinutes,
  });

  const mergeDraftsWithCurrentForm = (drafts: QuestionBankAiDraft[]) => {
    if (!drafts.length) return drafts;
    const next = [...drafts];
    next[selectedDraftIndex] = buildDraftFromForm(getFormSnapshot());
    return next;
  };

  const loadGeneratedDraft = (draft: QuestionBankAiDraft, index: number) => {
    applyAiDraftToForm(draft, draftSetters);
    setRedFlagSignals(draft.red_flag_signals?.length ? draft.red_flag_signals : []);
    setFollowUpEnabled(Boolean(draft.follow_up_question?.trim()));
    setSelectedDraftIndex(index);
  };

  const selectGeneratedDraft = (index: number) => {
    if (index === selectedDraftIndex) return;
    setGeneratedDrafts((prev) => {
      const next = [...prev];
      next[selectedDraftIndex] = buildDraftFromForm(getFormSnapshot());
      const target = next[index];
      if (target) {
        queueMicrotask(() => loadGeneratedDraft(target, index));
      }
      return next;
    });
  };

  const aiMutation = useMutation({
    mutationFn: () => {
      if (!generatorContext) {
        throw new Error('Select a competency from the library before generating.');
      }
      if (!selectedQuestionTypes.length) {
        throw new Error('Select at least one question type.');
      }
      return generateQuestionBankAiDrafts(
        buildAiGeneratePayload(generatorContext, {
          selectedQuestionTypes,
          generatorDifficulty,
          additionalContext,
          questionCount,
        }),
      );
    },
    onSuccess: (data) => {
      const drafts = data.drafts ?? [];
      setGeneratedDrafts(drafts);
      setAiCoverageNotes(data.competency_coverage_notes?.trim() ?? '');
      setSeniorityCalibrationNotes(data.seniority_calibration_notes?.trim() ?? '');
      const draft = drafts[0];
      if (!draft) return;
      loadGeneratedDraft(draft, 0);
    },
  });

  const regenerateDraftMutation = useMutation({
    mutationFn: async (index: number) => {
      if (!generatorContext) {
        throw new Error('Select a competency before regenerating.');
      }
      setRegeneratingDraftIndex(index);
      const synced = mergeDraftsWithCurrentForm(generatedDrafts);
      const otherQuestions = synced
        .filter((_, i) => i !== index)
        .map((d) => d.question_text?.trim())
        .filter(Boolean);
      const avoidNote =
        otherQuestions.length > 0
          ? `Generate a fresh question that differs from these existing drafts:\n${otherQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
          : '';
      const combinedContext = [additionalContext.trim(), avoidNote].filter(Boolean).join('\n\n');
      const result = await generateQuestionBankAiDrafts(
        buildAiGeneratePayload(generatorContext, {
          selectedQuestionTypes,
          generatorDifficulty,
          additionalContext: combinedContext,
          questionCount: 1,
        }),
      );
      const draft = result.drafts?.[0];
      if (!draft) throw new Error('AI did not return a replacement draft.');
      return { index, draft };
    },
    onSuccess: ({ index, draft }) => {
      setGeneratedDrafts((prev) => {
        const next = mergeDraftsWithCurrentForm(prev);
        next[index] = draft;
        return next;
      });
      if (selectedDraftIndex === index) {
        loadGeneratedDraft(draft, index);
      }
    },
    onSettled: () => setRegeneratingDraftIndex(null),
  });

  const saveAllMutation = useMutation({
    mutationFn: async (input: { status: 'draft' | 'published' }) => {
      const allDrafts = mergeDraftsWithCurrentForm(generatedDrafts).filter((d) => d.question_text?.trim());
      if (!allDrafts.length) {
        throw new Error('No generated questions to save.');
      }
      for (const draft of allDrafts) {
        await createQuestionBankQuestion(
          draftToSaveBody(draft, { status: input.status, biasAcknowledged: draft.bias_check_passed === false }),
        );
      }
      return allDrafts.length;
    },
    onSuccess: () => router.push('/assessments/job-profiles/question-bank'),
  });

  const hasGeneratedBatch = generatedDrafts.length > 0 && !editId;
  const isBatchSaving = saveAllMutation.isPending;

  const handlePublish = () => {
    if (!canPublish) return;
    saveMutation.mutate({
      status: 'published',
      biasAcknowledged: !biasCheckPassed,
    });
  };

  const addKeyword = () => {
    const value = keywordInput.trim();
    if (!value || keywords.some((k) => k.label === value)) return;
    setKeywords((prev) => [...prev, { label: value }]);
    setKeywordInput('');
  };

  return (
    <div className="w-full space-y-6 pb-8">
      <div className="grid w-full grid-cols-12 gap-8">
            <div className="col-span-12 space-y-6 xl:col-span-8">
              <header className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--assessment-outline-variant)] pb-4">
                <div>
                  <h1 className="font-display-lg text-[var(--assessment-on-surface)]">
                    {editId ? 'Edit Question' : 'Create New Question'}
                  </h1>
                  <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                    Define precision-engineered assessment questions for the Engineering pipeline.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3">
                  {hasGeneratedBatch ? (
                    <>
                      <button
                        type="button"
                        disabled={saveMutation.isPending || isBatchSaving}
                        onClick={() => saveMutation.mutate({ status: 'draft' })}
                        className="rounded-lg border border-[var(--assessment-outline)] px-4 py-2 font-title-sm text-[var(--assessment-on-surface)] transition hover:bg-[var(--assessment-surface-container-high)] disabled:opacity-60"
                      >
                        Save current
                      </button>
                      <button
                        type="button"
                        disabled={isBatchSaving || saveMutation.isPending}
                        onClick={() => saveAllMutation.mutate({ status: 'draft' })}
                        className="rounded-lg border border-[var(--assessment-outline)] px-4 py-2 font-title-sm text-[var(--assessment-on-surface)] transition hover:bg-[var(--assessment-surface-container-high)] disabled:opacity-60"
                      >
                        {isBatchSaving ? 'Saving...' : `Save all (${generatedDrafts.length})`}
                      </button>
                      <button
                        type="button"
                        disabled={!canPublish || saveMutation.isPending || isBatchSaving}
                        onClick={handlePublish}
                        className="rounded-lg border border-[var(--assessment-primary)] px-4 py-2 font-title-sm text-[var(--assessment-primary)] transition hover:bg-[var(--assessment-primary)]/10 disabled:opacity-60"
                      >
                        Publish current
                      </button>
                      <button
                        type="button"
                        disabled={isBatchSaving || saveMutation.isPending}
                        onClick={() => saveAllMutation.mutate({ status: 'published' })}
                        className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 font-title-sm text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                      >
                        Publish all
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={saveMutation.isPending || isBatchSaving}
                        onClick={() => saveMutation.mutate({ status: 'draft' })}
                        className="rounded-lg border border-[var(--assessment-outline)] px-4 py-2 font-title-sm text-[var(--assessment-on-surface)] transition hover:bg-[var(--assessment-surface-container-high)] disabled:opacity-60"
                      >
                        Save Draft
                      </button>
                      <button
                        type="button"
                        disabled={!canPublish || saveMutation.isPending || isBatchSaving}
                        onClick={handlePublish}
                        className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 font-title-sm text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                      >
                        Publish Question
                      </button>
                    </>
                  )}
                </div>
              </header>

              <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-6">
                {generatedDrafts.length > 0 ? (
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--nexus-secondary)]/30 bg-[var(--nexus-secondary-container)]/20 px-3 py-2">
                    <p className="text-xs font-semibold text-[var(--nexus-secondary)]">
                      Editing draft {selectedDraftIndex + 1} of {generatedDrafts.length}
                    </p>
                    <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                      Changes apply to this draft - switch drafts or use Save all when done.
                    </p>
                  </div>
                ) : null}
                <div className="mb-6">
                  <label className="mb-2 block font-label-caps text-[var(--assessment-on-surface-variant)]">
                    Question Text
                  </label>
                  <QuestionBankRichTextEditor
                    key={editorKey}
                    initialHtml={editorInitialHtml}
                    onChange={setQuestionDraft}
                    placeholder="Describe the specific situation or technical problem the candidate needs to solve..."
                  />
                </div>

                <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                  <div>
                    <label className="mb-2 block font-label-caps text-[var(--assessment-on-surface-variant)]">
                      Question Type
                    </label>
                    <select
                      value={questionType}
                      onChange={(e) => setQuestionType(e.target.value)}
                      className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface)] p-2.5 text-sm outline-none focus:border-[var(--assessment-primary)]"
                    >
                      {QUESTION_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <DifficultySegmentedControl value={difficulty} onChange={setDifficulty} label="Difficulty" />

                  <div>
                    <label className="mb-2 block font-label-caps text-[var(--assessment-on-surface-variant)]">
                      Master competency
                    </label>
                    <CompetencyLibrarySearchSelect
                      value={competency}
                      onChange={setCompetency}
                      hideLabel
                      placeholder="Search competencies..."
                    />
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-6">
                  <label className="mb-4 block font-label-caps text-[var(--assessment-on-surface-variant)]">
                    Red Flag Signals
                  </label>
                  <textarea
                    value={redFlagSignals.join('\n')}
                    onChange={(e) =>
                      setRedFlagSignals(
                        e.target.value
                          .split('\n')
                          .map((line) => line.trim())
                          .filter(Boolean),
                      )
                    }
                    rows={3}
                    placeholder="One weak-answer pattern per line (used by post-session AI evaluation)..."
                    className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface)] p-3 text-sm outline-none placeholder:text-[var(--assessment-outline)] focus:border-[var(--assessment-primary)]"
                  />
                </section>

                <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-6">
                  <label className="mb-4 block font-label-caps text-[var(--assessment-on-surface-variant)]">
                    Time Guidance (minutes)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={timeGuidanceMinutes}
                    onChange={(e) => setTimeGuidanceMinutes(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface)] p-3 text-sm outline-none focus:border-[var(--assessment-primary)]"
                  />
                </section>
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-6">
                  <label className="mb-4 block font-label-caps text-[var(--assessment-on-surface-variant)]">
                    Expected Answer Notes
                  </label>
                  <textarea
                    value={expectedAnswerNotes}
                    onChange={(e) => setExpectedAnswerNotes(e.target.value)}
                    rows={3}
                    placeholder="Key logical steps or experiences the candidate should touch upon..."
                    className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface)] p-3 text-sm outline-none placeholder:text-[var(--assessment-outline)] focus:border-[var(--assessment-primary)]"
                  />
                </section>

                <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-6">
                  <label className="mb-4 block font-label-caps text-[var(--assessment-on-surface-variant)]">
                    Ideal Keywords
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {keywords.map((keyword) => (
                      <span
                        key={keyword.label}
                        className={`flex items-center gap-1 rounded-full px-3 py-1 text-xs ${
                          keyword.aiSuggested
                            ? 'nexus-ai-sparkle-border bg-[var(--nexus-secondary-container)] text-[var(--nexus-on-secondary-container)]'
                            : 'bg-[var(--assessment-surface-container-high)]'
                        }`}
                      >
                        {keyword.label}
                        {keyword.aiSuggested ? (
                          <AssessmentMaterialIcon name="auto_awesome" size={14} style={{ fontVariationSettings: "'FILL' 1" }} />
                        ) : (
                          <button
                            type="button"
                            onClick={() => setKeywords((prev) => prev.filter((k) => k.label !== keyword.label))}
                          >
                            <AssessmentMaterialIcon name="close" size={14} />
                          </button>
                        )}
                      </span>
                    ))}
                    <input
                      value={keywordInput}
                      onChange={(e) => setKeywordInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addKeyword();
                        }
                      }}
                      placeholder="+ Add keyword"
                      className="w-24 border-none bg-transparent p-1 text-xs outline-none focus:ring-0"
                    />
                  </div>
                </section>
              </div>

              <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={followUpEnabled}
                        onChange={(e) => setFollowUpEnabled(e.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="peer h-6 w-11 rounded-full bg-[var(--assessment-surface-container-highest)] after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-[var(--assessment-surface-container)] after:transition-all peer-checked:bg-[var(--assessment-primary)] peer-checked:after:translate-x-full peer-checked:after:border-white" />
                    </label>
                    <span className="font-title-sm text-[var(--assessment-on-surface)]">Enable Follow-up Probe</span>
                  </div>
                  <span className="font-label-caps text-[var(--assessment-primary)]">Smart Adaptive</span>
                </div>
                {followUpEnabled ? (
                  <div className="space-y-4">
                    <div className="nexus-ai-sparkle-border rounded-lg bg-[var(--assessment-surface)] p-4">
                      <label className="mb-1 block text-xs font-bold text-[var(--nexus-secondary)]">Generated Probe</label>
                      <textarea
                        value={followUpQuestion}
                        onChange={(e) => setFollowUpQuestion(e.target.value)}
                        rows={2}
                        className="w-full resize-none border-none bg-transparent font-mono-data text-sm italic text-[var(--assessment-on-surface-variant)] outline-none focus:ring-0"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block font-label-caps text-[var(--assessment-on-surface-variant)]">
                        Follow-up Trigger
                      </label>
                      <textarea
                        value={followUpTrigger}
                        onChange={(e) => setFollowUpTrigger(e.target.value)}
                        rows={2}
                        placeholder="What in the candidate's answer should trigger this follow-up?"
                        className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface)] p-3 text-sm outline-none focus:border-[var(--assessment-primary)]"
                      />
                    </div>
                  </div>
                ) : null}
              </section>

              {!biasCheckPassed ? (
                <section className="rounded-xl border border-[var(--assessment-error)] bg-[var(--assessment-error-container)]/20 p-4">
                  <div className="flex items-start gap-3">
                    <AssessmentMaterialIcon name="warning" size={20} className="mt-0.5 text-[var(--assessment-error)]" />
                    <div className="flex-1">
                      <p className="font-title-sm font-bold text-[var(--assessment-on-error-container)]">Bias Check Warning</p>
                      <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
                        {biasCheckNotes || 'AI flagged a potential bias concern. Review and edit before publishing.'}
                      </p>
                      <label className="mt-3 flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={biasAcknowledged}
                          onChange={(e) => setBiasAcknowledged(e.target.checked)}
                        />
                        I have reviewed this concern and want to proceed
                      </label>
                    </div>
                  </div>
                </section>
              ) : null}
            </div>

            <div className="col-span-12 space-y-6 xl:col-span-4">
              <section className="overflow-hidden rounded-xl border border-[var(--nexus-secondary)]/30 bg-[var(--nexus-secondary-container)]/10 shadow-sm">
                <div className="flex items-center gap-2 bg-[var(--nexus-secondary)] p-4 text-white">
                  <AssessmentMaterialIcon name="auto_awesome" size={20} style={{ fontVariationSettings: "'FILL' 1" }} />
                  <h3 className="font-title-sm font-bold">Magic Create</h3>
                </div>
                <div className="space-y-4 p-6">
                  <div>
                    <label className="mb-2 block font-label-caps text-[var(--nexus-secondary)]">Competency</label>
                    <CompetencyLibrarySearchSelect
                      value={competency}
                      onChange={setCompetency}
                      hideLabel
                      placeholder="Search competencies..."
                    />
                  </div>
                  <div>
                    <label className="mb-2 block font-label-caps text-[var(--nexus-secondary)]">Seniority</label>
                    <select
                      value={seniorityLevel}
                      onChange={(e) => setSeniorityLevel(e.target.value)}
                      className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-2 text-sm"
                    >
                      <option value="INTERN / FRESHER">Intern / Fresher</option>
                      <option value="JUNIOR">Junior</option>
                      <option value="MID-LEVEL">Mid-Level</option>
                      <option value="SENIOR">Senior</option>
                      <option value="LEAD / PRINCIPAL">Lead / Principal</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-2 block font-label-caps text-[var(--nexus-secondary)]">Question Type</label>
                    <div className="flex flex-wrap gap-2">
                      {MAGIC_QUESTION_TYPE_OPTIONS.map((item) => {
                        const active = selectedQuestionTypes.includes(item.value);
                        return (
                          <button
                            key={item.value}
                            type="button"
                            onClick={() =>
                              setSelectedQuestionTypes((prev) =>
                                active ? prev.filter((v) => v !== item.value) : [...prev, item.value],
                              )
                            }
                            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                              active
                                ? 'bg-[var(--nexus-secondary)] text-white'
                                : 'border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)]'
                            }`}
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <label className="mb-2 block font-label-caps text-[var(--nexus-secondary)]">Question Count</label>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={questionCount}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val >= 1 && val <= 50) {
                          setQuestionCount(val);
                        }
                      }}
                      className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-2 text-sm"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowGeneratorAdvanced((open) => !open)}
                    className="flex w-full items-center justify-between text-xs font-semibold text-[var(--nexus-secondary)]"
                  >
                    <span>Advanced options</span>
                    <AssessmentMaterialIcon name={showGeneratorAdvanced ? 'expand_less' : 'expand_more'} size={18} />
                  </button>
                  {showGeneratorAdvanced ? (
                    <div className="space-y-4 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-3">
                      <div>
                        <label className="mb-2 block font-label-caps text-[var(--nexus-secondary)]">Difficulty</label>
                        <div className="flex gap-1">
                          {GENERATOR_DIFFICULTY_OPTIONS.map((item, index) => {
                            const active = generatorDifficulty === item.value;
                            const rounded =
                              index === 0 ? 'rounded-l-lg' : index === GENERATOR_DIFFICULTY_OPTIONS.length - 1 ? 'rounded-r-lg' : '';
                            return (
                              <button
                                key={item.value}
                                type="button"
                                onClick={() => setGeneratorDifficulty(item.value)}
                                className={`flex-1 py-2 text-xs font-bold ${rounded} border border-[var(--assessment-outline-variant)] ${
                                  active
                                    ? 'bg-[var(--nexus-secondary)] text-white'
                                    : 'bg-[var(--assessment-surface-container-high)] text-[var(--assessment-on-surface)]'
                                }`}
                              >
                                {item.label}
                              </button>
                            );
                          })}
                        </div>
                        <p className="mt-2 text-[11px] text-[var(--assessment-on-surface-variant)]">
                          Mixed lets AI calibrate difficulty to the profile seniority.
                        </p>
                      </div>
                      <div>
                        <label className="mb-2 block font-label-caps text-[var(--nexus-secondary)]">Additional Context</label>
                        <textarea
                          value={additionalContext}
                          onChange={(e) => setAdditionalContext(e.target.value)}
                          rows={2}
                          placeholder='e.g. "focus on remote team scenarios"'
                          className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-2 text-sm"
                        />
                      </div>
                    </div>
                  ) : null}

                  {generatorContext ? (
                    <div className="space-y-2 border-t border-[var(--nexus-secondary)]/20 pt-4">
                      <p className="font-label-caps text-[var(--nexus-secondary)]">Generator context</p>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: 'Competency', value: generatorContext.competencyName },
                          { label: 'Seniority', value: generatorContext.seniorityLabel },
                          { label: 'Domain', value: generatorContext.industryDomain },
                          { label: 'Stack hint', value: generatorContext.techStack || 'Inferred from competency' },
                        ].map((chip) => (
                          <span
                            key={chip.label}
                            className="rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-1 text-[11px] text-[var(--assessment-on-surface-variant)]"
                          >
                            <span className="font-bold text-[var(--nexus-secondary)]">{chip.label}:</span> {chip.value}
                          </span>
                        ))}
                      </div>
                      <p className="text-[11px] leading-relaxed text-[var(--assessment-on-surface-variant)]">
                        <span className="font-bold text-[var(--nexus-secondary)]">Competency:</span>{' '}
                        {generatorContext.competencyDescription}
                      </p>
                      <p className="text-[11px] leading-relaxed text-[var(--assessment-on-surface-variant)]">
                        <span className="font-bold text-[var(--nexus-secondary)]">Rubric:</span>{' '}
                        {generatorContext.rubricCriteria}
                      </p>
                    </div>
                  ) : null}

                  <button
                    type="button"
                    disabled={!canGenerateAi || aiMutation.isPending}
                    onClick={() => aiMutation.mutate()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--nexus-secondary)] py-2.5 font-title-sm text-white transition hover:shadow-lg disabled:opacity-60"
                  >
                    {aiMutation.isPending ? (
                      <AssessmentMaterialIcon name="sync" size={20} className="animate-spin" />
                    ) : null}
                    {questionCount > 1 ? `Generate ${questionCount} Questions` : 'Generate Question with AI'}
                  </button>
                  <p
                    className={`text-center text-xs text-[var(--nexus-secondary)] transition-opacity ${
                      aiMutation.isPending ? 'opacity-100' : 'opacity-0'
                    }`}
                  >
                    AI Generating...
                  </p>

                  {generatedDrafts.length > 0 ? (
                    <div className="space-y-3 border-t border-[var(--nexus-secondary)]/20 pt-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-label-caps text-[var(--nexus-secondary)]">
                          Generated drafts ({generatedDrafts.length})
                        </p>
                        {!editId ? (
                          <button
                            type="button"
                            disabled={saveAllMutation.isPending}
                            onClick={() => saveAllMutation.mutate({ status: 'draft' })}
                            className="text-[11px] font-bold text-[var(--nexus-secondary)] underline-offset-2 hover:underline disabled:opacity-60"
                          >
                            Save all
                          </button>
                        ) : null}
                      </div>
                      <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                        {generatedDrafts.map((draft, index) => {
                          const isActive = selectedDraftIndex === index;
                          const isRegenerating = regeneratingDraftIndex === index;
                          return (
                            <div
                              key={`draft-${index}`}
                              className={`rounded-lg border p-3 transition ${
                                isActive
                                  ? 'border-[var(--nexus-secondary)] bg-[var(--assessment-surface-container)] shadow-sm'
                                  : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]'
                              }`}
                            >
                              <div className="mb-2 flex items-start justify-between gap-2">
                                <button
                                  type="button"
                                  onClick={() => selectGeneratedDraft(index)}
                                  className="min-w-0 flex-1 text-left"
                                >
                                  <span className="mb-1 block text-xs font-bold text-[var(--nexus-secondary)]">
                                    Draft {index + 1} | {draft.question_type} | {draft.difficulty}
                                  </span>
                                  <span className="line-clamp-3 text-[11px] text-[var(--assessment-on-surface-variant)]">
                                    {draft.question_text}
                                  </span>
                                </button>
                                <button
                                  type="button"
                                  title="Regenerate this draft"
                                  disabled={
                                    !canGenerateAi ||
                                    isRegenerating ||
                                    regenerateDraftMutation.isPending ||
                                    aiMutation.isPending
                                  }
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    regenerateDraftMutation.mutate(index);
                                  }}
                                  className="shrink-0 rounded-lg border border-[var(--assessment-outline-variant)] p-1.5 text-[var(--nexus-secondary)] transition hover:bg-[var(--nexus-secondary-container)] disabled:opacity-50"
                                >
                                  <AssessmentMaterialIcon
                                    name="refresh"
                                    size={16}
                                    className={isRegenerating ? 'animate-spin' : undefined}
                                  />
                                </button>
                              </div>
                              {isActive ? (
                                <span className="inline-block rounded-full bg-[var(--nexus-secondary)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--nexus-secondary)]">
                                  Editing
                                </span>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                      {saveAllMutation.isError ? (
                        <p className="text-xs text-[var(--assessment-error)]">
                          {(saveAllMutation.error as Error).message || 'Failed to save all drafts.'}
                        </p>
                      ) : null}
                      {regenerateDraftMutation.isError ? (
                        <p className="text-xs text-[var(--assessment-error)]">
                          {(regenerateDraftMutation.error as Error).message || 'Regeneration failed.'}
                        </p>
                      ) : null}
                      {aiCoverageNotes ? (
                        <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                          <span className="font-bold">Coverage:</span> {aiCoverageNotes}
                        </p>
                      ) : null}
                      {seniorityCalibrationNotes ? (
                        <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                          <span className="font-bold">Seniority:</span> {seniorityCalibrationNotes}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </section>

              <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-6">
                <h3 className="mb-4 flex items-center gap-2 font-title-sm font-bold text-[var(--assessment-on-surface)]">
                  <AssessmentMaterialIcon name="fact_check" size={20} className="text-[var(--assessment-primary)]" />
                  Quality Audit
                </h3>
                <div className="space-y-4">
                  {auditNotes.map((note) => (
                    <div
                      key={`${note.type}-${note.title}`}
                      className={`flex items-start gap-3 rounded-r-lg border-l-4 p-3 ${
                        note.type === 'error'
                          ? 'border-[var(--assessment-error)] bg-[var(--assessment-error-container)]/20'
                          : 'border-[var(--assessment-outline)] bg-[var(--assessment-surface-container-high)]'
                      }`}
                    >
                      <AssessmentMaterialIcon
                        name={note.type === 'error' ? 'warning' : 'info'}
                        size={18}
                        className={`mt-0.5 ${note.type === 'error' ? 'text-[var(--assessment-error)]' : 'text-[var(--assessment-primary)]'}`}
                      />
                      <div>
                        <p
                          className={`text-xs font-bold ${
                            note.type === 'error'
                              ? 'text-[var(--assessment-on-error-container)]'
                              : 'text-[var(--assessment-on-surface)]'
                          }`}
                        >
                          {note.title}
                        </p>
                        <p className="text-xs text-[var(--assessment-on-surface-variant)]">{note.message}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-6">
                <div className="mb-6 flex items-center justify-between">
                  <h3 className="font-title-sm font-bold text-[var(--assessment-on-surface)]">Signal Strength</h3>
                  <span className="rounded bg-[var(--assessment-primary)]/10 px-2 py-1 font-label-caps text-[var(--assessment-primary)]">
                    Optimized
                  </span>
                </div>
                <div className="relative flex h-40 w-full items-end justify-between gap-1">
                  {signalBars.map((height, index) => (
                    <div
                      key={index}
                      title={
                        index === 2
                          ? 'Peak Performance Correlation'
                          : height < 50
                            ? 'Low Correlation'
                            : 'High Correlation'
                      }
                      className={`flex-1 rounded-t-sm transition-all ${
                        index === 2
                          ? 'bg-[var(--assessment-primary)] shadow-md'
                          : 'bg-[var(--assessment-surface-container-high)] hover:bg-[var(--assessment-primary-container)]'
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  ))}
                </div>
                <div className="mt-4 text-center">
                  <p className="text-xs font-bold text-[var(--assessment-on-surface)]">{predictedAccuracy}% Predicted Accuracy</p>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                    This question is likely to distinguish top-tier performers.
                  </p>
                </div>
    
                 <button
                type="button"
                onClick={() => router.push('/assessments/job-profiles/question-bank')}
                className="w-full rounded-lg border border-[var(--assessment-error)] py-2 text-sm font-bold text-[var(--assessment-error)] transition hover:bg-[var(--assessment-error-container)]/20"
              >
                Discard Problem
              </button>
              </section>
            </div>
          </div>
    </div>
  );
}
