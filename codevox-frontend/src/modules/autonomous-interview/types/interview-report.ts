export type InterviewTurn = {
  turn_index: number;
  topic_domain: string;
  level: string;
  question_asked: string;
  candidate_reply: string;
  intent_label: string;
  confidence_delta: number;
  active_provider: string;
  model: string;
  action_mode: string;
  resume_tech: string;
  strike_count: number;
  tech_index: number;
  concept_tested?: string | null;
  understanding_level?: string | null;
  internal_score_10?: number | null;
  evidence?: string | null;
};

export type PerSkillStatus = {
  status: string;
  strikes: number;
  turns: number;
};

export type ResumeAlignment = {
  resume_skills: string[];
  verified: string[];
  skipped_due_to_struggles: string[];
  un_assessed_due_to_time: string[];
  per_skill: Record<string, PerSkillStatus>;
};

export type InterviewSessionReport = {
  session_id: string;
  candidate_name?: string | null;
  tech_stack: string;
  resume_skills: string[];
  covered_topics: string[];
  skipped_topics: string[];
  turns: InterviewTurn[];
  depth_score: number;
  provider_summary: Record<string, number>;
  finalized_at: string;
  resume_alignment: ResumeAlignment;
  rubric_scorecard?: RubricScorecardRow[];
  weighted_overall_10?: number | null;
  weighted_overall_rounded?: number | null;
  executive_summary?: string;
};

export type RubricScorecardRow = {
  id?: string;
  competency: string;
  score_10: number | null;
  weight_pct?: number;
  target_score?: number | null;
  sample_count?: number;
  meets_target?: boolean | null;
  justification: string;
};

export type InterviewRecording = {
  id: string;
  candidateToken: string;
  engine: string | null;
  stageId: string | null;
  status: 'recording' | 'completed' | 'failed';
  startedAt: string;
  endedAt: string | null;
  /** Short-lived signed URL (S3) or local Nest `/local-recordings/...` URL. */
  playbackUrl: string | null;
  phase?: 'build' | 'defend' | 'screening' | 'other';
  kind?: 'agent_audio' | 'user_audio' | 'user_video' | 'screen_share' | 'screen_share_audio' | 'other';
  label?: string;
  mediaType?: 'audio' | 'video';
};

export type InterviewReportEnrichment = {
  stage1VoiceScore: number | null;
  submittedCode: string | null;
  codeQualityScore: number | null;
  architecturalFlaws: string[] | null;
  currentPhase: string | null;
  candidateAssessmentId: string | null;
  finalDecision: string | null;
  recordingUrl: string | null;
  recordings?: InterviewRecording[];
  sandbox: SandboxReport | null;
  hrVoiceAudit?: HrVoiceAudit | null;
  screeningVoiceAudit?: {
    analyzerStatus?: string;
    conversationState?: Record<string, unknown>;
    transcript?: Array<Record<string, unknown>>;
    screeningResult?: {
      checks?: Array<{
        status: string;
        category?: string;
        requirementId?: string;
        topicId?: string;
        severity?: string;
        requirement?: string;
        question?: string;
        candidate_evidence?: string | null;
        reason?: string;
        confidence?: number;
      }>;
    } | null;
    error?: string | null;
    analyzedAt?: string | null;
  } | null;
  integrity?: {
    identity_verified_at: string | null;
    liveness_verified_at: string | null;
    proctor_summary: Record<string, unknown> | null;
    proctor_events: Array<{
      event_type: string;
      severity: string;
      payload?: Record<string, unknown>;
      created_at?: string;
    }>;
  } | null;
};

export type HrVoiceAudit = {
  weighted_competency_score?: number;
  final_outcome?: string;
  platform_decision?: string;
  decision_inputs?: Record<string, unknown>;
  competencies?: HrCompetencyEval[];
  competency_evaluations?: HrCompetencyEval[];
  eligibility?: Array<{
    requirement_id?: string;
    field?: string;
    status?: string;
    parsed_value?: unknown;
  }>;
  requirement_alignment?: HrRequirementAlignment[];
  requirement_alignments?: HrRequirementAlignment[];
  screening_answers?: Array<{
    question_id?: string;
    category?: string;
    field?: string;
    answer?: string;
    parsed_value?: unknown;
  }>;
  screening_assessment?: {
    eligibility?: Array<{
      requirement_id?: string;
      field?: string;
      status?: string;
    }>;
    informational?: Array<{
      question_id?: string;
      category?: string;
      field?: string;
      answer?: string;
      parsed_value?: unknown;
    }>;
  };
  wrap_reason?: string;
  turns?: unknown[];
};

export type HrCompetencyEval = {
  competency_id: string;
  name?: string;
  is_core?: boolean;
  score?: number | null;
  level?: string | null;
  reasoning?: string;
  supporting_quotes?: Array<{
    turn_id?: string;
    quote_original?: string;
    quote_normalized?: string;
  }>;
  gaps?: string[];
  completion_status?: string;
};

export type HrRequirementAlignment = {
  requirement_id: string;
  status: string;
  importance?: string;
  evidence?: string | null;
};

export type SandboxSubmissionSummary = {
  questionId: string;
  language: string;
  sourceCode: string;
  score: number | null;
  executionTimeMs: number | null;
  status: string | null;
  passedTestCases: number;
  totalTestCases: number;
};

export type SandboxReport = {
  assessmentTitle: string | null;
  attemptScore: number | null;
  submittedAt: string | null;
  language: string | null;
  sourceCode: string | null;
  codeQualityScore: number | null;
  architecturalFlaws: string[];
  passedTestCases: number;
  totalTestCases: number;
  submissions: SandboxSubmissionSummary[];
  hasSubmission: boolean;
};

export type InterviewAuditSummary = {
  token: string;
  filename: string;
  finalizedAt: string | null;
  depthScore: number | null;
  turnCount: number;
  techStack: string | null;
  candidateName?: string | null;
  endedByCandidate?: boolean;
};

export type InterviewReportResponse = {
  report: InterviewSessionReport;
  filename: string;
  enrichment: InterviewReportEnrichment | null;
  versions: InterviewAuditSummary[];
};

export type HiringRecommendation = 'STRONG_HIRE' | 'HIRE' | 'BORDERLINE' | 'NO_HIRE' | 'DISQUALIFIED';

export type ScorecardRow = {
  competency: string;
  score: number;
  justification: string;
};
