/**
 * "Build & Defend" (project_interview) round_config — shared shape with backend
 * project-interview-round.types.ts.
 */

export type ProjectTechStackMode = 'mandatory' | 'allowed' | 'free_choice';
export type ProjectSubmissionType = 'github_url' | 'zip_upload' | 'excel_or_pdf';
export type ProjectDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type VivaQuestionSource = 'evaluation' | 'admin_rubric' | 'mix';

export type ProjectMustHaveRequirement = { id: string; text: string; weight: number };

export type ProjectAnswerKey = {
  filename: string;
  file_url: string;
  uploaded_at?: string;
};

export type ProjectRubricSubpart = { name: string; marks: number };
export type ProjectRubricTask = { id: string; name: string; subparts: ProjectRubricSubpart[] };
export type ProjectGradingRubric = { tasks: ProjectRubricTask[] };

export type ProjectAssessmentDocument = {
  filename: string;
  file_url: string;
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
  answer_key?: ProjectAnswerKey | null;
  supporting_datasets?: ProjectSupportingDataset[];
  attached_documents?: string[];
  category?: string;
  difficulty?: ProjectDifficulty;
};

export type ProjectInterviewRoundConfig = {
  project_choices: ProjectChoice[];
  /** Common Build/assessment time limit (hours) for all project choices. */
  max_assessment_hours: number;
  ai_interviewer: {
    focus_areas: string[];
    question_count: number;
    duration_minutes: number;
    viva_question_source?: VivaQuestionSource;
  };
  scoring_weights: { code_submission: number; interview_performance: number };
};

export const PROJECT_INTERVIEW_MAX_CHOICES = 6;
export const DEFAULT_PROJECT_INTERVIEW_WEIGHT_PCT = 60;
export const DEFAULT_PROJECT_INTERVIEW_CODE_WEIGHT_PCT = 40;
export const DEFAULT_PROJECT_INTERVIEW_MAX_ASSESSMENT_HOURS = 4;
export const PROJECT_INTERVIEW_SELECTION_COUNTDOWN_SECONDS = 600;

export const PROJECT_TECH_MODE_LABELS: Record<ProjectTechStackMode, string> = {
  mandatory: 'Mandatory stack',
  allowed: 'Allowed stacks',
  free_choice: 'Free choice',
};

export const PROJECT_DIFFICULTY_LABELS: Record<ProjectDifficulty, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const VIVA_QUESTION_SOURCE_LABELS: Record<VivaQuestionSource, string> = {
  evaluation: 'Candidate work & gaps only',
  admin_rubric: 'Admin topics only',
  mix: 'Balanced mix (recommended)',
};

/** Default Defend topic checklist for GitHub / ZIP projects. */
export const CODE_DEFEND_TOPIC_PRESETS = [
  'Tech stack & libraries',
  'Business logic & roles',
  'Project setup & scripts',
  'Data & edge cases',
  'Scale & tradeoffs',
] as const;

/** Default Defend topic checklist for Excel / PDF practicals. */
export const EXCEL_DEFEND_TOPIC_PRESETS = [
  'Formulas & lookups',
  'Absolute vs relative references',
  'Data validation & error checks',
  'Business assumptions',
  'Scaling the workbook',
] as const;

const VIVA_SOURCES: VivaQuestionSource[] = ['evaluation', 'admin_rubric', 'mix'];

export function normalizeVivaQuestionSource(raw: unknown): VivaQuestionSource {
  return VIVA_SOURCES.includes(raw as VivaQuestionSource) ? (raw as VivaQuestionSource) : 'mix';
}

export function defaultProjectChoice(index = 0): ProjectChoice {
  return {
    id: `project_${index + 1}_${Date.now().toString(36)}`,
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
      focus_areas: [...CODE_DEFEND_TOPIC_PRESETS],
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

function normalizeAssessmentDocument(raw: unknown): ProjectAssessmentDocument | null {
  if (!isObj(raw)) return null;
  const filename = typeof raw.filename === 'string' ? raw.filename.trim() : '';
  const fileUrl = typeof raw.file_url === 'string' ? raw.file_url.trim() : '';
  if (!filename || !fileUrl) return null;
  const extracted = typeof raw.extracted_text === 'string' ? raw.extracted_text.trim() : '';
  return {
    filename: filename.slice(0, 255),
    file_url: fileUrl.slice(0, 2048),
    ...(extracted ? { extracted_text: extracted.slice(0, 80_000) } : {}),
  };
}

function normalizeAnswerKey(raw: unknown): ProjectAnswerKey | null {
  if (!isObj(raw)) return null;
  const filename = typeof raw.filename === 'string' ? raw.filename.trim() : '';
  const fileUrl = typeof raw.file_url === 'string' ? raw.file_url.trim() : '';
  if (!filename || !fileUrl) return null;
  const uploaded = typeof raw.uploaded_at === 'string' ? raw.uploaded_at.trim() : '';
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
    if (!isObj(item)) continue;
    const filename = typeof item.filename === 'string' ? item.filename.trim() : '';
    const fileUrl = typeof item.file_url === 'string' ? item.file_url.trim() : '';
    if (!filename || !fileUrl) continue;
    out.push({ filename: filename.slice(0, 255), file_url: fileUrl.slice(0, 2048) });
    if (out.length >= 12) break;
  }
  return out;
}

export function normalizeGradingRubric(raw: unknown): ProjectGradingRubric | null {
  if (!isObj(raw) || !Array.isArray(raw.tasks)) return null;
  const tasks: ProjectRubricTask[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.tasks.length && tasks.length < 12; i++) {
    const item = raw.tasks[i];
    if (!isObj(item)) continue;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!name) continue;
    let id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : `task_${i + 1}`;
    while (seen.has(id)) id = `${id}_${i + 1}`;
    seen.add(id);
    const subparts: ProjectRubricSubpart[] = [];
    const rawSubs = Array.isArray(item.subparts) ? item.subparts : [];
    for (const sub of rawSubs) {
      if (subparts.length >= 20 || !isObj(sub)) continue;
      const partName = typeof sub.name === 'string' ? sub.name.trim() : '';
      const rawMarks = typeof sub.marks === 'number' ? sub.marks : Number(sub.marks);
      if (!partName || !Number.isFinite(rawMarks) || rawMarks < 1) continue;
      subparts.push({ name: partName.slice(0, 160), marks: Math.min(100, Math.round(rawMarks)) });
    }
    if (!subparts.length) continue;
    tasks.push({ id: id.slice(0, 80), name: name.slice(0, 160), subparts });
  }
  return tasks.length ? { tasks } : null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function normalizeScoringWeights(
  raw: Record<string, unknown>,
  fallback: ProjectInterviewRoundConfig['scoring_weights'],
): ProjectInterviewRoundConfig['scoring_weights'] {
  const hasCode = typeof raw.code_submission === 'number' || typeof raw.code_submission === 'string';
  const hasInterview =
    typeof raw.interview_performance === 'number' || typeof raw.interview_performance === 'string';
  if (!hasCode && !hasInterview) return { ...fallback };

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

export function parseProjectInterviewRoundConfig(raw: unknown): ProjectInterviewRoundConfig {
  const base = defaultProjectInterviewRoundConfig();
  if (!isObj(raw)) return base;
  const choices = Array.isArray(raw.project_choices)
    ? (raw.project_choices as unknown[]).filter(isObj).map((c, i) => {
        const d = defaultProjectChoice(i);
        const ts = isObj(c.tech_stack) ? c.tech_stack : {};
        const dl = isObj(c.deliverables) ? c.deliverables : {};
        const submission_type =
          c.submission_type === 'zip_upload' ||
          c.submission_type === 'excel_or_pdf' ||
          c.submission_type === 'github_url'
            ? c.submission_type
            : d.submission_type;
        const isExcel = submission_type === 'excel_or_pdf';
        return {
          ...d,
          ...(c as Partial<ProjectChoice>),
          id: typeof c.id === 'string' && c.id ? c.id : d.id,
          submission_type,
          twist_requirement: isExcel ? '' : (typeof c.twist_requirement === 'string' ? c.twist_requirement : d.twist_requirement),
          must_have_requirements: isExcel
            ? []
            : Array.isArray(c.must_have_requirements)
              ? (c.must_have_requirements as ProjectMustHaveRequirement[])
              : [],
          grading_rubric: isExcel ? undefined : normalizeGradingRubric(c.grading_rubric),
          tech_stack: isExcel
            ? { mode: 'free_choice' as const, languages_frameworks: [] }
            : { ...d.tech_stack, ...(ts as Partial<ProjectChoice['tech_stack']>) },
          deliverables: isExcel
            ? {
                require_readme: false,
                require_decisions_md: false,
                require_tests: false,
                run_instructions_required: false,
              }
            : { ...d.deliverables, ...(dl as Partial<ProjectChoice['deliverables']>) },
          assessment_document: normalizeAssessmentDocument(c.assessment_document),
          answer_key: normalizeAnswerKey(c.answer_key),
          supporting_datasets: isExcel ? [] : normalizeSupportingDatasets(c.supporting_datasets),
        } as ProjectChoice;
      })
    : base.project_choices;
  const ai = isObj(raw.ai_interviewer) ? raw.ai_interviewer : {};
  const sw = isObj(raw.scoring_weights) ? raw.scoring_weights : {};
  const legacyHours =
    typeof choices[0]?.duration_hours === 'number' ? choices[0].duration_hours : base.max_assessment_hours;
  const maxHoursRaw = raw.max_assessment_hours;
  const max_assessment_hours =
    typeof maxHoursRaw === 'number' && Number.isFinite(maxHoursRaw)
      ? Math.min(168, Math.max(1, Math.round(maxHoursRaw)))
      : Math.min(168, Math.max(1, Math.round(legacyHours)));

  const aiBase = base.ai_interviewer;
  return {
    project_choices: choices,
    max_assessment_hours,
    ai_interviewer: {
      focus_areas: Array.isArray(ai.focus_areas)
        ? (ai.focus_areas as unknown[]).filter((x): x is string => typeof x === 'string')
        : aiBase.focus_areas,
      // HR sets any count ≥ 1 — no product max.
      question_count: clampInt(ai.question_count, 1, Number.MAX_SAFE_INTEGER, aiBase.question_count),
      duration_minutes: clampInt(ai.duration_minutes, 5, 20, aiBase.duration_minutes),
      viva_question_source: normalizeVivaQuestionSource(
        ai.viva_question_source ?? aiBase.viva_question_source,
      ),
    },
    scoring_weights: normalizeScoringWeights(sw, base.scoring_weights),
  };
}

/** A round is ready once every project has a title and description (Excel also needs key + problem). */
export function isProjectInterviewConfigured(raw: unknown): boolean {
  const cfg = parseProjectInterviewRoundConfig(raw);
  return (
    cfg.project_choices.length > 0 &&
    cfg.project_choices.every((c) => {
      if (!c.title.trim() || !c.description_md.trim()) return false;
      if (c.submission_type === 'excel_or_pdf') {
        return Boolean(c.assessment_document?.file_url && c.answer_key?.file_url);
      }
      return true;
    })
  );
}
