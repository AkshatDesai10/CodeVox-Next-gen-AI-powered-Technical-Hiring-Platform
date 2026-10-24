import type { ResumeMatchStatus } from './resume-screening.constants';

export type ResumeCvSource = 'url_extract' | 'parsed_overlay' | 'form_only';

export type DerivedMatchLabel =
  | 'STRONG_MATCH'
  | 'MATCH'
  | 'PARTIAL_MATCH'
  | 'GAP'
  | 'NO_EVIDENCE'
  | 'NOT_APPLICABLE';

export type JobExpectationFactor = {
  factorId: string;
  factor: string;
  description: string;
  importanceScore: number;
  critical: boolean;
  category?: string;
};

export type FactorMatchInput = {
  factorId: string;
  matchStrength: number;
  evidenceAvailable: boolean;
  applicable: boolean;
  confidence: number;
  evidence: string[];
  reasoning: string;
};

export type ScoreFactorInput = {
  factorId: string;
  factor: string;
  importanceScore: number;
  critical: boolean;
  matchStrength: number;
  evidenceAvailable: boolean;
  applicable: boolean;
  confidence: number;
  evidence?: string[];
  reasoning?: string;
};

export type CvCompletenessInput = {
  source: ResumeCvSource;
  charCount: number;
  truncated?: boolean;
};

export type AggregatedScoreResult = {
  score: number;
  confidence: number;
  score0: number;
  criticalGeoMean: number;
  gamma: number;
  evaluation: Array<{
    factorId: string;
    factor: string;
    importanceScore: number;
    critical: boolean;
    weight: number;
    matchStrength: number;
    evidenceAvailable: boolean;
    applicable: boolean;
    match: DerivedMatchLabel;
    confidence: number;
    evidence: string[];
    reasoning: string;
  }>;
};

export type ResumeMatchResultJson = {
  version: 1;
  status: Exclude<ResumeMatchStatus, 'PENDING'>;
  score: number | null;
  confidence: number | null;
  summary: string;
  strengths: string[];
  gaps: string[];
  criticalGaps: string[];
  evaluation: AggregatedScoreResult['evaluation'];
  job: {
    profileId: string | null;
    title: string | null;
    fingerprint: string | null;
    version: number | null;
  };
  cv: {
    source: ResumeCvSource | null;
    hash: string | null;
    charCount: number;
    truncated?: boolean;
  };
  scoring: {
    method: string;
    analyzerVersion: string;
    score0: number | null;
    criticalGeoMean: number | null;
    gamma: number;
  };
  analyzedAt: string;
  error?: string;
};

export type ResumeScreenJobPayload = {
  leadId: string;
  force?: boolean;
};

export type LeadScreenHints = {
  resumeUrl?: string | null;
  courses?: Array<{ course_id?: string; course_name?: string }>;
  experienceYears?: number | null;
  currentCompany?: string | null;
  noticePeriodDays?: number | null;
  educationalDetails?: unknown[];
  leadsAnswers?: Record<string, string> | null;
  jobProfileIdOverride?: string | null;
};

export type ResumeMatchListFields = {
  resume_match_status: string | null;
  resume_match_score: number | null;
  resume_match_confidence: number | null;
  resume_match_error: string | null;
  resume_match_analyzed_at: string | null;
};
