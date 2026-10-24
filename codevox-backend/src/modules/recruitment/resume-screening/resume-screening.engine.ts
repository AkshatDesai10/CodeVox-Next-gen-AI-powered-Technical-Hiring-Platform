import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenAiClientService } from '../../assessment-platform/assessment-ai/openai-client.service';
import { JobProfileAiLogMysql } from '../../job-profiles/entities/job-profile-ai-log.mysql.entity';
import { jdTextFingerprint } from '../../job-profiles/job-profiles-ai.util';
import { JobProfilesRepository } from '../../job-profiles/job-profiles.repository';
import type { JobProfileMysql } from '../../job-profiles/entities/job-profile.mysql.entity';
import {
  RESUME_SCREEN_ANALYZER_VERSION,
  RESUME_SCREEN_SCORING_METHOD,
  SCORE_CONSTANTS,
} from './resume-screening.constants';
import {
  aggregateResumeMatchScore,
  applyCriticalityBackstop,
  round3,
} from './resume-screening-score.util';
import type { AcquiredCvContent } from './resume-cv-content.service';
import type {
  FactorMatchInput,
  JobExpectationFactor,
  ResumeMatchResultJson,
} from './resume-screening.types';

type JobUnderstandingCache = {
  fingerprint: string;
  analyzerVersion: string;
  expectations: JobExpectationFactor[];
  cachedAt: string;
};

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

@Injectable()
export class ResumeScreeningEngine {
  private readonly log = new Logger(ResumeScreeningEngine.name);

  constructor(
    private readonly openai: OpenAiClientService,
    private readonly jobRepo: JobProfilesRepository,
    @InjectRepository(JobProfileAiLogMysql)
    private readonly aiLogs: Repository<JobProfileAiLogMysql>,
  ) {}

  private async chatLogged<T>(
    operation: string,
    messages: ChatMessage[],
    meta?: Record<string, unknown>,
  ): Promise<T> {
    const detailed = await this.openai.chatJsonDetailed<T>(messages);
    try {
      await this.aiLogs.save(
        this.aiLogs.create({
          candidateAssessmentId: null,
          assessmentId: null,
          operation,
          model: detailed.model,
          promptHash: this.openai.promptHash(messages),
          requestJson: { messages, ...(meta ?? {}) },
          responseJson: detailed.data as Record<string, unknown>,
          promptTokens: detailed.usage.promptTokens,
          completionTokens: detailed.usage.completionTokens,
          inactive: 0,
        }),
      );
    } catch (err) {
      this.log.warn(`Failed to persist ${operation} log: ${String(err)}`);
    }
    return detailed.data;
  }

  buildJdBlob(profile: JobProfileMysql): string {
    return [
      `Title: ${profile.title}`,
      `Department: ${profile.department ?? ''}`,
      `Seniority: ${profile.seniorityLevel ?? ''}`,
      `Employment: ${profile.employmentType ?? ''}`,
      `Location: ${profile.locationMode ?? ''} ${profile.locationText ?? ''}`,
      `Language: ${profile.languageRequired ?? ''}`,
      `Experience: ${profile.experienceMin ?? ''} - ${profile.experienceMax ?? ''}`,
      `Intro: ${profile.candidateFacingIntro ?? ''}`,
      `Responsibilities:\n${(profile.responsibilities ?? []).join('\n')}`,
      `Required skills:\n${(profile.requiredSkills ?? []).join('\n')}`,
      `Nice to have:\n${(profile.niceToHaveSkills ?? []).join('\n')}`,
    ].join('\n');
  }

  jobFingerprint(profile: JobProfileMysql): string {
    return jdTextFingerprint({
      title: profile.title,
      responsibilities: profile.responsibilities ?? [],
      required_skills: profile.requiredSkills ?? [],
      nice_to_have_skills: profile.niceToHaveSkills ?? [],
      seniority_level: profile.seniorityLevel,
      location_text: profile.locationText,
      language_required: profile.languageRequired,
      experience_min: profile.experienceMin,
      experience_max: profile.experienceMax,
    });
  }

  async analyze(input: {
    profile: JobProfileMysql;
    cv: AcquiredCvContent;
    forceRefreshJobModel?: boolean;
    /** Skip candidate-understanding LLM when caller already extracted a structured CV (e.g. demo portal). */
    precomputedCandidateModel?: Record<string, unknown> | null;
  }): Promise<ResumeMatchResultJson> {
    const fingerprint = this.jobFingerprint(input.profile);
    const jdBlob = this.buildJdBlob(input.profile);

    if (!this.openai.isConfigured()) {
      return this.unavailableResult({
        error: 'LLM_FAILED',
        profile: input.profile,
        fingerprint,
        cv: input.cv,
        summary: 'LLM provider is not configured.',
      });
    }

    let expectations = await this.getJobUnderstanding(
      input.profile,
      fingerprint,
      jdBlob,
      input.forceRefreshJobModel === true,
    );
    expectations = applyCriticalityBackstop(expectations, jdBlob);

    if (!expectations.length) {
      return this.unavailableResult({
        error: 'LLM_FAILED',
        profile: input.profile,
        fingerprint,
        cv: input.cv,
        summary: 'Job understanding produced no factors.',
      });
    }

    const precomputed =
      input.precomputedCandidateModel &&
      typeof input.precomputedCandidateModel === 'object' &&
      !Array.isArray(input.precomputedCandidateModel)
        ? input.precomputedCandidateModel
        : null;
    const candidateModel =
      precomputed ?? (await this.callCandidateUnderstanding(input.cv));
    if (precomputed) {
      this.log.log('Resume screen reusing precomputed candidate model (skipped candidate-understanding LLM)');
    }
    if (!candidateModel) {
      return this.failedResult({
        error: 'LLM_FAILED',
        profile: input.profile,
        fingerprint,
        cv: input.cv,
        summary: 'Candidate understanding failed.',
      });
    }

    const matches = await this.callFactorMatching(
      expectations,
      candidateModel,
      input.cv,
      jdBlob,
    );
    if (!matches) {
      return this.failedResult({
        error: 'LLM_FAILED',
        profile: input.profile,
        fingerprint,
        cv: input.cv,
        summary: 'Factor matching failed.',
      });
    }

    const byId = new Map(matches.map((m) => [m.factorId, m]));
    const scoreInputs = expectations.map((exp) => {
      const m = byId.get(exp.factorId);
      return {
        factorId: exp.factorId,
        factor: exp.factor,
        importanceScore: exp.importanceScore,
        critical: exp.critical,
        matchStrength: m?.matchStrength ?? 0,
        evidenceAvailable: m?.evidenceAvailable ?? false,
        applicable: m?.applicable ?? true,
        confidence: m?.confidence ?? 0.4,
        evidence: m?.evidence ?? [],
        reasoning: m?.reasoning ?? '',
      };
    });

    const agg = aggregateResumeMatchScore(scoreInputs, {
      source: input.cv.source,
      charCount: input.cv.charCount,
      truncated: input.cv.truncated,
    });

    const criticalGaps = agg.evaluation
      .filter(
        (e) =>
          e.critical &&
          e.applicable &&
          (e.match === 'GAP' || e.match === 'NO_EVIDENCE'),
      )
      .map((e) => e.factor);

    const strengths = agg.evaluation
      .filter((e) => e.match === 'STRONG_MATCH' || e.match === 'MATCH')
      .slice(0, 6)
      .map((e) => e.factor);

    const gaps = agg.evaluation
      .filter((e) => e.match === 'GAP' || e.match === 'PARTIAL_MATCH')
      .slice(0, 8)
      .map((e) => e.factor);

    const summary = [
      `Overall CV↔JD fit score ${agg.score}/100`,
      criticalGaps.length
        ? `Critical gaps: ${criticalGaps.join(', ')}`
        : 'No critical gaps flagged',
      `Confidence ${agg.confidence}`,
    ].join('. ');

    return {
      version: 1,
      status: 'COMPLETED',
      score: agg.score,
      confidence: agg.confidence,
      summary,
      strengths,
      gaps,
      criticalGaps,
      evaluation: agg.evaluation,
      job: {
        profileId: input.profile.id,
        title: input.profile.title,
        fingerprint,
        version: input.profile.version ?? 1,
      },
      cv: {
        source: input.cv.source,
        hash: input.cv.hash,
        charCount: input.cv.charCount,
        truncated: input.cv.truncated,
      },
      scoring: {
        method: RESUME_SCREEN_SCORING_METHOD,
        analyzerVersion: RESUME_SCREEN_ANALYZER_VERSION,
        score0: agg.score0,
        criticalGeoMean: agg.criticalGeoMean,
        gamma: agg.gamma,
      },
      analyzedAt: new Date().toISOString(),
    };
  }

  private async getJobUnderstanding(
    profile: JobProfileMysql,
    fingerprint: string,
    jdBlob: string,
    force: boolean,
  ): Promise<JobExpectationFactor[]> {
    const meta = (profile.aiMetadata ?? {}) as Record<string, unknown>;
    const cached = meta.resume_screening_job_model as JobUnderstandingCache | undefined;
    if (
      !force &&
      cached &&
      cached.fingerprint === fingerprint &&
      cached.analyzerVersion === RESUME_SCREEN_ANALYZER_VERSION &&
      Array.isArray(cached.expectations) &&
      cached.expectations.length
    ) {
      this.log.log(
        `Resume screen reusing cached job understanding factors=${cached.expectations.length} (skipped job-understanding LLM)`,
      );
      return cached.expectations.map((e) => this.sanitizeExpectation(e)).filter(Boolean) as JobExpectationFactor[];
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: [
          'You analyze job descriptions into dynamic hiring factors. Output ONLY valid JSON.',
          'Schema: { "expectations": [{ "factorId": string, "factor": string, "description": string, "importanceScore": number, "critical": boolean, "category": string }] }.',
          'importanceScore is continuous in (0,1] relative to THIS job only (not a fixed rubric). Do NOT invent a final 0-100 score. Evidence-only; no invented requirements.',
          '',
          'CRITICAL LABELING (strict — fairness for CV screening):',
          'critical=true means failure on this factor should crush overall fit via a critical gate. That is ONLY fair when a CV can plausibly contain an affirmative, checkable prior claim.',
          'critical=true is NOT the same as "important for doing the job". Day-to-day importance belongs in importanceScore (including HIGH non-critical).',
          '',
          'Mark critical=true ONLY for hard, verifiable requirements such as:',
          '- a specific technical skill, stack, or named tool/technology/framework;',
          '- a credential, certification, license, or degree;',
          '- a named domain of prior hands-on experience a candidate could list;',
          '- an explicit JD "required" / "must have" / "mandatory" statement that maps to such a checkable claim.',
          '',
          'Default critical=false (you MAY still assign HIGH importanceScore) for:',
          '- generic soft skills (collaboration, communication, teamwork);',
          '- ongoing job behaviors or process descriptions from responsibility bullets',
          '  (e.g. monitor performance in production, troubleshoot issues, document best practices,',
          '  collaborate with product/hardware/QA to define requirements);',
          '- duties that describe how the role works day-to-day rather than prior experience a CV can fairly evidence.',
          'CVs rarely state those items explicitly; marking them critical causes systematic NO_EVIDENCE penalties unrelated to actual technical fit.',
          '',
          'Examples:',
          '- critical=true: "Experience with CCTV/Surveillance systems" (verifiable domain experience)',
          '- critical=true: "Model optimization for edge devices (TensorRT, ONNX)" (verifiable named tools)',
          '- critical=false: "Collaborate with product, hardware and QA teams to define requirements" (process behavior, not a checkable prior credential; may still be HIGH importance)',
          '- critical=false: "Monitor performance in production, troubleshoot issues" (ongoing job behavior, not a checkable prior credential; may still be HIGH importance)',
        ].join('\n'),
      },
      {
        role: 'user',
        content: `Produce 4-14 job-specific expectations for this JD. Apply the critical-labeling rules strictly.\n\n${jdBlob.slice(0, 10000)}`,
      },
    ];
    const raw = await this.chatLogged<{
      expectations?: unknown;
      __isFallback?: boolean;
    }>('RESUME_SCREEN_JOB_UNDERSTANDING', messages, { jobProfileId: profile.id });

    if ((raw as { __isFallback?: boolean })?.__isFallback) {
      this.log.warn('Job understanding returned fallback JSON');
      return [];
    }

    const list = Array.isArray(raw.expectations) ? raw.expectations : [];
    const expectations = list
      .map((e, i) => this.sanitizeExpectation(e, i))
      .filter((e): e is JobExpectationFactor => Boolean(e));

    if (expectations.length) {
      const nextMeta = {
        ...meta,
        resume_screening_job_model: {
          fingerprint,
          analyzerVersion: RESUME_SCREEN_ANALYZER_VERSION,
          expectations,
          cachedAt: new Date().toISOString(),
        } satisfies JobUnderstandingCache,
      };
      try {
        await this.jobRepo.patchProfile(profile.id, { aiMetadata: nextMeta });
      } catch (err) {
        this.log.warn(`Failed to cache job understanding: ${String(err)}`);
      }
    }

    return expectations;
  }

  private sanitizeExpectation(raw: unknown, index = 0): JobExpectationFactor | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const factor = String(o.factor ?? o.name ?? '').trim();
    if (!factor) return null;
    const factorId = String(o.factorId ?? o.id ?? `f${index + 1}`).trim() || `f${index + 1}`;
    const importanceScore = round3(
      Math.min(1, Math.max(SCORE_CONSTANTS.IMPORTANCE_EPS, Number(o.importanceScore) || 0.1)),
    );
    return {
      factorId,
      factor,
      description: String(o.description ?? '').slice(0, 500),
      importanceScore,
      critical: Boolean(o.critical),
      category: typeof o.category === 'string' ? o.category.slice(0, 64) : undefined,
    };
  }

  private async callCandidateUnderstanding(cv: AcquiredCvContent): Promise<Record<string, unknown> | null> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Extract a structured candidate profile from the CV. Output ONLY JSON. ' +
          'Schema: { "summary": string, "roles": string[], "relevantYearsByDomain": object, ' +
          '"skills": string[], "tools": string[], "education": string[], "projects": string[], ' +
          '"leadership": string[], "evidenceDensity": number, "contradictions": string[] }. ' +
          'Do NOT invent experience. If unsure, omit or use empty arrays.',
      },
      {
        role: 'user',
        content: `CV text (${cv.source}, ${cv.charCount} chars):\n\n${cv.textForLlm}`,
      },
    ];
    const raw = await this.chatLogged<Record<string, unknown>>(
      'RESUME_SCREEN_CANDIDATE_UNDERSTANDING',
      messages,
    );
    if (raw?.__isFallback) return null;
    return raw;
  }

  private async callFactorMatching(
    expectations: JobExpectationFactor[],
    candidateModel: Record<string, unknown>,
    cv: AcquiredCvContent,
    jdBlob: string,
  ): Promise<FactorMatchInput[] | null> {
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Compare candidate evidence to each job factor. Output ONLY JSON. ' +
          'Schema: { "matches": [{ "factorId": string, "matchStrength": number, "evidenceAvailable": boolean, ' +
          '"applicable": boolean, "confidence": number, "evidence": string[], "reasoning": string }] }. ' +
          'matchStrength in [0,1] continuous. evidenceAvailable=false means insufficient CV evidence (NOT a proven gap). ' +
          'If an explicit contrary credential is present for a required hard item, set evidenceAvailable=true and low matchStrength. ' +
          'Semantic equivalence OK (e.g. Next.js↔React). Docker≠Kubernetes. Total years ≠ relevant years. ' +
          'Do NOT output a final 0-100 score.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          factors: expectations,
          candidate: candidateModel,
          jdExcerpt: jdBlob.slice(0, 4000),
          cvExcerpt: cv.textForLlm.slice(0, 6000),
        }),
      },
    ];
    const raw = await this.chatLogged<{
      matches?: unknown;
      __isFallback?: boolean;
    }>('RESUME_SCREEN_FACTOR_MATCHING', messages);

    if (raw?.__isFallback) return null;
    const list = Array.isArray(raw.matches) ? raw.matches : [];
    const allowed = new Set(expectations.map((e) => e.factorId));
    const out: FactorMatchInput[] = [];
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const factorId = String(o.factorId ?? '').trim();
      if (!factorId || !allowed.has(factorId)) continue;
      out.push({
        factorId,
        matchStrength: round3(Math.min(1, Math.max(0, Number(o.matchStrength) || 0))),
        evidenceAvailable: Boolean(o.evidenceAvailable),
        applicable: o.applicable === false ? false : true,
        confidence: round3(Math.min(1, Math.max(0, Number(o.confidence) || 0.5))),
        evidence: Array.isArray(o.evidence)
          ? o.evidence.filter((x) => typeof x === 'string').map((x) => String(x).slice(0, 300)).slice(0, 6)
          : [],
        reasoning: String(o.reasoning ?? '').slice(0, 600),
      });
    }
    return out.length ? out : null;
  }

  private unavailableResult(input: {
    error: string;
    profile: JobProfileMysql;
    fingerprint: string;
    cv: AcquiredCvContent;
    summary: string;
  }): ResumeMatchResultJson {
    return {
      version: 1,
      status: 'UNAVAILABLE',
      score: null,
      confidence: null,
      summary: input.summary,
      strengths: [],
      gaps: [],
      criticalGaps: [],
      evaluation: [],
      job: {
        profileId: input.profile.id,
        title: input.profile.title,
        fingerprint: input.fingerprint,
        version: input.profile.version ?? 1,
      },
      cv: {
        source: input.cv.source,
        hash: input.cv.hash,
        charCount: input.cv.charCount,
        truncated: input.cv.truncated,
      },
      scoring: {
        method: RESUME_SCREEN_SCORING_METHOD,
        analyzerVersion: RESUME_SCREEN_ANALYZER_VERSION,
        score0: null,
        criticalGeoMean: null,
        gamma: SCORE_CONSTANTS.GAMMA,
      },
      analyzedAt: new Date().toISOString(),
      error: input.error,
    };
  }

  private failedResult(input: {
    error: string;
    profile: JobProfileMysql;
    fingerprint: string;
    cv: AcquiredCvContent;
    summary: string;
  }): ResumeMatchResultJson {
    return {
      ...this.unavailableResult(input),
      status: 'FAILED',
    };
  }
}
