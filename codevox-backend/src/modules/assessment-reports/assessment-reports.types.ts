export type StageEvalStatus =
  | 'pending'
  | 'evaluating'
  | 'in_progress'
  | 'in_review'
  | 'completed'
  | 'failed'
  | 'skipped';

export type ReportStatus = 'passed' | 'under_review' | 'failed' | 'in_progress';

export type Recommendation =
  | 'strong_hire'
  | 'hire'
  | 'under_review'
  | 'evaluating'
  | 'reject'
  | 'flagged'
  | 'disqualified'
  | 'retake'
  | null;

export type NormalizedAiEvaluation = {
  status: 'ready' | 'evaluating' | 'pending' | 'unavailable';
  summary?: string;
  strengths: string[];
  improvements: string[];
  scoreJustification?: string;
  criteria?: Array<{
    label: string;
    score?: number | null;
    max?: number | null;
    passed?: boolean;
    note?: string;
  }>;
  meta?: Record<string, string | number | boolean | null>;
};

export type RoundSummaryItem = {
  stageId: string;
  stageType: string;
  label: string;
  scorePct: number | null;
  status: StageEvalStatus;
  endedByCandidate?: boolean;
};

export type AssessmentReportListItem = {
  applicationId: string;
  candidate: { id: string; name: string; email: string; initials: string };
  jobProfile: { id: string; title: string; requisitionLabel?: string | null };
  overallScorePct: number | null;
  resumeScore: number | null;
  roundsSummary: RoundSummaryItem[];
  reportStatus: ReportStatus;
  recommendation: Recommendation;
  updatedAt: string;
  appliedAt: string;
  /** Composite shortlist score combining objective score and transcript/JD depth */
  shortlistScore?: number | null;
  /** High potential gem / top pick / score inflated tag */
  shortlistBadge?: 'top_pick' | 'hidden_gem' | 'score_inflated' | null;
  shortlistRationale?: string | null;
};

export type AssessmentReportsSummary = {
  totalCandidates: number;
  completedCount: number;
  activeCandidates: number;
  avgCohortScorePct: number | null;
  strongHireCount: number;
  pendingReviewCount: number;
};

export type AssessmentReportsListResponse = {
  items: AssessmentReportListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export type CodingQuestionReport = {
  problemId: string;
  title: string;
  difficulty?: string | null;
  language: string | null;
  testsPassed: number | null;
  testsTotal: number | null;
  runtimeMs?: number | null;
  memoryMb?: number | null;
  scorePct: number | null;
  aiEvaluation: NormalizedAiEvaluation | null;
  rawAiPayload: unknown;
};

export type CodingStageReport = {
  stageType: 'coding';
  stageId: string;
  label: string;
  status: StageEvalStatus;
  scorePct: number | null;
  questionsPassed: number | null;
  questionsTotal: number | null;
  durationMinutes: number | null;
  runtimeEnv?: string | null;
  questions: CodingQuestionReport[];
};

export type TakeHomeStageReport = {
  stageType: 'take_home';
  stageId: string;
  label: string;
  status: StageEvalStatus;
  scorePct: number | null;
  durationMinutes: number | null;
  subtitle?: string | null;
  artifacts: { type: string | null; githubUrl: string | null };
  rubric: Array<{
    id: string;
    label: string;
    score?: number | null;
    max?: number | null;
    passed?: boolean;
    feedback?: string;
  }>;
  scoresBreakdown: {
    accuracy?: number;
    code_quality?: number;
    originality?: number;
  } | null;
  aiEvaluation: NormalizedAiEvaluation | null;
  rawAiPayload: unknown;
  plagiarismScore: number | null;
  aiProbability: number | null;
};

export type VerbalStageReport = {
  stageType: 'screening' | 'ai_verbal' | 'hr_verbal' | 'project_interview';
  stageId: string;
  label: string;
  status: StageEvalStatus;
  scorePct: number | null;
  durationMinutes: number | null;
  competencies: Array<{ key: string; label: string; scorePct: number | null; note?: string; timeSpent?: number; turnCount?: number }>;
  /** Build & Defend only: selected project, repo and LLM project_profile. */
  project?: {
    submission_id: string;
    status: string;
    project_id: string | null;
    project_title: string | null;
    submission_type?: 'github_url' | 'zip_upload' | 'excel_or_pdf' | null;
    github_url: string | null;
    github_branch: string | null;
    submission_file_url?: string | null;
    submission_file_name?: string | null;
    submission_file_format?: string | null;
    submitted_at: string | null;
    evaluated_at: string | null;
    duration_minutes?: number | null;
    build_duration_minutes?: number | null;
    defend_duration_minutes?: number | null;
    interview_token: string | null;
    project_profile: Record<string, unknown> | null;
    scoring_weights?: { code_submission: number; interview_performance: number };
    code_build_score_pct?: number | null;
    verbal_defend_score_pct?: number | null;
    final_combined_score_pct?: number | null;
  } | null;
  aiEvaluation: NormalizedAiEvaluation | null;
  /** Playback URL for this stage's ses_ session only — never another round. */
  recordingUrl?: string | null;
  /** Per-track clips from interview_recordings (screen / voice / camera). */
  recordings?: Array<{
    id: string;
    candidateToken: string;
    engine: string | null;
    stageId: string | null;
    status: string;
    startedAt: string;
    endedAt: string | null;
    playbackUrl: string | null;
    phase: string;
    kind: string;
    label: string;
    mediaType: 'audio' | 'video';
  }>;
  interviewReportPath: string | null;
  /** Behavioural / tech Q&A turns for inline transcript on the report detail page. */
  transcript: Array<{
    turnIndex: number;
    role: 'agent' | 'candidate';
    text: string;
    competencyId?: string | null;
  }>;
  hrVoiceAudit: Record<string, unknown> | null;
  rawAiPayload: unknown;
  integrityDisqualification?: IntegrityDisqualification | null;
  endedByCandidate?: boolean;
};

export type IntegrityDisqualification = {
  disqualified: boolean;
  status?: 'flagged' | 'disqualified' | 'retake';
  overrideAction?: 'disqualify' | 'allow_retake' | null;
  overrideNote?: string | null;
  overrideAt?: string | null;
  reason: string;
  details?: string;
  stageName?: string;
  stageId?: string;
  sessionToken?: string;
  eventTime?: string;
  fraudRiskScore?: number;
  criticalCount?: number;
  totalEvents?: number;
};

export type AiScreeningStageReport = {
  stageType: 'ai_screening';
  stageId: string;
  label: string;
  status: StageEvalStatus;
  scorePct: null;
  durationMinutes?: number | null;
  analyzerStatus: string;
  checks: unknown[];
  conversationState: unknown;
  /** Full screening Q&A (from screeningVoiceAudit.transcript or stage1 chat). */
  transcript: Array<{ turnIndex: number; role: 'agent' | 'candidate'; text: string }>;
  recordingUrl?: string | null;
  /** Per-track clips from interview_recordings (screen / voice / camera). */
  recordings?: Array<{
    id: string;
    candidateToken: string;
    engine: string | null;
    stageId: string | null;
    status: string;
    startedAt: string;
    endedAt: string | null;
    playbackUrl: string | null;
    phase: string;
    kind: string;
    label: string;
    mediaType: 'audio' | 'video';
  }>;
  interviewReportPath?: string | null;
  endedByCandidate?: boolean;
  aiEvaluation: NormalizedAiEvaluation | null;
  rawAiPayload: unknown;
};

export type GenericStageReport = {
  stageType: string;
  stageId: string;
  label: string;
  status: StageEvalStatus;
  scorePct: number | null;
  durationMinutes?: number | null;
  aiEvaluation: NormalizedAiEvaluation | null;
  rawAiPayload: unknown;
};

export type AssessmentStageReport =
  | CodingStageReport
  | TakeHomeStageReport
  | VerbalStageReport
  | AiScreeningStageReport
  | GenericStageReport;

export type OverallEvidenceItem = {
  source: string;
  stageType?: string | null;
  headline?: string | null;
  competency?: string | null;
  detail: string;
};

export type OverallHireDecision = 'strong_hire' | 'hire' | 'under_review' | 'do_not_hire';

export type OverallEvaluation = {
  decision: OverallHireDecision;
  summary: string;
  whyHire: OverallEvidenceItem[];
  whyNotHire: OverallEvidenceItem[];
  weightedScorePct: number | null;
  sourceWeights: Record<string, number>;
  generatedAt: string;
  generatedBy: 'llm' | 'heuristic';
  holisticScore?: number | null;
  shortlistScore?: number | null;
  shortlistBadge?: 'top_pick' | 'hidden_gem' | 'score_inflated' | null;
  shortlistRationale?: string | null;
};

export type AssessmentReportDetail = {
  application: {
    id: string;
    status: string;
    pendingHumanReview: boolean;
    autoAction: string | null;
    candidateToken: string | null;
    appliedAt: string;
    totalDurationMinutes: number | null;
  };
  candidate: {
    id: string;
    name: string;
    email: string;
    phone?: string | null;
    linkedinUrl?: string | null;
    initials: string;
  };
  jobProfile: { id: string; title: string };
  overallScorePct: number | null;
  /** Weighted roll-up (assessment / AI verbal high; resume / behaviour low). */
  weightedScorePct?: number | null;
  resumeScore: number | null;
  overallPoints?: { earned: number; total: number } | null;
  cohortRank?: { topPercent: number; cohortSize: number } | null;
  recommendation: Recommendation;
  actionRequired?: { message: string } | null;
  integrityDisqualification?: IntegrityDisqualification | null;
  /** Present once all rounds are complete (or after regenerate). */
  overallEvaluation?: OverallEvaluation | null;
  stages: AssessmentStageReport[];
};

export type AssessmentReportsListFilters = {
  q?: string;
  jobProfileId?: string;
  stageType?: string;
  /** Single status or comma-separated (e.g. passed,failed). */
  status?: string;
  minScore?: number;
  maxScore?: number;
  page?: number;
  pageSize?: number;
  /** Calendar window ending now: 1 = today, 2 = last two days, 7 = last seven days. */
  windowDays?: number;
  /** Filter by appliedAt (default) or updatedAt within the window. */
  windowField?: 'appliedAt' | 'updatedAt';
  /** Optional custom date range: ISO date or YYYY-MM-DD. */
  startDate?: string;
  endDate?: string;
  sortBy?: 'score' | 'recent' | 'name';
};
