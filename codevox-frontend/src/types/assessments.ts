export type ApiEnvelope<T> = {
  success: boolean;
  message: string;
  data: T;
};

export type CandidateDto = {
  id: string;
  firstName: string;
  lastName: string | null;
  email: string;
  phone: string | null;
  experienceYears: string | null;
  currentCompany: string | null;
  status: string;
};

export type AssessmentDto = {
  id: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  totalMarks: number;
  status: string;
};

export type TestCaseDto = {
  id: string;
  input: string;
  expectedOutput: string;
};

export type McqOptionDto = {
  label: string;
  text: string;
};

export type AssessmentQuestionDto = {
  id: string;
  title: string;
  description: string | null;
  questionType: string;
  difficulty: string;
  marks: number;
  language: string | null;
  sortOrder: number;
  estimatedDuration?: number | null;
  questionJson?: Record<string, unknown>;
  testCases: TestCaseDto[];
  mcqOptions?: McqOptionDto[];
};

export type CandidateAssignmentDto = {
  candidateAssessmentId: string | null;
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
  score: string | null;
  assessmentId: string;
  title: string;
  description: string | null;
  durationMinutes: number;
  totalMarks: number;
};

export type StartAssessmentResponse = {
  candidateAssessmentId: string;
  status: string;
  startedAt: string | null;
  assessment: {
    id: string;
    title: string;
    description: string | null;
    durationMinutes: number;
    totalMarks: number;
  };
  questions: AssessmentQuestionDto[];
};

export type AttemptResponse = StartAssessmentResponse & {
  candidateId: string;
  submittedAt: string | null;
  score: string | null;
  submissions: Array<{
    questionId: string;
    language: string;
    sourceCode: string;
    status: string;
    score: string | null;
    executionTime: number | null;
  }>;
};

export type RunCodeResponse = {
  stdout: string;
  stderr: string;
  executionTime: number;
  timedOut: boolean;
  success?: boolean;
};

export type SubmitAnswerCaseResult = {
  index: number;
  passed: boolean;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  hidden: boolean;
  input?: string;
  expectedOutput?: string;
};

export type SubmitAnswerResponse = {
  questionId: string;
  title: string;
  status: string;
  score: number;
  passedTests: number;
  totalTests: number;
  passedTestCases: number;
  totalTestCases: number;
  percentage: number;
  executionTime: number;
  cases?: SubmitAnswerCaseResult[];
  evaluationReview?: {
    strengths?: string[];
    weaknesses?: string[];
    recommendations?: string[];
  };
};

export type EnvironmentTemplateDto = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  runtime: string;
  services: string[] | null;
  configJson: Record<string, unknown>;
};

export type PlatformQuestionDto = {
  id: string;
  title: string;
  description: string | null;
  questionType: string;
  difficulty: string;
  marks: number;
  language: string | null;
  source?: string;
  environmentConfig?: Record<string, unknown> | null;
  evaluationConfig?: Record<string, unknown> | null;
};

export type GeneratedQuestionDto = {
  title: string;
  problemStatement: string;
  requirements?: string[];
  expectedSkills?: string[];
  evaluationCriteria?: string[];
  environmentTemplate?: Record<string, unknown>;
  questionType?: string;
  language?: string;
  difficulty?: string;
  marks?: number;
  testCases?: Array<{ input: string; expectedOutput: string | unknown; isHidden?: boolean }>;
  options?: Array<{ label: string; text: string; isCorrect?: boolean; is_correct?: boolean }>;
};

export type SubmitAssessmentResponse = {
  candidateAssessmentId: string;
  status: string;
  totalScore: number;
  totalMarks: number;
  percentage?: number;
  passed: boolean;
  breakdown: Array<{
    questionId: string;
    title: string;
    status: string;
    score: number;
    passedTestCases: number;
    totalTestCases: number;
    executionTime: number;
  }>;
};

export type AssessmentResultResponse = {
  candidateAssessmentId: string;
  status: string;
  submittedAt: string | null;
  totalScore: number;
  totalMarks: number;
  percentage?: number;
  passed: boolean;
  breakdown: Array<{
    questionId: string;
    title: string;
    marks: number;
    status: string;
    score: number;
    executionTime: number;
    passedTestCases?: number;
    totalTestCases?: number;
  }>;
};

export type AssessmentAttemptListItem = {
  id: string;
  status: string;
  startedAt: string | null;
  submittedAt: string | null;
  score: string | null;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  assessmentId: string;
  assessmentTitle: string;
};

export type AssessmentIntegritySummary = {
  activeTests: number;
  flaggedCandidates: number;
  averageTrustScore: number;
};

export type AssessmentDashboardSummary = {
  candidateCount: number;
  assessmentCount: number;
  activeAttempts: number;
  completedAttempts: number;
  integrity?: AssessmentIntegritySummary;
  recentActivity?: Array<{
    applicationId?: string;
    name: string;
    role: string;
    score: string;
    recommendation?: string;
    reportStatus?: string;
  }>;
  topPerformers?: Array<{
    applicationId?: string;
    name: string;
    role: string;
    score: string;
    recommendation?: string;
  }>;
  chartData?: Array<{ day: string; date?: string; count: number }>;
  reportsInsights?: {
    avgCohortScorePct: number | null;
    strongHireCount: number;
    pendingReviewCount: number;
    completedCount: number;
  };
};
