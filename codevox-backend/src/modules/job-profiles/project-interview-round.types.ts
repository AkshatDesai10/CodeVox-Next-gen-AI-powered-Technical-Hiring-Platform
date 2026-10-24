/**
 * "Build & Defend" (PROJECT_INTERVIEW) round_config — shared shape with frontend
 * project-interview-round.types.ts.
 */

export type ProjectTechStackMode = 'mandatory' | 'allowed' | 'free_choice';
export type ProjectSubmissionType = 'github_url' | 'zip_upload' | 'excel_or_pdf';
export type ProjectDifficulty = 'beginner' | 'intermediate' | 'advanced';
/** How Defend questions are synthesized after Build grading. */
export type VivaQuestionSource = 'evaluation' | 'admin_rubric' | 'mix';

export type ProjectMustHaveRequirement = { id: string; text: string; weight: number };

/** Master answer key — never exposed to candidates. */
export type ProjectAnswerKey = {
  filename: string;
  file_url: string;
  uploaded_at?: string;
};

/** Marks the document grader must use. The model is not allowed to invent tasks or totals. */
export type ProjectRubricSubpart = { name: string; marks: number };
export type ProjectRubricTask = { id: string; name: string; subparts: ProjectRubricSubpart[] };
export type ProjectGradingRubric = { tasks: ProjectRubricTask[] };

export type ProjectAssessmentDocument = {
  filename: string;
  file_url: string;
  /** Parsed document text for the grader. Never sent to the candidate. */
  extracted_text?: string;
};

export type ProjectSupportingDataset = {
  filename: string;
  file_url: string;
};

export type ProjectChoice = {
  id: string;
  title: string;
  description_md: string;
  twist_requirement?: string;
  must_have_requirements: ProjectMustHaveRequirement[];
  /** Stored mark scheme for document grading. Hidden from the candidate. */
  grading_rubric?: ProjectGradingRubric | null;
  tech_stack: { mode: ProjectTechStackMode; languages_frameworks: string[] };
  deliverables: {
    require_readme: boolean;
    require_decisions_md: boolean;
    require_tests: boolean;
    run_instructions_required: boolean;
  };
  duration_hours: number;
  submission_type: ProjectSubmissionType;
  assessment_document?: ProjectAssessmentDocument | null;
  /** Excel practical: hidden master key (.xlsx). Required when submission_type is excel_or_pdf. */
  answer_key?: ProjectAnswerKey | null;
  supporting_datasets?: ProjectSupportingDataset[];
  attached_documents?: string[];
  /** Selection-grid presentation only. */
  category?: string;
  difficulty?: ProjectDifficulty;
};

export type ProjectInterviewRoundConfig = {
  project_choices: ProjectChoice[];
  /**
   * Common Build/assessment time limit (hours) for every project choice.
   * Applied when the candidate starts the selected project (`due_at`).
   */
  max_assessment_hours: number;
  ai_interviewer: {
    focus_areas: string[];
    question_count: number;
    duration_minutes: number;
    /** Default mix. Controls Defend Q synthesis for all submission modes. */
    viva_question_source?: VivaQuestionSource;
  };
  /**
   * Final round score mix: code build (requirements_score_pct) vs verbal defense.
   * Values should sum to 100.
   */
  scoring_weights: { code_submission: number; interview_performance: number };
};

export const PROJECT_INTERVIEW_MAX_CHOICES = 6;
/** Default share of the round score from the verbal defense (code gets the remainder). */
export const DEFAULT_PROJECT_INTERVIEW_WEIGHT_PCT = 60;
export const DEFAULT_PROJECT_INTERVIEW_CODE_WEIGHT_PCT = 40;
export const DEFAULT_PROJECT_INTERVIEW_MAX_ASSESSMENT_HOURS = 4;
/** Display-only project-selection countdown (seconds). Expiry behaviour is deferred. */
export const PROJECT_INTERVIEW_SELECTION_COUNTDOWN_SECONDS = 600;

const TECH_MODES: ProjectTechStackMode[] = ['mandatory', 'allowed', 'free_choice'];
const SUBMISSION_TYPES: ProjectSubmissionType[] = ['github_url', 'zip_upload', 'excel_or_pdf'];
const DIFFICULTIES: ProjectDifficulty[] = ['beginner', 'intermediate', 'advanced'];
const VIVA_SOURCES: VivaQuestionSource[] = ['evaluation', 'admin_rubric', 'mix'];

export function normalizeVivaQuestionSource(raw: unknown): VivaQuestionSource {
  return VIVA_SOURCES.includes(raw as VivaQuestionSource) ? (raw as VivaQuestionSource) : 'mix';
}

export function defaultProjectChoice(index = 0): ProjectChoice {
  return {
    id: `project_${index + 1}`,
    title: '',
    description_md: '',
    twist_requirement: '',
    must_have_requirements: [],
    tech_stack: { mode: 'free_choice', languages_frameworks: [] },
    deliverables: {
      require_readme: true,
      require_decisions_md: false,
      require_tests: false,
      run_instructions_required: true,
    },
    duration_hours: 72,
    submission_type: 'github_url',
    attached_documents: [],
    category: '',
    difficulty: 'intermediate',
  };
}

export function defaultProjectInterviewRoundConfig(): ProjectInterviewRoundConfig {
  return {
    project_choices: [defaultProjectChoice(0)],
    max_assessment_hours: DEFAULT_PROJECT_INTERVIEW_MAX_ASSESSMENT_HOURS,
    ai_interviewer: {
      focus_areas: [
        'Tech stack & libraries',
        'Business logic & roles',
        'Project setup & scripts',
        'Data & edge cases',
        'Scale & tradeoffs',
      ],
      question_count: 5,
      duration_minutes: 15,
      viva_question_source: 'mix',
    },
    scoring_weights: {
      code_submission: DEFAULT_PROJECT_INTERVIEW_CODE_WEIGHT_PCT,
      interview_performance: DEFAULT_PROJECT_INTERVIEW_WEIGHT_PCT,
    },
  };
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function strList(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === 'string')
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, max);
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeAssessmentDocument(raw: unknown): ProjectAssessmentDocument | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const filename = str(r.filename).trim();
  const fileUrl = str(r.file_url).trim();
  if (!filename || !fileUrl) return null;
  const extracted = str(r.extracted_text).trim();
  return {
    filename: filename.slice(0, 255),
    file_url: fileUrl.slice(0, 2048),
    ...(extracted ? { extracted_text: extracted.slice(0, 80_000) } : {}),
  };
}

function normalizeAnswerKey(raw: unknown): ProjectAnswerKey | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const filename = str(r.filename).trim();
  const fileUrl = str(r.file_url).trim();
  if (!filename || !fileUrl) return null;
  const uploaded = str(r.uploaded_at).trim();
  return {
    filename: filename.slice(0, 255),
    file_url: fileUrl.slice(0, 2048),
    ...(uploaded ? { uploaded_at: uploaded.slice(0, 64) } : {}),
  };
}

function normalizeSupportingDatasets(raw: unknown): ProjectSupportingDataset[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectSupportingDataset[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    const filename = str(r.filename).trim();
    const fileUrl = str(r.file_url).trim();
    if (!filename || !fileUrl) continue;
    out.push({ filename: filename.slice(0, 255), file_url: fileUrl.slice(0, 2048) });
    if (out.length >= 12) break;
  }
  return out;
}

function normalizeRequirements(raw: unknown): ProjectMustHaveRequirement[] {
  if (!Array.isArray(raw)) return [];
  const out: ProjectMustHaveRequirement[] = [];
  const seen = new Set<string>();
  raw.forEach((item, i) => {
    if (!item || typeof item !== 'object') return;
    const r = item as Record<string, unknown>;
    const text = str(r.text).trim();
    if (!text) return;
    let id = str(r.id).trim() || `req_${i + 1}`;
    while (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    out.push({ id, text, weight: clampInt(r.weight, 0, 100, 1) });
  });
  return out;
}

export function normalizeGradingRubric(raw: unknown): ProjectGradingRubric | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tasksRaw = (raw as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasksRaw)) return null;
  const tasks: ProjectRubricTask[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < tasksRaw.length && tasks.length < 12; i++) {
    const item = tasksRaw[i];
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const name = str(row.name).trim();
    if (!name) continue;
    let id = str(row.id).trim() || `task_${i + 1}`;
    while (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    const subparts: ProjectRubricSubpart[] = [];
    const rawSubs = Array.isArray(row.subparts) ? row.subparts : [];
    for (const sub of rawSubs) {
      if (subparts.length >= 20) break;
      if (!sub || typeof sub !== 'object') continue;
      const part = sub as Record<string, unknown>;
      const partName = str(part.name).trim();
      if (!partName) continue;
      const rawMarks = typeof part.marks === 'number' ? part.marks : Number(part.marks);
      if (!Number.isFinite(rawMarks) || rawMarks < 1) continue;
      subparts.push({ name: partName.slice(0, 160), marks: Math.min(100, Math.round(rawMarks)) });
    }
    if (!subparts.length) continue;
    tasks.push({ id: id.slice(0, 80), name: name.slice(0, 160), subparts });
  }
  return tasks.length ? { tasks } : null;
}

/** Spreads relative marks into integers that sum to 100. Used when the document printed no marks. */
export function scaleRubricMarksTo100(rubric: ProjectGradingRubric): ProjectGradingRubric {
  const located: Array<{ task: number; part: number }> = [];
  rubric.tasks.forEach((task, taskIndex) => {
    task.subparts.forEach((_, partIndex) => located.push({ task: taskIndex, part: partIndex }));
  });
  if (located.length === 0 || located.length > 100) return rubric;
  const weights = located.map((row) => rubric.tasks[row.task]?.subparts[row.part]?.marks ?? 0);
  const weightTotal = weights.reduce((sum, mark) => sum + mark, 0);
  if (weightTotal === 100) return rubric;
  const base = weightTotal > 0 ? weights : located.map(() => 1);
  const baseTotal = base.reduce((sum, mark) => sum + mark, 0);
  const raw = base.map((mark) => (mark / baseTotal) * 100);
  const marks = raw.map((value) => Math.floor(value));
  let leftover = 100 - marks.reduce((sum, mark) => sum + mark, 0);
  const byFraction = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const row of byFraction) {
    if (leftover <= 0) break;
    marks[row.index] = (marks[row.index] ?? 0) + 1;
    leftover -= 1;
  }
  for (let i = 0; i < marks.length; i++) {
    if ((marks[i] ?? 0) > 0) continue;
    const donor = marks.findIndex((mark) => mark > 1);
    if (donor < 0) break;
    marks[donor] = (marks[donor] ?? 0) - 1;
    marks[i] = 1;
  }
  const tasks = rubric.tasks.map((task) => ({
    ...task,
    subparts: task.subparts.map((part) => ({ ...part })),
  }));
  located.forEach((row, index) => {
    const part = tasks[row.task]?.subparts[row.part];
    if (part) part.marks = marks[index] ?? 1;
  });
  return { tasks };
}

function normalizeChoice(raw: unknown, index: number): ProjectChoice {
  const base = defaultProjectChoice(index);
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const ts = (r.tech_stack && typeof r.tech_stack === 'object' ? r.tech_stack : {}) as Record<
    string,
    unknown
  >;
  const dl = (r.deliverables && typeof r.deliverables === 'object' ? r.deliverables : {}) as Record<
    string,
    unknown
  >;
  const mode = TECH_MODES.includes(ts.mode as ProjectTechStackMode)
    ? (ts.mode as ProjectTechStackMode)
    : base.tech_stack.mode;
  const submissionType = SUBMISSION_TYPES.includes(r.submission_type as ProjectSubmissionType)
    ? (r.submission_type as ProjectSubmissionType)
    : base.submission_type;
  const difficulty = DIFFICULTIES.includes(r.difficulty as ProjectDifficulty)
    ? (r.difficulty as ProjectDifficulty)
    : base.difficulty;
  const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
  const isExcel = submissionType === 'excel_or_pdf';
  return {
    id: str(r.id).trim() || base.id,
    title: str(r.title).trim(),
    description_md: str(r.description_md),
    // Excel/PDF practical: score from answer key — drop code-project checklist fields.
    twist_requirement: isExcel ? '' : str(r.twist_requirement).trim(),
    must_have_requirements: isExcel ? [] : normalizeRequirements(r.must_have_requirements),
    grading_rubric: isExcel ? undefined : normalizeGradingRubric(r.grading_rubric),
    tech_stack: isExcel
      ? { mode: 'free_choice' as const, languages_frameworks: [] }
      : { mode, languages_frameworks: strList(ts.languages_frameworks) },
    deliverables: isExcel
      ? {
          require_readme: false,
          require_decisions_md: false,
          require_tests: false,
          run_instructions_required: false,
        }
      : {
          require_readme: bool(dl.require_readme, base.deliverables.require_readme),
          require_decisions_md: bool(dl.require_decisions_md, base.deliverables.require_decisions_md),
          require_tests: bool(dl.require_tests, base.deliverables.require_tests),
          run_instructions_required: bool(
            dl.run_instructions_required,
            base.deliverables.run_instructions_required,
          ),
        },
    duration_hours: clampInt(r.duration_hours, 1, 24 * 30, base.duration_hours),
    submission_type: submissionType,
    assessment_document: normalizeAssessmentDocument(r.assessment_document),
    answer_key: normalizeAnswerKey(r.answer_key),
    supporting_datasets: isExcel ? [] : normalizeSupportingDatasets(r.supporting_datasets),
    attached_documents: strList(r.attached_documents, 20),
    category: str(r.category).trim(),
    difficulty,
  };
}

export function normalizeProjectInterviewRoundConfig(raw: unknown): ProjectInterviewRoundConfig {
  const base = defaultProjectInterviewRoundConfig();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;

  const choices = Array.isArray(r.project_choices)
    ? r.project_choices.slice(0, PROJECT_INTERVIEW_MAX_CHOICES).map(normalizeChoice)
    : base.project_choices;
  const seen = new Set<string>();
  for (let i = 0; i < choices.length; i++) {
    let id = choices[i].id;
    while (seen.has(id)) id = `${id}_${i + 1}`;
    choices[i].id = id;
    seen.add(id);
  }

  const ai = (r.ai_interviewer && typeof r.ai_interviewer === 'object'
    ? r.ai_interviewer
    : {}) as Record<string, unknown>;
  const sw = (r.scoring_weights && typeof r.scoring_weights === 'object'
    ? r.scoring_weights
    : {}) as Record<string, unknown>;

  const maxAssessmentHours = clampInt(
    r.max_assessment_hours,
    1,
    168,
    // Backfill from first choice duration when older configs lack the round-level field.
    choices[0]?.duration_hours ?? base.max_assessment_hours,
  );

  return {
    project_choices: choices,
    max_assessment_hours: maxAssessmentHours,
    ai_interviewer: {
      focus_areas: Array.isArray(ai.focus_areas)
        ? strList(ai.focus_areas, 12)
        : base.ai_interviewer.focus_areas,
      // HR sets any count ≥ 1 — no product max.
      question_count: clampInt(ai.question_count, 1, Number.MAX_SAFE_INTEGER, base.ai_interviewer.question_count),
      duration_minutes: clampInt(ai.duration_minutes, 5, 20, base.ai_interviewer.duration_minutes),
      viva_question_source: normalizeVivaQuestionSource(
        ai.viva_question_source ?? base.ai_interviewer.viva_question_source,
      ),
    },
    scoring_weights: normalizeScoringWeights(sw, base.scoring_weights),
  };
}

function normalizeScoringWeights(
  raw: Record<string, unknown>,
  fallback: ProjectInterviewRoundConfig['scoring_weights'],
): ProjectInterviewRoundConfig['scoring_weights'] {
  const hasCode = typeof raw.code_submission === 'number' || typeof raw.code_submission === 'string';
  const hasInterview =
    typeof raw.interview_performance === 'number' || typeof raw.interview_performance === 'string';
  if (!hasCode && !hasInterview) return { ...fallback };

  // Legacy configs only stored interview_performance (remainder was competency rubric).
  if (!hasCode && hasInterview) {
    const interview = clampInt(raw.interview_performance, 0, 100, fallback.interview_performance);
    return { code_submission: 100 - interview, interview_performance: interview };
  }
  if (hasCode && !hasInterview) {
    const code = clampInt(raw.code_submission, 0, 100, fallback.code_submission);
    return { code_submission: code, interview_performance: 100 - code };
  }

  let code = clampInt(raw.code_submission, 0, 100, fallback.code_submission);
  let interview = clampInt(raw.interview_performance, 0, 100, fallback.interview_performance);
  const sum = code + interview;
  if (sum <= 0) return { ...fallback };
  if (sum !== 100) {
    interview = clampInt(interview, 0, 100, fallback.interview_performance);
    code = 100 - interview;
  }
  return { code_submission: code, interview_performance: interview };
}

/** Candidate-facing view: no interviewer settings or scoring weights. */
export function sanitizeProjectChoiceForCandidate(choice: ProjectChoice) {
  const isExcel = choice.submission_type === 'excel_or_pdf';
  return {
    id: choice.id,
    title: choice.title,
    description_md: choice.description_md,
    twist_requirement: isExcel ? null : choice.twist_requirement || null,
    must_have_requirements: isExcel
      ? []
      : choice.must_have_requirements.map((r) => ({ id: r.id, text: r.text })),
    tech_stack: isExcel
      ? { mode: 'free_choice' as const, languages_frameworks: [] }
      : choice.tech_stack,
    deliverables: isExcel
      ? {
          require_readme: false,
          require_decisions_md: false,
          require_tests: false,
          run_instructions_required: false,
        }
      : choice.deliverables,
    duration_hours: choice.duration_hours, // legacy; runtime uses round max_assessment_hours
    submission_type: choice.submission_type,
    assessment_document: choice.assessment_document
      ? { filename: choice.assessment_document.filename, file_url: choice.assessment_document.file_url }
      : null,
    // answer_key intentionally omitted — never send master key to candidates.
    supporting_datasets: isExcel
      ? []
      : (choice.supporting_datasets ?? []).map((file) => ({
          filename: file.filename,
          file_url: file.file_url,
        })),
    attached_documents: choice.attached_documents ?? [],
    category: choice.category || null,
    difficulty: choice.difficulty ?? null,
  };
}

export function validateProjectInterviewStages(
  stages: Array<{ stageType: string; roundConfig?: unknown }>,
): string | null {
  const rounds = stages.filter((s) => s.stageType === 'project_interview');
  if (rounds.length === 0) return null;
  if (rounds.length > 1) return 'Only one Build & Defend round is allowed per job profile.';
  const cfg = normalizeProjectInterviewRoundConfig(rounds[0].roundConfig);
  if (cfg.project_choices.length === 0) {
    return 'Build & Defend requires at least one project choice.';
  }
  const untitled = cfg.project_choices.findIndex((c) => !c.title.trim());
  if (untitled >= 0) return `Build & Defend project #${untitled + 1} needs a title.`;
  const undescribed = cfg.project_choices.findIndex((c) => !c.description_md.trim());
  if (undescribed >= 0) return `Build & Defend project #${undescribed + 1} needs a description.`;
  const excelMissingKey = cfg.project_choices.findIndex(
    (c) => c.submission_type === 'excel_or_pdf' && !c.answer_key?.file_url,
  );
  if (excelMissingKey >= 0) {
    return `Build & Defend project #${excelMissingKey + 1} (Excel/PDF) needs a Master Answer Key (.xlsx).`;
  }
  const excelMissingProblem = cfg.project_choices.findIndex(
    (c) => c.submission_type === 'excel_or_pdf' && !c.assessment_document?.file_url,
  );
  if (excelMissingProblem >= 0) {
    return `Build & Defend project #${excelMissingProblem + 1} (Excel/PDF) needs a problem sheet for candidates to download.`;
  }
  return null;
}
