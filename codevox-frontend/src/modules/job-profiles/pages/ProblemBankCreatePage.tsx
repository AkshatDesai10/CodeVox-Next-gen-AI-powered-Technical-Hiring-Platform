'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { CompetencyLibrarySearchSelect } from '@/modules/job-profiles/components/CompetencyLibrarySearchSelect';
import {
  ProblemPatternSearchSelect,
  ProblemTopicSearchSelect,
} from '@/modules/job-profiles/components/ProblemPatternPickers';
import {
  createProblemBankProblem,
  generateDatabaseAssessmentAiDraft,
  generateProblemBankAiDraft,
  getJobProfile,
  getProblemBankProblem,
  listCompetencyLibrary,
  publishProblemBankProblem,
  updateProblemBankProblem,
  upsertProblemBankTestCases,
  verifyProblemDraft,
} from '@/modules/job-profiles/lib/job-profiles-api';
import {
  buildCompetencyProblemContext,
  buildJobProfileProblemContext,
} from '@/modules/job-profiles/lib/problem-bank-generator-context';
import {
  DEFAULT_STARTER_BY_LANGUAGE,
  inferLanguagesFromTechStack,
  PROBLEM_LANGUAGE_OPTIONS,
} from '@/modules/job-profiles/lib/tech-stack-inference';
import {
  AI_GENERATOR_OPTIONS,
  DATABASE_GENERATE_OPTION_LABELS,
  DATABASE_TYPE_OPTIONS,
  DEFAULT_DATABASE_GENERATE_OPTIONS,
  DEFAULT_PROBLEM_CONSTRAINTS,
  DEFAULT_PROBLEM_GENERATE_OPTIONS,
  PROBLEM_GENERATE_OPTION_LABELS,
  SEED_SIZE_OPTIONS,
  patternsForTopic,
  formatTestCaseValue,
  topicNeedsSandboxDatabase,
  type AiGeneratorType,
  type DatabaseGenerateOptions,
  type DatabaseType,
  type ProblemGenerateOptions,
  type SeedSize,
} from '@/modules/job-profiles/lib/problem-bank-options';

type ProblemDetail = Record<string, unknown>;

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function loadProblemDetailIntoForm(
  detail: ProblemDetail,
  setters: {
    setTitle: (v: string) => void;
    setStatement: (v: string) => void;
    setProblemDifficulty: (v: ProblemDifficulty) => void;
    setMarks: (v: number) => void;
    setWorkspaceType: (v: string) => void;
    setEvaluationMode: (v: 'TESTCASE' | 'AI' | 'HYBRID') => void;
    setAllowAiHelp: (v: boolean) => void;
    setPrivateLibrary: (v: boolean) => void;
    setAllowedLanguages: (v: string[]) => void;
    setTopicTag: (v: string) => void;
    setTopicTags: (v: string[]) => void;
    setStarterCodeMap: (v: Record<string, string>) => void;
    setInternalSolutionMap: (v: Record<string, string>) => void;
    setTestCases: (v: DraftCase[]) => void;
    setHints: (v: string[]) => void;
    setInputSizeConstraint: (v: string) => void;
    setValueRangeConstraint: (v: string) => void;
    setMemoryLimitMb: (v: number) => void;
    setTimeLimitMs: (v: number) => void;
    setDatabaseSchemaDdl: (v: string) => void;
    setDatabaseSeedSql: (v: string) => void;
    setDatabaseType: (v: DatabaseType) => void;
    setSampleQueries: (v: string) => void;
    setRequiresSandboxDatabase?: (v: boolean) => void;
  },
) {
  if (readString(detail.title)) setters.setTitle(String(detail.title));
  if (readString(detail.statementMd ?? detail.statement_md)) {
    setters.setStatement(String(detail.statementMd ?? detail.statement_md));
  }
  if (readString(detail.difficulty)) {
    setters.setProblemDifficulty(detail.difficulty as ProblemDifficulty);
  }
  if (detail.marks != null) setters.setMarks(Number(detail.marks));
  if (readString(detail.workspaceType ?? detail.workspace_type)) {
    setters.setWorkspaceType(String(detail.workspaceType ?? detail.workspace_type));
  }
  const evalMode = readString(detail.evaluationMode ?? detail.evaluation_mode);
  if (evalMode === 'TESTCASE' || evalMode === 'AI' || evalMode === 'HYBRID') {
    setters.setEvaluationMode(evalMode);
    setters.setAllowAiHelp(evalMode !== 'TESTCASE');
  }
  const evalConfig = (detail.evaluationConfig ?? detail.evaluation_config) as Record<string, unknown> | null;
  if (evalConfig && typeof evalConfig.private_library === 'boolean') {
    setters.setPrivateLibrary(evalConfig.private_library);
  }
  const tags = (detail.topicTags ?? detail.topic_tags) as string[] | undefined;
  if (tags?.length) {
    setters.setTopicTags(tags);
    const primary = tags[0];
    if (primary) {
      setters.setTopicTag(primary);
    }
  }
  const languages = (detail.allowedLanguages ?? detail.allowed_languages) as string[] | undefined;
  if (languages?.length) setters.setAllowedLanguages(languages);
  if (detail.timeLimitMinutes != null || detail.time_limit_minutes != null) {
    const minutes = Number(detail.timeLimitMinutes ?? detail.time_limit_minutes ?? 1);
    setters.setTimeLimitMs(Math.max(500, minutes * 60_000));
  }
  const env = (detail.environmentConfig ?? detail.environment_config) as Record<string, unknown> | null;
  if (env) {
    if (typeof env.memory_mb === 'number') setters.setMemoryLimitMb(env.memory_mb);
    if (typeof env.timeout_seconds === 'number') setters.setTimeLimitMs(env.timeout_seconds * 1000);
    const constraints = env.constraints as Record<string, unknown> | undefined;
    if (constraints) {
      if (typeof constraints.input_size === 'string') setters.setInputSizeConstraint(constraints.input_size);
      if (typeof constraints.value_range === 'string') setters.setValueRangeConstraint(constraints.value_range);
    }
    const dbAssessment = env.database_assessment as Record<string, unknown> | undefined;
    if (dbAssessment) {
      if (typeof dbAssessment.ddl_sql === 'string') setters.setDatabaseSchemaDdl(dbAssessment.ddl_sql);
      if (typeof dbAssessment.seed_sql === 'string') setters.setDatabaseSeedSql(dbAssessment.seed_sql);
      if (typeof dbAssessment.database_type === 'string') {
        setters.setDatabaseType(dbAssessment.database_type as DatabaseType);
      }
      if (Array.isArray(dbAssessment.sample_queries)) {
        setters.setSampleQueries(JSON.stringify(dbAssessment.sample_queries, null, 2));
      }
      const ws = String(detail.workspaceType ?? detail.workspace_type ?? '');
      if (ws === 'sql') {
        setters.setWorkspaceType('sql');
      } else {
        setters.setRequiresSandboxDatabase?.(true);
      }
    }
  }
  if (Array.isArray(detail.hints)) setters.setHints(detail.hints.map((hint) => String(hint)));
  const templates = (detail.language_templates ?? detail.languageTemplates ?? detail.templates) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(templates)) {
    setters.setStarterCodeMap(
      templates.reduce<Record<string, string>>((acc, t: any) => ({ ...acc, [t.languageCode ?? t.language_code]: readString(t.starterCode ?? t.starter_code) }), {})
    );
    setters.setInternalSolutionMap(
      templates.reduce<Record<string, string>>((acc, t: any) => ({ ...acc, [t.languageCode ?? t.language_code]: readString(t.internalSolution ?? t.internal_solution) }), {})
    );
  }
  const cases = (detail.test_cases ?? detail.testCases) as Array<Record<string, unknown>> | undefined;
  if (cases?.length) {
    setters.setTestCases(
      cases.map((item) => ({
        inputValue: formatTestCaseValue(item.inputValue ?? item.input_value),
        expectedOutput: formatTestCaseValue(item.expectedOutput ?? item.expected_output),
        isVisible: Number(item.isVisible ?? item.is_visible ?? 1),
        isEdgeCase: Number(item.isEdgeCase ?? item.is_edge_case ?? 0),
      })),
    );
  }
}

type DraftCase = { inputValue: string; expectedOutput: string; isVisible: number; isEdgeCase: number };
type ProblemDifficulty = 'easy' | 'medium' | 'hard';
type StatementTab = 'statement' | 'preview';
type CodeTab = 'starter' | 'solution';

const DEFAULT_STATEMENT = '';

const DEFAULT_SOLUTION = '';

const DEFAULT_STARTER = DEFAULT_STARTER_BY_LANGUAGE.javascript;

function CodeEditorPanel(props: { value: string; onChange: (value: string) => void; minLines?: number }) {
  const lineCount = Math.max(props.minLines ?? 15, props.value.split('\n').length);
  return (
    <div className="relative min-h-[400px] bg-[#1E1E1E]">
      <div className="flex min-h-[400px] font-mono text-sm">
        <div className="w-12 shrink-0 bg-[#252526] py-4 pr-3 text-right leading-6 text-[#858585] select-none">
          {Array.from({ length: lineCount }, (_, index) => (
            <div key={index}>{index + 1}</div>
          ))}
        </div>
        <textarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          spellCheck={false}
          className="min-h-[400px] flex-1 resize-none border-none bg-transparent p-4 leading-6 text-[#D4D4D4] outline-none"
        />
      </div>
    </div>
  );
}

function DifficultySegmentedControl(props: {
  value: ProblemDifficulty;
  onChange: (value: ProblemDifficulty) => void;
  label?: string;
  labelClassName?: string;
  activeClassName?: string;
}) {
  return (
    <div>
      {props.label ? (
        <label
          className={`mb-2 block font-label-caps ${props.labelClassName ?? 'text-[var(--assessment-on-surface-variant)]'}`}
        >
          {props.label}
        </label>
      ) : null}
      <div className="flex gap-1">
        {(['easy', 'medium', 'hard'] as ProblemDifficulty[]).map((level, index) => {
          const active = props.value === level;
          const rounded = index === 0 ? 'rounded-l-lg' : index === 2 ? 'rounded-r-lg' : '';
          return (
            <button
              key={level}
              type="button"
              onClick={() => props.onChange(level)}
              className={`flex-1 border border-[var(--assessment-outline-variant)] py-2 text-xs font-bold capitalize ${rounded} ${
                active
                  ? props.activeClassName ?? 'bg-[var(--assessment-primary)] text-white'
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

export function ProblemBankCreatePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const editId = searchParams?.get('edit') ?? '';
  const profileId = searchParams?.get('profileId') ?? '';
  const profileCompetencyParam = searchParams?.get('competency') ?? '';
  const editQuery = useQuery({
    queryKey: ['problem-bank', editId, 'edit'],
    queryFn: () => getProblemBankProblem(editId),
    enabled: Boolean(editId),
  });
  const [editLoaded, setEditLoaded] = useState(false);

  const [competency, setCompetency] = useState('');
  const [aiGenerateWarning, setAiGenerateWarning] = useState<string | null>(null);
  const [validationFixedIssues, setValidationFixedIssues] = useState<string[] | null>(null);

  const [validationResult, setValidationResult] = useState<any>(null);
  const [isValidationModalOpen, setIsValidationModalOpen] = useState(false);
  const [forcePublish, setForcePublish] = useState(false);

  const [seniorityLevel, setSeniorityLevel] = useState('MID-LEVEL');

  const competencyLibQuery = useQuery({
    queryKey: ['job-profile-competency-catalog', 'problem-bank-create'],
    queryFn: () => listCompetencyLibrary(),
  });

  const profileQuery = useQuery({
    queryKey: ['job-profile', profileId, 'problem-bank-create'],
    queryFn: () => getJobProfile(profileId),
    enabled: Boolean(profileId),
  });

  const selectedCompetencyEntry = useMemo(
    () => competencyLibQuery.data?.find((item) => item.name === competency) ?? null,
    [competencyLibQuery.data, competency],
  );

  const profileCompetency = useMemo(
    () => profileQuery.data?.competencies.find((item) => item.name === competency) ?? null,
    [profileQuery.data?.competencies, competency],
  );

  const generatorContext = useMemo(() => {
    if (profileQuery.data && profileCompetency) {
      return buildJobProfileProblemContext({
        profile: profileQuery.data.profile,
        competency: profileCompetency,
        libraryEntry: selectedCompetencyEntry,
      });
    }
    return buildCompetencyProblemContext(selectedCompetencyEntry, { seniorityLevel });
  }, [profileQuery.data, profileCompetency, selectedCompetencyEntry, seniorityLevel]);

  useEffect(() => {
    if (!profileId || !profileQuery.data || competency) return;
    const preferred =
      profileQuery.data.competencies.find((item) => item.name === profileCompetencyParam) ??
      profileQuery.data.competencies.find((item) => item.category === 'hard') ??
      profileQuery.data.competencies[0];
    if (preferred?.name) setCompetency(preferred.name);
  }, [profileId, profileQuery.data, profileCompetencyParam, competency]);

  useEffect(() => {
    if (profileQuery.data?.profile.seniority_level) {
      setSeniorityLevel(profileQuery.data.profile.seniority_level);
    }
  }, [profileQuery.data?.profile.seniority_level]);

  const [topicTag, setTopicTag] = useState<string>('Data Structures');
  const [topicTags, setTopicTags] = useState<string[]>(['Data Structures']);

  useEffect(() => {
    if (!competency) return;
    setTopicTags((prev) => [competency, ...prev.filter((tag) => tag !== competency)]);
  }, [competency]);

  const [problemPattern, setProblemPattern] = useState(patternsForTopic('Data Structures')[0] ?? '');
  const [aiGeneratorType, setAiGeneratorType] = useState<AiGeneratorType>('coding');

  const [generateOptions, setGenerateOptions] = useState<ProblemGenerateOptions>(DEFAULT_PROBLEM_GENERATE_OPTIONS);
  const [databaseGenerateOptions, setDatabaseGenerateOptions] = useState<DatabaseGenerateOptions>(
    DEFAULT_DATABASE_GENERATE_OPTIONS,
  );
  const [databaseType, setDatabaseType] = useState<DatabaseType>('MySQL');
  const [databaseQuestionType, setDatabaseQuestionType] = useState<'scenario' | 'simple'>('scenario');
  const [customAiInstructions, setCustomAiInstructions] = useState('');
  const [seedRandomSeed, setSeedRandomSeed] = useState(42);
  const [seedSize, setSeedSize] = useState<SeedSize>('medium');
  const [requiresSandboxDatabase, setRequiresSandboxDatabase] = useState(false);
  const [databaseSchemaDdl, setDatabaseSchemaDdl] = useState('');
  const [databaseSeedSql, setDatabaseSeedSql] = useState('');
  const [sampleQueries, setSampleQueries] = useState('');
  const [entityRelationshipNotes, setEntityRelationshipNotes] = useState('');
  const [timeComplexity, setTimeComplexity] = useState<string | null>(null);
  const [spaceComplexity, setSpaceComplexity] = useState<string | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [inputSizeConstraint, setInputSizeConstraint] = useState(DEFAULT_PROBLEM_CONSTRAINTS.inputSize);
  const [valueRangeConstraint, setValueRangeConstraint] = useState(DEFAULT_PROBLEM_CONSTRAINTS.valueRange);
  const [memoryLimitMb, setMemoryLimitMb] = useState(DEFAULT_PROBLEM_CONSTRAINTS.memoryLimitMb);

  const [title, setTitle] = useState('');
  const [problemDifficulty, setProblemDifficulty] = useState<ProblemDifficulty>('medium');
  const [timeLimitMs, setTimeLimitMs] = useState(2000);
  const [statement, setStatement] = useState(DEFAULT_STATEMENT);
  const [statementTab, setStatementTab] = useState<StatementTab>('statement');
  const [codeTab, setCodeTab] = useState<CodeTab>('solution');
  const [marks, setMarks] = useState(20);
  const [workspaceType, setWorkspaceType] = useState('code');
  const [evaluationMode, setEvaluationMode] = useState<'TESTCASE' | 'AI' | 'HYBRID'>('TESTCASE');
  const [allowAiHelp, setAllowAiHelp] = useState(true);
  const [privateLibrary, setPrivateLibrary] = useState(false);
  const [allowedLanguages, setAllowedLanguages] = useState<string[]>(['javascript', 'python', 'java', 'cpp', 'php']);
  const [starterCodeMap, setStarterCodeMap] = useState<Record<string, string>>({});
  const [internalSolutionMap, setInternalSolutionMap] = useState<Record<string, string>>({});
  const [testCases, setTestCases] = useState<DraftCase[]>([]);

  const detailSetters = {
    setTitle,
    setStatement,
    setProblemDifficulty,
    setMarks,
    setWorkspaceType,
    setEvaluationMode,
    setAllowAiHelp,
    setPrivateLibrary,
    setAllowedLanguages,
    setTopicTag,
    setTopicTags,
    setTestCases,
    setStarterCodeMap,
    setInternalSolutionMap,
    setHints,
    setInputSizeConstraint,
    setValueRangeConstraint,
    setMemoryLimitMb,
    setTimeLimitMs,
    setDatabaseSchemaDdl,
    setDatabaseSeedSql,
    setDatabaseType,
    setSampleQueries,
    setRequiresSandboxDatabase,
  };

  useEffect(() => {
    if (!editId || !editQuery.data || editLoaded) return;
    loadProblemDetailIntoForm(editQuery.data, detailSetters);
    const ws = String(editQuery.data.workspaceType ?? editQuery.data.workspace_type ?? '');
    if (ws === 'sql') setAiGeneratorType('database');
    setEditLoaded(true);
  }, [editId, editQuery.data, editLoaded]);

  useEffect(() => {
    setProblemPattern((current) => {
      const options = patternsForTopic(topicTag);
      if (current && (options.includes(current) || options.length === 0)) return current;
      return options[0] ?? '';
    });
    setTopicTags([topicTag]);
  }, [topicTag]);

  useEffect(() => {
    if (aiGeneratorType === 'database') {
      if (topicTag !== 'Database Design') setTopicTag('Database Design');
      setWorkspaceType('sql');
      setAllowedLanguages(['sql']);
    } else if (aiGeneratorType === 'coding') {
      if (topicTag === 'Database Design') setTopicTag('Data Structures');
      setWorkspaceType('code');
      setAllowedLanguages((prev) => (prev.length === 1 && prev[0] === 'sql' ? ['javascript', 'python', 'java', 'cpp'] : prev));
    }
  }, [aiGeneratorType, topicTag]);



  const isSqlOnlyAssessment = workspaceType === 'sql';
  const showSandboxDatabaseSections =
    isSqlOnlyAssessment || (aiGeneratorType === 'coding' && requiresSandboxDatabase);

  const codingGenerateLabels = useMemo(
    () =>
      PROBLEM_GENERATE_OPTION_LABELS.filter(
        (item) =>
          (item.key !== 'databaseSchema' && item.key !== 'seedData') || requiresSandboxDatabase,
      ),
    [requiresSandboxDatabase],
  );

  useEffect(() => {
    if (!generatorContext?.techStack || editId) return;
    const inferred = inferLanguagesFromTechStack(generatorContext.techStack);
    setAllowedLanguages(inferred);
    const primary = inferred[0] as keyof typeof DEFAULT_STARTER_BY_LANGUAGE;
    if (DEFAULT_STARTER_BY_LANGUAGE[primary]) {
      setStarterCodeMap((prev) => ({ ...prev, [primary]: DEFAULT_STARTER_BY_LANGUAGE[primary]! }));
    }
  }, [generatorContext?.techStack, editId]);

  const canGenerateAi = Boolean(problemPattern) && Boolean(competency) && Boolean(generatorContext);

  const languageTemplates = useMemo(
    () =>
      allowedLanguages.map((language_code) => ({
        language_code,
        starter_code: starterCodeMap[language_code] ?? starterCodeMap[allowedLanguages[0] ?? 'javascript'] ?? '',
        internal_solution: internalSolutionMap[language_code] ?? internalSolutionMap[allowedLanguages[0] ?? 'javascript'] ?? '',
      })),
    [allowedLanguages, starterCodeMap, internalSolutionMap],
  );

  const readiness = useMemo(() => {
    const basicInfo = Boolean(title.trim()) && Boolean(problemDifficulty);
    const statementReady = statement.trim().length > 40;
    if (isSqlOnlyAssessment) {
      const schemaReady = databaseSchemaDdl.trim().length > 20;
      const seedReady = databaseSeedSql.trim().length > 20;
      return { basicInfo, statementReady, testCaseReady: seedReady, validationReady: schemaReady, schemaReady, seedReady };
    }
    const testCaseReady = testCases.filter((c) => c.inputValue.trim() && c.expectedOutput.trim()).length >= 2;
    const validationReady = Boolean(Object.values(internalSolutionMap).some(s => s.trim()));
    if (requiresSandboxDatabase) {
      const schemaReady = databaseSchemaDdl.trim().length > 20;
      const seedReady = databaseSeedSql.trim().length > 20;
      return {
        basicInfo,
        statementReady,
        testCaseReady: testCaseReady && seedReady,
        validationReady: validationReady && schemaReady,
        schemaReady,
        seedReady,
      };
    }
    return { basicInfo, statementReady, testCaseReady, validationReady, schemaReady: false, seedReady: false };
  }, [
    title,
    problemDifficulty,
    statement,
    testCases,
    internalSolutionMap,
    isSqlOnlyAssessment,
    requiresSandboxDatabase,
    databaseSchemaDdl,
    databaseSeedSql,
  ]);

  const includeDatabaseAssessment =
    isSqlOnlyAssessment || (requiresSandboxDatabase && aiGeneratorType === 'coding');

  const buildPayload = (status: 'draft' | 'published') => ({
    title: title.trim() || 'New coding problem',
    statementMd: statement.trim() || 'Describe the algorithm and write code.',
    difficulty: problemDifficulty,
    marks,
    status,
    topicTags: topicTags.length ? topicTags : undefined,
    allowedLanguages,
    timeLimitMinutes: Math.max(1, Math.round(timeLimitMs / 60000)),
    workspaceType,
    evaluationMode: allowAiHelp ? evaluationMode : 'TESTCASE',
    environmentConfig: {
      runtime: isSqlOnlyAssessment ? 'sql_sandbox' : 'sandbox',
      memory_mb: memoryLimitMb,
      timeout_seconds: Math.max(2, Math.round(timeLimitMs / 1000)),
      constraints: {
        input_size: inputSizeConstraint,
        value_range: valueRangeConstraint,
      },
      ...(includeDatabaseAssessment
        ? {
            database_assessment: {
              database_type: databaseType,
              ddl_sql: databaseSchemaDdl.trim() || undefined,
              seed_sql: databaseSeedSql.trim() || undefined,
              random_seed: seedRandomSeed,
              seed_size: seedSize,
              sample_queries: sampleQueries.trim()
                ? (() => {
                    try {
                      return JSON.parse(sampleQueries);
                    } catch {
                      return undefined;
                    }
                  })()
                : undefined,
              relationships_notes: entityRelationshipNotes.trim() || undefined,
            },
          }
        : {}),
    },
    evaluationConfig: {
      mode: allowAiHelp ? evaluationMode : 'TESTCASE',
      pass_threshold_pct: 100,
      private_library: privateLibrary,
    },
    language_templates: languageTemplates,
    test_cases: testCases,
    hints: hints.length ? hints : undefined,
  });

  const saveMutation = useMutation({
    mutationFn: async (status: 'draft' | 'published') => {
      const payload = buildPayload(status);
      if (editId) {
        await updateProblemBankProblem(editId, payload);
        if (testCases.length) await upsertProblemBankTestCases(editId, testCases);
        if (status === 'published') await publishProblemBankProblem(editId);
        return { id: editId };
      }
      const created = await createProblemBankProblem(payload);
      if (testCases.length) await upsertProblemBankTestCases(created.id, testCases);
      if (status === 'published') await publishProblemBankProblem(created.id);
      return created;
    },
    onSuccess: async () => {
      // Invalidate queries so the problem bank list refreshes with the new problem
      await queryClient.invalidateQueries({ queryKey: ['problem-bank'] });
      router.push('/assessments/job-profiles/problem-bank');
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message || err?.message || 'Failed to save problem');
    },
  });

  
  const verifyMutation = useMutation({
    mutationFn: async () => {
      const activeLanguage = allowedLanguages[0];
      const solution = internalSolutionMap[activeLanguage ?? 'javascript'] ?? '';
      if (!activeLanguage || !solution) throw new Error('No internal solution or language provided.');
      
      const payload = {
        language: activeLanguage,
        sourceCode: solution,
        testCases: testCases.filter((tc) => Boolean(tc.inputValue)),
      };
      const res = await verifyProblemDraft(payload);
      setValidationResult(res);
      setIsValidationModalOpen(true);
      return res;
    },
    onError: (err: any) => {
      alert(err?.response?.data?.message || err.message);
    }
  });

  const aiMutation = useMutation({
    mutationFn: () => {
      setAiGenerateWarning(null);
      if (!canGenerateAi || !generatorContext) {
        throw new Error('Select a competency and problem pattern before generating.');
      }
      const shared = {
        competency_name: generatorContext.competencyName,
        competency_description: generatorContext.competencyDescription,
        seniority_level: generatorContext.seniorityLevel,
        industry_domain: generatorContext.industryDomain,
        tech_stack: generatorContext.techStack,
        job_role: generatorContext.jobRole,
        ...(profileId ? { job_profile_id: profileId } : {}),
        topic_tag: competency || topicTag,
        problem_pattern: problemPattern,
        difficulty: problemDifficulty,
      };
      if (aiGeneratorType === 'database') {
        return generateDatabaseAssessmentAiDraft({
          ...shared,
          database_type: databaseType,
          database_question_type: databaseQuestionType,
          custom_instructions: customAiInstructions,
          seed_options: { random_seed: seedRandomSeed, size: seedSize },
          generate: {
            problem_statement: databaseGenerateOptions.problemStatement,
            database_schema: databaseGenerateOptions.databaseSchema,
            seed_data: databaseGenerateOptions.seedData,
            entity_descriptions: databaseGenerateOptions.entityDescriptions,
            relationships: databaseGenerateOptions.relationships,
            sql_queries: databaseGenerateOptions.sqlQueries,
            hints: databaseGenerateOptions.hints,
          },
        });
      }
      return generateProblemBankAiDraft({
        ...shared,
        custom_instructions: customAiInstructions,
        code_skeleton: 'scaffolded',
        allowed_languages: allowedLanguages,
        requires_sandbox_database: requiresSandboxDatabase,
        database_type: databaseType,
        seed_options: requiresSandboxDatabase
          ? { random_seed: seedRandomSeed, size: seedSize }
          : undefined,
        constraints: {
          input_size: inputSizeConstraint,
          value_range: valueRangeConstraint,
          memory_mb: memoryLimitMb,
          time_limit_ms: timeLimitMs,
        },
        generate: {
          problem_statement: generateOptions.problemStatement,
          starter_code: generateOptions.starterCode,
          internal_solution: generateOptions.internalSolution,
          test_cases: generateOptions.testCases,
          complexity_analysis: generateOptions.complexityAnalysis,
          hints: generateOptions.hints,
          ...(requiresSandboxDatabase
            ? {
                database_schema: generateOptions.databaseSchema,
                seed_data: generateOptions.seedData,
              }
            : {}),
        },
      });
    },
    onSuccess: (data) => {
      const draft = data.draft as Record<string, unknown>;
      // Show banner if Gemini auto-fixed issues
      if (Array.isArray((data as any).validation_issues_fixed)) {
        setValidationFixedIssues((data as any).validation_issues_fixed);
      } else {
        setValidationFixedIssues(null);
      }
      const statementMd = typeof draft.statement_md === 'string' ? draft.statement_md.trim() : '';
      const titleText = typeof draft.title === 'string' ? draft.title.trim() : '';
      if (!statementMd && !titleText) {
        setAiGenerateWarning(
          'AI returned an empty draft - filled from template where possible. Try again or adjust pattern/topic.',
        );
      } else {
        setAiGenerateWarning(null);
      }
      if (aiGeneratorType === 'database') {
        if (databaseGenerateOptions.problemStatement) {
          if (typeof draft.problem_title === 'string') setTitle(draft.problem_title);
          else if (typeof draft.title === 'string') setTitle(draft.title);
          if (typeof draft.statement_md === 'string') setStatement(draft.statement_md);
        }
        const schema = draft.database_schema as Record<string, unknown> | undefined;
        if (databaseGenerateOptions.databaseSchema && schema?.ddl_sql) {
          setDatabaseSchemaDdl(String(schema.ddl_sql));
        }
        const seed = draft.seed_data as Record<string, unknown> | undefined;
        if (databaseGenerateOptions.seedData && seed?.insert_sql) {
          setDatabaseSeedSql(String(seed.insert_sql));
        }
        if (databaseGenerateOptions.relationships && Array.isArray(draft.relationships)) {
          setEntityRelationshipNotes(JSON.stringify(draft.relationships, null, 2));
        }
        if (databaseGenerateOptions.sqlQueries && Array.isArray(draft.sample_queries)) {
          setSampleQueries(JSON.stringify(draft.sample_queries, null, 2));
        }
        if (databaseGenerateOptions.hints && Array.isArray(draft.hints)) {
          setHints(draft.hints.map((hint) => String(hint)));
        }
        setWorkspaceType('sql');
        setAllowedLanguages(['sql']);
        return;
      }
      if (generateOptions.problemStatement) {
        if (typeof draft.problem_title === 'string') setTitle(draft.problem_title);
        else if (typeof draft.title === 'string') setTitle(draft.title);
        if (typeof draft.statement_md === 'string') setStatement(draft.statement_md);
      }
      if (generateOptions.starterCode && draft.starter_code) {
        setStarterCodeMap(draft.starter_code as Record<string, string>);
      }
      if (generateOptions.internalSolution && draft.internal_solution) {
        setInternalSolutionMap(draft.internal_solution as Record<string, string>);
      }
      if (generateOptions.testCases && Array.isArray(draft.suggested_test_cases)) {
        setTestCases(
          draft.suggested_test_cases.map((row) => ({
            inputValue: formatTestCaseValue((row as { input_value?: unknown }).input_value),
            expectedOutput: formatTestCaseValue((row as { expected_output?: unknown }).expected_output),
            isVisible: Number((row as { is_visible?: number }).is_visible ?? 1),
            isEdgeCase: Number((row as { is_edge_case?: number }).is_edge_case ?? 0),
          })),
        );
      }
      if (generateOptions.complexityAnalysis) {
        if (typeof draft.time_complexity === 'string') setTimeComplexity(draft.time_complexity);
        if (typeof draft.space_complexity === 'string') setSpaceComplexity(draft.space_complexity);
      }
      if (generateOptions.hints && Array.isArray(draft.hints)) {
        setHints(draft.hints.map((hint) => String(hint)));
      }
      if (requiresSandboxDatabase) {
        const schema = draft.database_schema as Record<string, unknown> | undefined;
        if (generateOptions.databaseSchema && schema?.ddl_sql) {
          setDatabaseSchemaDdl(String(schema.ddl_sql));
        }
        const seed = draft.seed_data as Record<string, unknown> | undefined;
        if (generateOptions.seedData && seed?.insert_sql) {
          setDatabaseSeedSql(String(seed.insert_sql));
        }
        if (typeof seed?.random_seed === 'number') setSeedRandomSeed(seed.random_seed);
        if (typeof seed?.size === 'string') setSeedSize(seed.size as SeedSize);
      }
      const suggested = draft.constraints_suggested as Record<string, unknown> | undefined;
      if (suggested) {
        if (typeof suggested.input_size === 'string') setInputSizeConstraint(suggested.input_size);
        if (typeof suggested.value_range === 'string') setValueRangeConstraint(suggested.value_range);
        if (typeof suggested.memory_mb === 'number') setMemoryLimitMb(suggested.memory_mb);
        if (typeof suggested.time_limit_ms === 'number') setTimeLimitMs(suggested.time_limit_ms);
      }
    },
  });

  const complexityProgress = timeComplexity && spaceComplexity ? 100 : aiMutation.isPending ? 45 : 0;

  return (
    <div className="w-full pb-8">
      <div className="grid w-full grid-cols-12 gap-8">
          <div className="col-span-12 space-y-6 xl:col-span-8">
            <header className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display-lg text-[var(--assessment-on-surface)]">
                  {editId
                    ? isSqlOnlyAssessment
                      ? 'Edit SQL Assessment'
                      : 'Edit Coding Problem'
                    : isSqlOnlyAssessment
                      ? 'Create SQL Assessment'
                      : 'Create Coding Problem'}
                </h1>
                <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                  Design rigorous assessments for engineering candidates.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => {
                    if (confirm('Are you sure you want to reset the form? All unsaved changes will be lost.')) {
                      window.location.reload();
                    }
                  }}
                  className="rounded-xl border border-[var(--assessment-outline)] px-6 py-2 font-title-sm font-bold text-[var(--assessment-on-surface)] transition hover:bg-[var(--assessment-surface-container-high)]"
                >
                  Reset Form
                </button>
                <button
                  type="button"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate('draft')}
                  className="rounded-xl border border-[var(--assessment-outline)] px-6 py-2 font-title-sm font-bold text-[var(--assessment-on-surface)] transition hover:bg-[var(--assessment-surface-container-high)] disabled:opacity-60"
                >
                  Save Draft
                </button>
                <button
                  type="button"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate('published')}
                  className="flex items-center gap-2 rounded-xl bg-[var(--assessment-primary)] px-6 py-2 font-title-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  <AssessmentMaterialIcon name="publish" size={20} />
                  Publish Problem
                </button>
              </div>
            </header>

            {/* Problem identity */}
            <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="font-label-caps text-[var(--assessment-on-surface-variant)]">Problem Title</label>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Enter problem name..."
                    className="w-full border-b-2 border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-3 py-2 text-base font-semibold outline-none transition focus:border-[var(--assessment-primary)]"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="font-label-caps text-[var(--assessment-on-surface-variant)]">Difficulty</label>
                    <DifficultySegmentedControl value={problemDifficulty} onChange={setProblemDifficulty} />
                  </div>
                  <div className="space-y-2">
                    <label className="font-label-caps text-[var(--assessment-on-surface-variant)]">Topic Tag</label>
                    <ProblemTopicSearchSelect value={topicTag} onChange={setTopicTag} hideLabel />
                  </div>
                </div>
              </div>
              <div className="mt-6 space-y-3">
                <label className="font-label-caps text-[var(--assessment-on-surface-variant)]">Constraints</label>
                <div className="grid grid-cols-1 gap-4 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4 md:grid-cols-2">
                  <label className="space-y-1 text-sm">
                    <span className="font-label-caps text-[var(--assessment-on-surface-variant)]">Input size (n)</span>
                    <input
                      value={inputSizeConstraint}
                      onChange={(e) => setInputSizeConstraint(e.target.value)}
                      placeholder="1 ≤ n ≤ 10^5"
                      className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--assessment-primary)]"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-label-caps text-[var(--assessment-on-surface-variant)]">Value range</span>
                    <input
                      value={valueRangeConstraint}
                      onChange={(e) => setValueRangeConstraint(e.target.value)}
                      placeholder="1 ≤ val ≤ 10^9"
                      className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 font-mono text-xs outline-none focus:border-[var(--assessment-primary)]"
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-label-caps text-[var(--assessment-on-surface-variant)]">Memory limit</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={64}
                        value={memoryLimitMb}
                        onChange={(e) => setMemoryLimitMb(Number(e.target.value) || 256)}
                        className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm outline-none focus:border-[var(--assessment-primary)]"
                      />
                      <span className="shrink-0 text-xs text-[var(--assessment-on-surface-variant)]">MB</span>
                    </div>
                  </label>
                  <label className="space-y-1 text-sm">
                    <span className="font-label-caps text-[var(--assessment-on-surface-variant)]">Time limit</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={500}
                        value={timeLimitMs}
                        onChange={(e) => setTimeLimitMs(Number(e.target.value) || 2000)}
                        className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm outline-none focus:border-[var(--assessment-primary)]"
                      />
                      <span className="shrink-0 text-xs text-[var(--assessment-on-surface-variant)]">ms</span>
                    </div>
                  </label>
                </div>
              </div>
              {topicTags.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {topicTags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-[var(--assessment-primary-container)] px-3 py-1 font-label-caps text-[var(--assessment-on-primary-container)]"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </section>

            {/* Statement editor */}
            <section className="overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] shadow-sm">
              <div className="flex border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]">
                <button
                  type="button"
                  onClick={() => setStatementTab('statement')}
                  className={`px-6 py-3 text-sm font-bold ${
                    statementTab === 'statement'
                      ? 'border-b-2 border-[var(--assessment-primary)] bg-[var(--assessment-surface-container)] text-[var(--assessment-primary)]'
                      : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-high)]'
                  }`}
                >
                  Problem Statement
                </button>
                <button
                  type="button"
                  onClick={() => setStatementTab('preview')}
                  className={`px-6 py-3 text-sm ${
                    statementTab === 'preview'
                      ? 'border-b-2 border-[var(--assessment-primary)] bg-[var(--assessment-surface-container)] font-bold text-[var(--assessment-primary)]'
                      : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-high)]'
                  }`}
                >
                  Markdown Preview
                </button>
              </div>
              {statementTab === 'statement' ? (
                <textarea
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  spellCheck={false}
                  rows={12}
                  className="min-h-64 w-full resize-none border-none bg-[var(--assessment-surface-container)] p-6 font-mono text-sm text-[var(--assessment-on-surface)] outline-none"
                />
              ) : (
                <div className="min-h-64 whitespace-pre-wrap p-6 font-mono text-sm text-[var(--assessment-on-surface)]">
                  {statement}
                </div>
              )}
              <div className="flex gap-4 border-t border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-2 text-[var(--assessment-on-surface-variant)]">
                {['format_bold', 'format_italic', 'code', 'link', 'image'].map((icon) => (
                  <button key={icon} type="button" className="hover:text-[var(--assessment-primary)]">
                    <AssessmentMaterialIcon name={icon} size={20} />
                  </button>
                ))}
              </div>
            </section>

            {showSandboxDatabaseSections ? (
              <>
                <section className="overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] shadow-sm">
                  <div className="border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-6 py-4">
                    <h3 className="font-title-sm font-bold">
                      {isSqlOnlyAssessment ? 'Database Schema (DDL)' : 'Sandbox Database Schema (DDL)'}
                    </h3>
                    <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                      {isSqlOnlyAssessment
                        ? 'CREATE TABLE statements with keys, constraints, and indexes.'
                        : 'Pre-loaded schema applied before candidate code runs in the sandbox.'}
                    </p>
                  </div>
                  <textarea
                    value={databaseSchemaDdl}
                    onChange={(e) => setDatabaseSchemaDdl(e.target.value)}
                    spellCheck={false}
                    rows={14}
                    placeholder="-- CREATE TABLE ..."
                    className="min-h-64 w-full resize-y border-none bg-[#1E1E1E] p-6 font-mono text-sm text-[#D4D4D4] outline-none"
                  />
                </section>
                <section className="overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] shadow-sm">
                  <div className="border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-6 py-4">
                    <h3 className="font-title-sm font-bold">
                      {isSqlOnlyAssessment ? 'Seed Data (INSERT SQL)' : 'Sandbox Seed Data (INSERT SQL)'}
                    </h3>
                    <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                      Executable INSERT statements - deterministic seed {seedRandomSeed} ({seedSize}).
                    </p>
                  </div>
                  <textarea
                    value={databaseSeedSql}
                    onChange={(e) => setDatabaseSeedSql(e.target.value)}
                    spellCheck={false}
                    rows={14}
                    placeholder="INSERT INTO ..."
                    className="min-h-64 w-full resize-y border-none bg-[#1E1E1E] p-6 font-mono text-sm text-[#D4D4D4] outline-none"
                  />
                </section>
                {sampleQueries ? (
                  <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
                    <h3 className="mb-3 font-title-sm font-bold">Sample Interview Queries</h3>
                    <textarea
                      value={sampleQueries}
                      onChange={(e) => setSampleQueries(e.target.value)}
                      rows={8}
                      className="w-full resize-y rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4 font-mono text-xs outline-none"
                    />
                  </section>
                ) : null}
              </>
            ) : null}

            {/* Code tabs */}
            {!isSqlOnlyAssessment ? (
            <section className="overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] shadow-sm">
              <div className="flex border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]">
                {(
                  [
                    { id: 'starter' as const, label: 'Starter Code' },
                    { id: 'solution' as const, label: 'Internal Solution' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setCodeTab(tab.id)}
                    className={`border-r border-[var(--assessment-outline-variant)] px-6 py-4 text-sm ${
                      codeTab === tab.id
                        ? 'border-b-2 border-[var(--assessment-primary)] bg-[var(--assessment-surface-container)] font-bold text-[var(--assessment-primary)]'
                        : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-high)]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
                <button
                  type="button"
                  className="px-6 py-4 text-sm text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-high)]"
                >
                  Test Cases
                </button>
              </div>
              <div className="relative">
                <div className="absolute top-4 right-4 z-10">
                  <button
                    type="button"
                    className="flex items-center gap-2 rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-bold text-white transition hover:brightness-110"
                  >
                    <AssessmentMaterialIcon name="play_arrow" size={20} />
                    Run Validation
                  </button>
                </div>
                <CodeEditorPanel
                  value={
                    codeTab === 'starter'
                      ? starterCodeMap[allowedLanguages[0] ?? 'javascript'] ?? ''
                      : internalSolutionMap[allowedLanguages[0] ?? 'javascript'] ?? ''
                  }
                  onChange={(val) => {
                    const lang = allowedLanguages[0] ?? 'javascript';
                    if (codeTab === 'starter') {
                      setStarterCodeMap((prev) => ({ ...prev, [lang]: val }));
                    } else {
                      setInternalSolutionMap((prev) => ({ ...prev, [lang]: val }));
                    }
                  }}
                />
              </div>
            </section>
            ) : null}

            {/* Test cases table */}
            {!isSqlOnlyAssessment ? (
            <section className="overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] shadow-sm">
              <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] p-6">
                <h3 className="font-title-sm font-bold">Test Cases</h3>
                <button
                  type="button"
                  onClick={() =>
                    setTestCases((prev) => [
                      ...prev,
                      { inputValue: '', expectedOutput: '', isVisible: 1, isEdgeCase: 0 },
                    ])
                  }
                  className="flex items-center gap-1 text-sm font-bold text-[var(--assessment-primary)] hover:underline"
                >
                  <AssessmentMaterialIcon name="add_circle" size={18} />
                  Add Manual Case
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-[var(--assessment-surface-container-low)] font-label-caps text-[var(--assessment-on-surface-variant)]">
                      <th className="border-b border-[var(--assessment-outline-variant)] px-6 py-4">Order</th>
                      <th className="border-b border-[var(--assessment-outline-variant)] px-6 py-4">Input Data</th>
                      <th className="border-b border-[var(--assessment-outline-variant)] px-6 py-4">Expected Output</th>
                      <th className="border-b border-[var(--assessment-outline-variant)] px-6 py-4 text-center">Visible</th>
                      <th className="border-b border-[var(--assessment-outline-variant)] px-6 py-4 text-center">Edge Case</th>
                      <th className="border-b border-[var(--assessment-outline-variant)] px-6 py-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {testCases.map((testCase, index) => (
                      <tr
                        key={index}
                        className={`transition hover:bg-[var(--assessment-surface-container-high)] ${
                          index % 2 === 1 ? 'bg-[var(--assessment-surface-container-low)]/30' : ''
                        }`}
                      >
                        <td className="border-b border-[var(--assessment-outline-variant)] px-6 py-4 font-mono text-[var(--assessment-on-surface-variant)]">
                          {String(index + 1).padStart(2, '0')}
                        </td>
                        <td className="border-b border-[var(--assessment-outline-variant)] px-6 py-4">
                          <input
                            value={testCase.inputValue}
                            onChange={(e) =>
                              setTestCases((prev) =>
                                prev.map((row, i) => (i === index ? { ...row, inputValue: e.target.value } : row)),
                              )
                            }
                            className="w-full rounded border-none bg-[var(--assessment-surface-container)] px-2 py-1 font-mono text-xs text-[var(--assessment-primary)] outline-none"
                          />
                        </td>
                        <td className="border-b border-[var(--assessment-outline-variant)] px-6 py-4">
                          <input
                            value={testCase.expectedOutput}
                            onChange={(e) =>
                              setTestCases((prev) =>
                                prev.map((row, i) =>
                                  i === index ? { ...row, expectedOutput: e.target.value } : row,
                                ),
                              )
                            }
                            className="w-full rounded border-none bg-[var(--assessment-surface-container)] px-2 py-1 font-mono text-xs text-[var(--assessment-primary)] outline-none"
                          />
                        </td>
                        <td className="border-b border-[var(--assessment-outline-variant)] px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={testCase.isVisible === 1}
                            onChange={(e) =>
                              setTestCases((prev) =>
                                prev.map((row, i) =>
                                  i === index ? { ...row, isVisible: e.target.checked ? 1 : 0 } : row,
                                ),
                              )
                            }
                            className="rounded border-[var(--assessment-outline)] text-[var(--assessment-primary)]"
                          />
                        </td>
                        <td className="border-b border-[var(--assessment-outline-variant)] px-6 py-4 text-center">
                          <input
                            type="checkbox"
                            checked={testCase.isEdgeCase === 1}
                            onChange={(e) =>
                              setTestCases((prev) =>
                                prev.map((row, i) =>
                                  i === index ? { ...row, isEdgeCase: e.target.checked ? 1 : 0 } : row,
                                ),
                              )
                            }
                            className="rounded border-[var(--assessment-outline)] text-[var(--assessment-primary)]"
                          />
                        </td>
                        <td className="border-b border-[var(--assessment-outline-variant)] px-6 py-4">
                          <button
                            type="button"
                            onClick={() => setTestCases((prev) => prev.filter((_, i) => i !== index))}
                            className="text-[var(--assessment-outline)] hover:text-[var(--assessment-error)]"
                          >
                            <AssessmentMaterialIcon name="delete" size={20} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between bg-[var(--assessment-surface-container-low)] p-6">
                <div className="mr-4 flex flex-1 items-center gap-4 rounded-lg border border-[var(--nexus-secondary)]/20 bg-[var(--nexus-secondary-container)]/10 p-4">
                  <AssessmentMaterialIcon name="auto_awesome" size={24} className="text-[var(--nexus-secondary)]" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-[var(--nexus-secondary)]">Test Case Generator</p>
                    <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                      AI suggests boundary cases (e.g., Capacity=1, Max Keys).
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rounded-lg bg-[var(--nexus-secondary)] px-4 py-1.5 text-sm font-bold text-white hover:brightness-110"
                  >
                    Apply Suggested
                  </button>
                </div>
              </div>
            </section>
            ) : null}
          </div>

          {/* Right utility panel */}
          <div className="col-span-12 space-y-6 xl:col-span-4">
            <section className="overflow-hidden rounded-xl border border-[var(--nexus-secondary)]/30 bg-[var(--nexus-secondary-container)]/10 shadow-sm">
              <div className="flex items-center gap-2 bg-[var(--nexus-secondary)] p-4 text-white">
                <AssessmentMaterialIcon name="auto_awesome" size={20} style={{ fontVariationSettings: "'FILL' 1" }} />
                <h3 className="font-title-sm font-bold">AI Problem Architect</h3>
              </div>
              <div className="space-y-4 p-6">
                <div>
                  <label className="mb-2 block font-label-caps text-[var(--nexus-secondary)]">Generator Type</label>
                  <div className="flex gap-1">
                    {AI_GENERATOR_OPTIONS.map((option) => {
                      const active = aiGeneratorType === option.value;
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setAiGeneratorType(option.value)}
                          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-xs font-bold transition ${
                            active
                              ? 'border-[var(--nexus-secondary)] bg-[var(--nexus-secondary)] text-white'
                              : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface)]'
                          }`}
                        >
                          <AssessmentMaterialIcon name={option.icon} size={16} />
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="mb-2 block font-label-caps text-[var(--nexus-secondary)]">Competency</label>
                  <CompetencyLibrarySearchSelect
                    value={competency}
                    onChange={setCompetency}
                    hideLabel
                    category="hard"
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
                  <label className="mb-2 block font-label-caps text-[var(--nexus-secondary)]">Pattern / Topic</label>
                  <ProblemTopicSearchSelect value={topicTag} onChange={setTopicTag} hideLabel placeholder="Topic tag..." />
                </div>

                <DifficultySegmentedControl
                  value={problemDifficulty}
                  onChange={setProblemDifficulty}
                  label="Difficulty"
                  labelClassName="text-[var(--nexus-secondary)]"
                  activeClassName="bg-[var(--nexus-secondary)] text-white"
                />

                <div>
                  <label className="mb-2 block font-label-caps text-[var(--nexus-secondary)]">Problem Pattern</label>
                  <ProblemPatternSearchSelect
                    topic={topicTag}
                    value={problemPattern}
                    onChange={setProblemPattern}
                    hideLabel
                  />
                </div>

                <div className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-3">
                  {aiGeneratorType === 'database' ? (
                    <div className="grid grid-cols-1 gap-3">
                      <label className="space-y-1 text-xs">
                        <span className="font-label-caps text-[var(--nexus-secondary)]">Question Style</span>
                        <select
                          value={databaseQuestionType}
                          onChange={(e) => setDatabaseQuestionType(e.target.value as 'scenario' | 'simple')}
                          className="w-full rounded border border-[var(--assessment-outline-variant)] px-2 py-1.5 text-xs"
                        >
                          <option value="simple">Simple — LeetCode Style (Single Query, schema shown in problem)</option>
                          <option value="scenario">Scenario-based (Complex business problem, multiple queries)</option>
                        </select>
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="font-label-caps text-[var(--nexus-secondary)]">Database Type</span>
                        <select
                          value={databaseType}
                          onChange={(e) => setDatabaseType(e.target.value as DatabaseType)}
                          className="w-full rounded border border-[var(--assessment-outline-variant)] px-2 py-1.5 text-xs"
                        >
                          {DATABASE_TYPE_OPTIONS.map((type) => (
                            <option key={type} value={type}>
                              {type}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="text-[var(--assessment-on-surface-variant)]">Seed Size</span>
                        <select
                          value={seedSize}
                          onChange={(e) => setSeedSize(e.target.value as SeedSize)}
                          className="w-full rounded border border-[var(--assessment-outline-variant)] px-2 py-1.5 text-xs"
                        >
                          {SEED_SIZE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="space-y-1 text-xs">
                        <span className="text-[var(--assessment-on-surface-variant)]">Random Seed</span>
                        <input
                          type="number"
                          value={seedRandomSeed}
                          onChange={(e) => setSeedRandomSeed(Number(e.target.value) || 42)}
                          className="w-full rounded border border-[var(--assessment-outline-variant)] px-2 py-1.5 font-mono text-xs"
                        />
                      </label>
                    </div>
                  ) : (
                    <>
                      <p className="mb-3 font-label-caps text-[var(--nexus-secondary)]">Constraints</p>
                      <div className="grid grid-cols-1 gap-3">
                        <label className="space-y-1 text-xs">
                          <span className="text-[var(--assessment-on-surface-variant)]">Max Input Size</span>
                          <input
                            value={inputSizeConstraint}
                            onChange={(e) => setInputSizeConstraint(e.target.value)}
                            className="w-full rounded border border-[var(--assessment-outline-variant)] px-2 py-1.5 font-mono text-xs"
                          />
                        </label>
                        <label className="space-y-1 text-xs">
                          <span className="text-[var(--assessment-on-surface-variant)]">Time Limit</span>
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={500}
                              value={timeLimitMs}
                              onChange={(e) => setTimeLimitMs(Number(e.target.value) || 2000)}
                              className="w-full rounded border border-[var(--assessment-outline-variant)] px-2 py-1.5 text-xs"
                            />
                            <span className="text-[var(--assessment-on-surface-variant)]">ms</span>
                          </div>
                        </label>
                      </div>
                    </>
                  )}
                </div>

                <div className="space-y-3 pt-4">
                  <p className="font-label-caps text-[var(--nexus-secondary)]">Custom Instructions</p>
                  <label className="block text-xs text-[var(--assessment-on-surface-variant)]">
                    Provide any specific requirements, scenarios, or edge cases you want the AI to include in the generated problem.
                  </label>
                  <textarea
                    value={customAiInstructions}
                    onChange={(e) => setCustomAiInstructions(e.target.value)}
                    placeholder="E.g., Make the scenario about a food delivery startup like Zomato, and include a tricky edge case about canceled orders..."
                    className="h-24 w-full rounded border border-[var(--assessment-outline)] bg-[var(--assessment-surface)] px-3 py-2 text-sm text-[var(--assessment-on-surface)] placeholder:text-[var(--assessment-on-surface-variant)] focus:border-[var(--nexus-secondary)] focus:outline-none focus:ring-1 focus:ring-[var(--nexus-secondary)]"
                  />
                </div>



                {generatorContext ? (
                  <div className="space-y-2 border-t border-[var(--nexus-secondary)]/20 pt-4">
                    <p className="font-label-caps text-[var(--nexus-secondary)]">Generator context</p>
                    <div className="flex flex-wrap gap-2">
                        {[
                          { label: 'Competency', value: generatorContext.competencyName },
                          { label: 'Seniority', value: generatorContext.seniorityLabel },
                          { label: 'Domain', value: generatorContext.industryDomain },
                          { label: 'Stack', value: generatorContext.techStack || 'Inferred' },
                        ].map((chip) => (
                        <span
                          key={chip.label}
                          className="rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-1 text-[11px] text-[var(--assessment-on-surface-variant)]"
                        >
                          <span className="font-bold text-[var(--nexus-secondary)]">{chip.label}:</span> {chip.value}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}



                <button
                  type="button"
                  disabled={aiMutation.isPending || !canGenerateAi}
                  onClick={() => aiMutation.mutate()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--nexus-secondary)] py-2.5 font-title-sm font-bold text-white transition hover:opacity-90 disabled:opacity-60"
                >
                  {aiMutation.isPending
                    ? 'Generating & auto Validating...'
                    : aiGeneratorType === 'database'
                      ? 'Generate Database Assessment'
                      : 'Generate Problem with AI'}
                  <AssessmentMaterialIcon name="arrow_forward" size={18} />
                </button>
                {aiMutation.isError ? (
                  <p className="text-xs text-[var(--assessment-error)]">
                    {(aiMutation.error as Error).message || 'Generation failed. Try again.'}
                  </p>
                ) : null}
                {aiGenerateWarning ? (
                  <p className="text-xs text-amber-700">{aiGenerateWarning}</p>
                ) : null}
                {validationFixedIssues && validationFixedIssues.length > 0 && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs font-bold text-amber-800 mb-1">AI auto-fixed ✅ {validationFixedIssues.length} issue{validationFixedIssues.length > 1 ? 's' : ''} in this draft:</p>
                        <ul className="list-disc list-inside space-y-0.5">
                          {validationFixedIssues.map((issue, i) => (
                            <li key={i} className="text-xs text-amber-700">{issue}</li>
                          ))}
                        </ul>
                      </div>
                      <button onClick={() => setValidationFixedIssues(null)} className="text-amber-500 hover:text-amber-700 font-bold text-sm flex-shrink-0">✕</button>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {!isSqlOnlyAssessment ? (
            <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
              <h3 className="mb-4 font-title-sm font-bold">Complexity Analysis</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--assessment-on-surface-variant)]">Time Complexity</span>
                  <span className="font-mono font-bold text-[var(--assessment-on-surface)]">
                    {timeComplexity ?? '--'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--assessment-on-surface-variant)]">Space Complexity</span>
                  <span className="font-mono font-bold text-[var(--assessment-on-surface)]">
                    {spaceComplexity ?? '--'}
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--assessment-surface-container)]">
                  <div
                    className="h-full bg-[var(--nexus-secondary)] transition-all duration-500"
                    style={{ width: `${complexityProgress}%` }}
                  />
                </div>
                <p className="mt-1 text-[10px] italic text-[var(--assessment-on-surface-variant)]">
                  {aiMutation.isPending
                    ? 'Analyzing generated problem...'
                    : timeComplexity && spaceComplexity
                      ? 'Review and confirm complexity matches your solution.'
                      : 'Generate with Complexity Analysis checked to populate.'}
                </p>
              </div>
            </div>
            ) : null}

            {showSandboxDatabaseSections ? (
            <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
              <h3 className="mb-4 font-title-sm font-bold">Database Summary</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-[var(--assessment-on-surface-variant)]">Database</span>
                  <span className="font-mono font-bold">{databaseType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--assessment-on-surface-variant)]">Seed</span>
                  <span className="font-mono font-bold">
                    {seedRandomSeed} | {seedSize}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--assessment-on-surface-variant)]">DDL Lines</span>
                  <span className="font-mono font-bold">{databaseSchemaDdl.split('\n').length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[var(--assessment-on-surface-variant)]">Seed Statements</span>
                  <span className="font-mono font-bold">
                    {databaseSeedSql.split(';').filter((s) => s.trim()).length || 0}
                  </span>
                </div>
                <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--assessment-surface-container)]">
                  <div
                    className="h-full bg-[var(--nexus-secondary)] transition-all duration-500"
                    style={{
                      width: `${readiness.schemaReady && readiness.seedReady ? 100 : aiMutation.isPending ? 45 : readiness.schemaReady || readiness.seedReady ? 55 : 0}%`,
                    }}
                  />
                </div>
                <p className="mt-1 text-[10px] italic text-[var(--assessment-on-surface-variant)]">
                  {aiMutation.isPending
                    ? 'Generating schema and seed data...'
                    : readiness.schemaReady && readiness.seedReady
                      ? 'Review DDL and seed SQL before publishing.'
                      : 'Generate with Schema and Seed Data checked to populate.'}
                </p>
              </div>
            </div>
            ) : null}

            <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
              <h3 className="mb-4 font-title-sm font-bold">Problem Readiness</h3>
              <div className="relative space-y-6">
                <div className="absolute top-2 bottom-2 left-[11px] w-0.5 bg-[var(--assessment-outline-variant)]" />
                {[
                  { done: readiness.basicInfo, title: 'Basic Info', note: 'Title & difficulty set' },
                  { done: readiness.statementReady, title: 'Statement', note: 'Markdown verified' },
                  ...(isSqlOnlyAssessment
                    ? [
                        {
                          done: readiness.schemaReady,
                          active: !readiness.schemaReady && readiness.statementReady,
                          title: 'Schema',
                          note: databaseSchemaDdl.trim() ? 'DDL captured' : 'DDL not generated',
                        },
                        {
                          done: readiness.seedReady,
                          active: !readiness.seedReady && readiness.schemaReady,
                          title: 'Seed Data',
                          note: databaseSeedSql.trim() ? 'INSERT SQL captured' : 'Seed SQL not generated',
                        },
                      ]
                    : requiresSandboxDatabase
                      ? [
                          {
                            done: readiness.testCaseReady,
                            active: !readiness.testCaseReady && readiness.statementReady,
                            title: 'Test Cases',
                            note: `${testCases.length}/5 recommended cases`,
                          },
                          {
                            done: readiness.validationReady,
                            title: 'Validation',
                            note: readiness.validationReady ? 'Solution captured' : 'Solution not verified',
                          },
                          {
                            done: readiness.schemaReady,
                            active: !readiness.schemaReady && readiness.validationReady,
                            title: 'Schema',
                            note: databaseSchemaDdl.trim() ? 'DDL captured' : 'DDL not generated',
                          },
                          {
                            done: readiness.seedReady,
                            active: !readiness.seedReady && readiness.schemaReady,
                            title: 'Seed Data',
                            note: databaseSeedSql.trim() ? 'INSERT SQL captured' : 'Seed SQL not generated',
                          },
                        ]
                      : [
                          {
                            done: readiness.testCaseReady,
                            active: !readiness.testCaseReady && readiness.statementReady,
                            title: 'Test Cases',
                            note: `${testCases.length}/5 recommended cases`,
                          },
                          {
                            done: readiness.validationReady,
                            title: 'Validation',
                            note: readiness.validationReady ? 'Solution captured' : 'Solution not verified',
                          },
                        ]),
                ].map((step) => (
                  <div key={step.title} className="relative z-10 flex gap-4">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full ${
                        step.done
                          ? 'bg-[var(--assessment-primary)] text-white'
                          : step.active
                            ? 'border-2 border-[var(--assessment-primary)] bg-[var(--assessment-surface-container-highest)]'
                            : 'border-2 border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]'
                      }`}
                    >
                      {step.done ? (
                        <AssessmentMaterialIcon name="check" size={16} />
                      ) : step.active ? (
                        <div className="h-2 w-2 rounded-full bg-[var(--assessment-primary)]" />
                      ) : null}
                    </div>
                    <div>
                      <p
                        className={`text-sm font-bold ${
                          step.active ? 'text-[var(--assessment-primary)]' : 'text-[var(--assessment-on-surface)]'
                        }`}
                      >
                        {step.title}
                      </p>
                      <p className="text-xs text-[var(--assessment-on-surface-variant)]">{step.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="nexus-glass-ai space-y-4 rounded-xl border border-[var(--nexus-secondary)]/30 p-6">
              <div className="flex items-center gap-2">
                <AssessmentMaterialIcon name="lightbulb" size={20} className="text-[var(--nexus-secondary)]" />
                <h4 className="font-label-caps text-[var(--assessment-on-surface)]">AI Suggestions</h4>
              </div>
              <ul className="space-y-3 text-xs text-[var(--assessment-on-surface-variant)]">
                <li className="flex gap-2">
                  <span className="mt-0.5 text-[var(--nexus-secondary)]">-</span>
                  <p>
                    Add large-scale test cases if constraints mention high upper bounds.
                  </p>
                </li>
                <li className="flex gap-2">
                  <span className="mt-0.5 text-[var(--nexus-secondary)]">-</span>
                  <p>Clarify missing-key return behavior in the statement.</p>
                </li>
              </ul>
            </div>

            <div className="space-y-4 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
              <h3 className="font-label-caps text-[var(--assessment-on-surface-variant)]">Settings</h3>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-sm">Allow AI Help</span>
                <input
                  type="checkbox"
                  checked={allowAiHelp}
                  onChange={(e) => setAllowAiHelp(e.target.checked)}
                  className="h-5 w-10 rounded-full"
                />
              </label>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-sm">Private Library</span>
                <input
                  type="checkbox"
                  checked={privateLibrary}
                  onChange={(e) => setPrivateLibrary(e.target.checked)}
                  className="h-5 w-10 rounded-full"
                />
              </label>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <label className="space-y-1 text-xs">
                  <span className="font-label-caps text-[var(--assessment-on-surface-variant)]">Marks</span>
                  <input
                    type="number"
                    value={marks}
                    onChange={(e) => setMarks(Number(e.target.value))}
                    className="w-full rounded border border-[var(--assessment-outline-variant)] px-2 py-1"
                  />
                </label>
                <label className="space-y-1 text-xs">
                  <span className="font-label-caps text-[var(--assessment-on-surface-variant)]">Workspace</span>
                  <select
                    value={workspaceType}
                    onChange={(e) => setWorkspaceType(e.target.value)}
                    className="w-full rounded border border-[var(--assessment-outline-variant)] px-2 py-1"
                  >
                    <option value="code">Code</option>
                    <option value="sql">SQL / Database</option>
                    <option value="project">Project</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                {PROBLEM_LANGUAGE_OPTIONS.map((lang) => {
                  const selected = allowedLanguages.includes(lang);
                  return (
                    <button
                      key={lang}
                      type="button"
                      onClick={() =>
                        setAllowedLanguages((prev) =>
                          selected ? prev.filter((item) => item !== lang) : [...prev, lang],
                        )
                      }
                      className={`rounded-full border px-2 py-0.5 text-[11px] ${
                        selected
                          ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary-container)] text-white'
                          : 'border-[var(--assessment-outline-variant)]'
                      }`}
                    >
                      {lang}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => router.push('/assessments/job-profiles/problem-bank')}
                className="w-full rounded-lg border border-[var(--assessment-error)] py-2 text-sm font-bold text-[var(--assessment-error)] transition hover:bg-[var(--assessment-error-container)]/20"
              >
                Discard Problem
              </button>
            </div>
          </div>
      </div>
    </div>
  );
}
