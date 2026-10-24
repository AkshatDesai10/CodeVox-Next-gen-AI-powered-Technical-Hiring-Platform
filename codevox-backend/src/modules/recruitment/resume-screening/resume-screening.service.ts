import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { IsNull } from 'typeorm';
import { isRedisEnabled } from '../../../config/redis-enabled';
import {
  RESUME_SCREENING_JOB_RUN,
  RESUME_SCREENING_QUEUE,
} from '../../../queue/queue.constants';
import { JobProfilesRepository } from '../../job-profiles/job-profiles.repository';
import { RecruitmentRepository } from '../recruitment.repository';
import type { RecruitmentLeadOverlayMysql } from '../entities/recruitment-lead-overlay.mysql.entity';
import { ResumeCvContentService } from './resume-cv-content.service';
import { ResumeScreeningEngine } from './resume-screening.engine';
import { ResumeScreeningJobResolver } from './resume-screening-job.resolver';
import {
  RESUME_MATCH_ERROR,
  RESUME_MATCH_STATUS,
  RESUME_SCREEN_ANALYZER_VERSION,
  SCORE_CONSTANTS,
} from './resume-screening.constants';
import type {
  LeadScreenHints,
  ResumeMatchListFields,
  ResumeMatchResultJson,
  ResumeScreenJobPayload,
} from './resume-screening.types';

@Injectable()
export class ResumeScreeningService {
  private readonly log = new Logger(ResumeScreeningService.name);
  private readonly redisEnabled = isRedisEnabled();

  constructor(
    private readonly repo: RecruitmentRepository,
    private readonly cvContent: ResumeCvContentService,
    private readonly jobResolver: ResumeScreeningJobResolver,
    private readonly engine: ResumeScreeningEngine,
    private readonly jobRepo: JobProfilesRepository,
    @Optional() @InjectQueue(RESUME_SCREENING_QUEUE) private readonly queue?: Queue,
  ) {}

  mapListFields(overlay?: RecruitmentLeadOverlayMysql | null): ResumeMatchListFields {
    return {
      resume_match_status: overlay?.resumeMatchStatus ?? null,
      resume_match_score:
        overlay?.resumeMatchScore != null ? Number(overlay.resumeMatchScore) : null,
      resume_match_confidence:
        overlay?.resumeMatchConfidence != null
          ? Number(overlay.resumeMatchConfidence)
          : null,
      resume_match_error: overlay?.resumeMatchError ?? null,
      resume_match_analyzed_at: overlay?.resumeMatchAnalyzedAt
        ? overlay.resumeMatchAnalyzedAt.toISOString()
        : null,
    };
  }

  /**
   * Page-load first-sight claim.
   * Awaits overlay upsert (ms) so list/detail can return PENDING immediately.
   * Enqueue/LLM is non-blocking. Never re-enqueues existing overlays (Option A).
   */
  async ensureSeenAndEnqueue(
    leadId: string,
    hints?: LeadScreenHints,
  ): Promise<RecruitmentLeadOverlayMysql | null> {
    const existing = await this.repo.findLeadOverlay(leadId);
    if (existing) return existing;

    const hasResume = Boolean(hints?.resumeUrl?.trim());
    const initialStatus = hasResume
      ? RESUME_MATCH_STATUS.PENDING
      : RESUME_MATCH_STATUS.UNAVAILABLE;

    let claimed: RecruitmentLeadOverlayMysql;
    try {
      claimed = await this.repo.upsertLeadOverlay(leadId, {
        resumeMatchStatus: initialStatus,
        resumeMatchError: hasResume ? null : RESUME_MATCH_ERROR.NO_RESUME,
        resumeMatchAnalyzerVersion: RESUME_SCREEN_ANALYZER_VERSION,
      });
    } catch (err) {
      // Unique race: another instance claimed first sight
      const msg = String(err);
      if (/ER_DUP_ENTRY|unique|Duplicate/i.test(msg)) {
        return this.repo.findLeadOverlay(leadId);
      }
      throw err;
    }

    if (claimed.resumeMatchStatus === RESUME_MATCH_STATUS.PENDING) {
      this.log.log(
        `[RESUME_SCREEN] first-sight PENDING lead=${leadId} resumeUrl=${Boolean(hints?.resumeUrl)} — enqueue`,
      );
      this.enqueue({ leadId, force: false });
    } else {
      this.log.log(
        `[RESUME_SCREEN] first-sight ${claimed.resumeMatchStatus} lead=${leadId} error=${claimed.resumeMatchError ?? 'n/a'}`,
      );
    }
    return claimed;
  }

  /** Manual leads exist only locally; candidate + resume details live in parsedResumeJson. */
  private manualLeadHints(overlay?: RecruitmentLeadOverlayMysql | null): LeadScreenHints | null {
    const raw = overlay?.parsedResumeJson;
    if (!raw || raw.source !== 'manual') return null;
    const jobTitle = String(raw.job_title ?? '').trim();
    return {
      resumeUrl: String(raw.resume_url ?? '').trim() || null,
      courses: jobTitle ? [{ course_name: jobTitle }] : [],
      jobProfileIdOverride: String(raw.job_profile_id ?? '').trim() || null,
    };
  }

  /**
   * First-sight claim for manual leads. Their overlay row already exists (created at
   * invite time), so claim via a conditional update on an empty status instead.
   */
  async ensureManualLeadScreened(
    overlay: RecruitmentLeadOverlayMysql,
  ): Promise<RecruitmentLeadOverlayMysql> {
    if (overlay.resumeMatchStatus) return overlay;
    const hints = this.manualLeadHints(overlay);
    if (!hints) return overlay;

    const hasResume = Boolean(hints.resumeUrl);
    const status = hasResume ? RESUME_MATCH_STATUS.PENDING : RESUME_MATCH_STATUS.UNAVAILABLE;
    const res = await this.repo.leadOverlays.update(
      { id: overlay.id, resumeMatchStatus: IsNull() },
      {
        resumeMatchStatus: status,
        resumeMatchError: hasResume ? null : RESUME_MATCH_ERROR.NO_RESUME,
        resumeMatchAnalyzerVersion: RESUME_SCREEN_ANALYZER_VERSION,
      },
    );
    if (res.affected) {
      this.log.log(
        `[RESUME_SCREEN] first-sight ${status} manual lead=${overlay.leadId}${hasResume ? ' — enqueue' : ''}`,
      );
      if (hasResume) this.enqueue({ leadId: overlay.leadId, force: false });
    }
    return (await this.repo.findLeadOverlay(overlay.leadId)) ?? overlay;
  }

  /** Manual re-run — sole path to refresh after JD/CV/analyzer change. */
  async requestManualRerun(leadId: string): Promise<ResumeMatchListFields & { resume_match?: ResumeMatchResultJson | null }> {
    const existing = await this.repo.findLeadOverlay(leadId);
    if (!existing) throw new NotFoundException('Lead not found');
    if (leadId.startsWith('manual_') && !this.manualLeadHints(existing)) {
      throw new NotFoundException('Manual lead not found');
    }

    await this.repo.mergeLeadOverlay(leadId, {
      resumeMatchStatus: RESUME_MATCH_STATUS.PENDING,
      resumeMatchError: null,
      resumeMatchAnalyzerVersion: RESUME_SCREEN_ANALYZER_VERSION,
    });

    this.enqueue({ leadId, force: true });

    const overlay = await this.repo.findLeadOverlay(leadId);
    return {
      ...this.mapListFields(overlay),
      resume_match: (overlay?.resumeMatchJson as ResumeMatchResultJson | null) ?? null,
    };
  }

  async getResumeScreen(leadId: string) {
    const overlay = await this.repo.findLeadOverlay(leadId);
    return {
      ...this.mapListFields(overlay),
      resume_match: (overlay?.resumeMatchJson as ResumeMatchResultJson | null) ?? null,
      resume_match_job_profile_id: overlay?.resumeMatchJobProfileId ?? null,
      resume_match_job_fingerprint: overlay?.resumeMatchJobFingerprint ?? null,
      resume_match_cv_hash: overlay?.resumeMatchCvHash ?? null,
      resume_match_analyzer_version: overlay?.resumeMatchAnalyzerVersion ?? null,
    };
  }

  enqueue(payload: ResumeScreenJobPayload): void {
    if (this.redisEnabled && this.queue) {
      void this.queue
        .add(RESUME_SCREENING_JOB_RUN, payload, {
          jobId: payload.force
            ? `resume-screen:${payload.leadId}:force:${Date.now()}`
            : `resume-screen:${payload.leadId}`,
          removeOnComplete: 500,
          removeOnFail: 2000,
        })
        .catch((err) => {
          this.log.warn(`Failed to enqueue resume screen: ${String(err)}`);
          this.runInline(payload);
        });
      return;
    }
    this.runInline(payload);
  }

  async processJob(payload: ResumeScreenJobPayload): Promise<void> {
    const leadId = payload.leadId;
    const overlay = await this.repo.findLeadOverlay(leadId);
    const manualHints = this.manualLeadHints(overlay);
    const overlayHints: LeadScreenHints | null = overlay?.parsedResumeJson
      ? {
          resumeUrl: String(overlay.parsedResumeJson.resume_url ?? '').trim() || null,
          courses: String(overlay.parsedResumeJson.job_title ?? '').trim()
            ? [{ course_name: String(overlay.parsedResumeJson.job_title) }]
            : [],
          experienceYears:
            overlay.parsedResumeJson.experience_years != null
              ? Number(overlay.parsedResumeJson.experience_years)
              : null,
          currentCompany: String(overlay.parsedResumeJson.current_company ?? '').trim() || null,
          noticePeriodDays:
            overlay.parsedResumeJson.notice_period_days != null
              ? Number(overlay.parsedResumeJson.notice_period_days)
              : null,
          educationalDetails: Array.isArray(overlay.parsedResumeJson.education)
            ? overlay.parsedResumeJson.education
            : [],
          leadsAnswers:
            overlay.parsedResumeJson.inferred_from_answers &&
            typeof overlay.parsedResumeJson.inferred_from_answers === 'object'
              ? (overlay.parsedResumeJson.inferred_from_answers as Record<string, string>)
              : null,
          jobProfileIdOverride: String(overlay.parsedResumeJson.job_profile_id ?? '').trim() || null,
        }
      : null;
    const hints = manualHints ?? overlayHints;
    if (!hints) {
      await this.repo.mergeLeadOverlay(leadId, {
        resumeMatchStatus: RESUME_MATCH_STATUS.FAILED,
        resumeMatchError: 'LEAD_NOT_FOUND',
        resumeMatchAnalyzedAt: new Date(),
      });
      return;
    }

    const jobResult = await this.jobResolver.resolve({
      courses: hints.courses,
      jobProfileIdOverride: hints.jobProfileIdOverride ?? null,
    });
    if (!jobResult.ok) {
      await this.persistTerminal({
        leadId,
        status: RESUME_MATCH_STATUS.UNAVAILABLE,
        error: jobResult.reason,
        summary: jobResult.reason,
        cvHash: null,
        jobProfileId: null,
        jobFingerprint: null,
        extractedText: overlay?.resumeExtractedText ?? null,
        result: null,
      });
      return;
    }

    const cv = await this.cvContent.acquire(
      hints,
      overlay?.parsedResumeJson ?? null,
      payload.force ? null : overlay?.resumeExtractedText ?? null,
    );

    if (!cv) {
      await this.persistTerminal({
        leadId,
        status: RESUME_MATCH_STATUS.UNAVAILABLE,
        error: RESUME_MATCH_ERROR.NO_RESUME,
        summary: 'No usable resume content',
        cvHash: null,
        jobProfileId: jobResult.profile.id,
        jobFingerprint: this.engine.jobFingerprint(jobResult.profile),
        extractedText: null,
        result: null,
      });
      return;
    }

    if (cv.source !== 'url_extract' && cv.charCount < 80) {
      await this.persistTerminal({
        leadId,
        status: RESUME_MATCH_STATUS.UNAVAILABLE,
        error: RESUME_MATCH_ERROR.THIN_CV,
        summary: 'CV content too thin to score',
        cvHash: cv.hash,
        jobProfileId: jobResult.profile.id,
        jobFingerprint: this.engine.jobFingerprint(jobResult.profile),
        extractedText: cv.text.slice(0, 500_000),
        result: null,
      });
      return;
    }

    // Manual re-run with identical fingerprints + analyzer can skip LLM
    if (
      !payload.force &&
      overlay?.resumeMatchStatus === RESUME_MATCH_STATUS.COMPLETED &&
      overlay.resumeMatchCvHash === cv.hash &&
      overlay.resumeMatchJobFingerprint === this.engine.jobFingerprint(jobResult.profile) &&
      overlay.resumeMatchAnalyzerVersion === RESUME_SCREEN_ANALYZER_VERSION &&
      overlay.resumeMatchJson
    ) {
      return;
    }

    let result: ResumeMatchResultJson;
    try {
      result = await this.engine.analyze({
        profile: jobResult.profile,
        cv,
        forceRefreshJobModel: payload.force === true,
      });
    } catch (err) {
      this.log.error(`Resume screen engine error lead=${leadId}: ${String(err)}`);
      await this.persistTerminal({
        leadId,
        status: RESUME_MATCH_STATUS.FAILED,
        error: RESUME_MATCH_ERROR.LLM_FAILED,
        summary: String(err).slice(0, 400),
        cvHash: cv.hash,
        jobProfileId: jobResult.profile.id,
        jobFingerprint: this.engine.jobFingerprint(jobResult.profile),
        extractedText: cv.text.slice(0, 500_000),
        result: null,
      });
      return;
    }

    await this.persistTerminal({
      leadId,
      status: result.status,
      error: result.error ?? null,
      summary: result.summary,
      cvHash: cv.hash,
      jobProfileId: jobResult.profile.id,
      jobFingerprint: result.job.fingerprint,
      extractedText: cv.text.slice(0, 500_000),
      result,
      score: result.score,
      confidence: result.confidence,
    });
    this.printResumeScreenResult(`lead:${leadId}`, result);
  }

  /**
   * Demo / local test helper: run the same ResumeScreeningEngine against an
   * uploaded CV text + explicit JobProfile. Does not write lead overlay.
   * Fire-and-forget safe — call without awaiting from HTTP if desired.
   * @deprecated Prefer {@link analyzeAndPersistForApplication} so portal can show the score.
   */
  async debugAnalyzeUploadedCv(input: {
    jobProfileId: string;
    rawCvText: string;
    candidateLabel?: string;
  }): Promise<ResumeMatchResultJson | null> {
    const label = input.candidateLabel ?? `demo:${input.jobProfileId}`;
    this.log.log(`[RESUME_SCREEN_DEMO] start label=${label} jobProfileId=${input.jobProfileId} cvChars=${input.rawCvText?.length ?? 0}`);

    const profile = await this.jobRepo.findById(input.jobProfileId);
    if (!profile) {
      this.log.warn(`[RESUME_SCREEN_DEMO] job profile not found id=${input.jobProfileId}`);
      return null;
    }

    const cv = this.cvContent.fromExtractedText(input.rawCvText, 'url_extract');
    if (!cv) {
      this.log.warn(`[RESUME_SCREEN_DEMO] CV text too thin label=${label}`);
      return null;
    }

    const result = await this.engine.analyze({
      profile,
      cv,
      forceRefreshJobModel: true,
    });
    this.printResumeScreenResult(label, result);
    return result;
  }

  /** Stable overlay key for job applications (demo portal) — reuses lead overlay storage. */
  static applicationOverlayLeadId(applicationId: string): string {
    return `app:${applicationId}`;
  }

  async getApplicationResumeMatch(applicationId: string, sourceLeadId?: string | null): Promise<
    ResumeMatchListFields & {
      resume_match?: ResumeMatchResultJson | null;
      summary?: string | null;
      strengths?: string[];
      gaps?: string[];
    }
  > {
    let overlay = await this.repo.findLeadOverlay(
      ResumeScreeningService.applicationOverlayLeadId(applicationId),
    );
    if (!overlay?.resumeMatchStatus && sourceLeadId) {
      overlay = (await this.repo.findLeadOverlay(sourceLeadId)) ?? overlay;
    }
    const fields = this.mapListFields(overlay);
    const json = (overlay?.resumeMatchJson as ResumeMatchResultJson | null) ?? null;
    return {
      ...fields,
      resume_match: json,
      summary: json?.summary ?? null,
      strengths: json?.strengths ?? [],
      gaps: json?.gaps ?? [],
    };
  }

  /**
   * Run the same resume-screening engine used by Lead Inbox and persist onto
   * recruitment_lead_overlay under `app:{applicationId}` so the candidate
   * portal dashboard can show score / 100.
   */
  async analyzeAndPersistForApplication(input: {
    applicationId: string;
    jobProfileId: string;
    rawCvText: string;
    candidateLabel?: string;
    /** When set, skips the candidate-understanding LLM call. */
    precomputedCandidateModel?: Record<string, unknown> | null;
    /** Default false — reuse cached JD factors. Pass true only for forced re-runs. */
    forceRefreshJobModel?: boolean;
  }): Promise<ResumeMatchResultJson | null> {
    const leadId = ResumeScreeningService.applicationOverlayLeadId(input.applicationId);
    const label = input.candidateLabel ?? `app:${input.applicationId}`;
    this.log.log(
      `[RESUME_SCREEN_APP] start label=${label} applicationId=${input.applicationId} jobProfileId=${input.jobProfileId} cvChars=${input.rawCvText?.length ?? 0} precomputedCandidate=${Boolean(input.precomputedCandidateModel)} forceRefreshJob=${input.forceRefreshJobModel === true}`,
    );

    await this.repo.upsertLeadOverlay(leadId, {
      resumeMatchStatus: RESUME_MATCH_STATUS.PENDING,
      resumeMatchError: null,
      resumeMatchAnalyzerVersion: RESUME_SCREEN_ANALYZER_VERSION,
      resumeMatchJobProfileId: input.jobProfileId,
    });

    const profile = await this.jobRepo.findById(input.jobProfileId);
    if (!profile) {
      await this.persistTerminal({
        leadId,
        status: RESUME_MATCH_STATUS.FAILED,
        error: RESUME_MATCH_ERROR.NO_JOB_PROFILE,
        summary: 'Job profile not found',
        cvHash: null,
        jobProfileId: input.jobProfileId,
        jobFingerprint: null,
        extractedText: input.rawCvText,
        result: null,
      });
      return null;
    }

    const cv = this.cvContent.fromExtractedText(input.rawCvText, 'url_extract');
    if (!cv) {
      await this.persistTerminal({
        leadId,
        status: RESUME_MATCH_STATUS.UNAVAILABLE,
        error: RESUME_MATCH_ERROR.THIN_CV,
        summary: 'CV content too thin to score',
        cvHash: null,
        jobProfileId: input.jobProfileId,
        jobFingerprint: null,
        extractedText: input.rawCvText,
        result: null,
      });
      return null;
    }

    try {
      const result = await this.engine.analyze({
        profile,
        cv,
        forceRefreshJobModel: input.forceRefreshJobModel === true,
        precomputedCandidateModel: input.precomputedCandidateModel ?? null,
      });
      this.printResumeScreenResult(label, result);
      await this.persistTerminal({
        leadId,
        status: result.status ?? RESUME_MATCH_STATUS.COMPLETED,
        error: result.error ?? null,
        summary: result.summary ?? '',
        cvHash: result.cv?.hash ?? cv.hash,
        jobProfileId: input.jobProfileId,
        jobFingerprint: result.job?.fingerprint ?? null,
        extractedText: input.rawCvText,
        result,
        score: result.score,
        confidence: result.confidence,
      });
      return result;
    } catch (err) {
      this.log.error(
        `[RESUME_SCREEN_APP] failed label=${label}: ${err instanceof Error ? err.message : String(err)}`,
      );
      await this.persistTerminal({
        leadId,
        status: RESUME_MATCH_STATUS.FAILED,
        error: RESUME_MATCH_ERROR.LLM_FAILED,
        summary: 'Resume screening failed',
        cvHash: cv.hash,
        jobProfileId: input.jobProfileId,
        jobFingerprint: null,
        extractedText: input.rawCvText,
        result: null,
      });
      return null;
    }
  }

  /** Verbose terminal dump for verification (Lead Inbox worker + demo portal). */
  printResumeScreenResult(label: string, result: ResumeMatchResultJson): void {
    const factorLines = (result.evaluation ?? []).map(
      (e) =>
        `  - ${e.factor} | imp=${e.importanceScore} W=${e.weight} m=${e.matchStrength} ` +
        `crit=${e.critical} evidence=${e.evidenceAvailable} match=${e.match} conf=${e.confidence}`,
    );
    this.log.log(
      [
        ``,
        `======== RESUME SCREEN RESULT (${label}) ========`,
        `status=${result.status} score=${result.score} confidence=${result.confidence}`,
        `summary=${result.summary}`,
        `job=${result.job?.title ?? 'n/a'} (id=${result.job?.profileId ?? 'n/a'}) fingerprint=${result.job?.fingerprint ?? 'n/a'}`,
        `cv source=${result.cv?.source ?? 'n/a'} chars=${result.cv?.charCount ?? 0} hash=${result.cv?.hash ?? 'n/a'} truncated=${result.cv?.truncated ?? false}`,
        `scoring method=${result.scoring?.method} analyzer=${result.scoring?.analyzerVersion} score0=${result.scoring?.score0} G=${result.scoring?.criticalGeoMean} gamma=${result.scoring?.gamma}`,
        `strengths=${(result.strengths ?? []).join(' | ') || '(none)'}`,
        `gaps=${(result.gaps ?? []).join(' | ') || '(none)'}`,
        `criticalGaps=${(result.criticalGaps ?? []).join(' | ') || '(none)'}`,
        `error=${result.error ?? '(none)'}`,
        `factors:`,
        ...factorLines,
        `======== END RESUME SCREEN RESULT ========`,
        ``,
      ].join('\n'),
    );
  }

  private runInline(payload: ResumeScreenJobPayload): void {
    void this.processJob(payload).catch((err) => {
      this.log.error(`Inline resume screen failed lead=${payload.leadId}: ${String(err)}`);
    });
  }

  private async persistTerminal(input: {
    leadId: string;
    status: string;
    error: string | null;
    summary: string;
    cvHash: string | null;
    jobProfileId: string | null;
    jobFingerprint: string | null;
    extractedText: string | null;
    result: ResumeMatchResultJson | null;
    score?: number | null;
    confidence?: number | null;
  }) {
    if (!input.result) {
      this.log.log(
        `[RESUME_SCREEN] terminal lead=${input.leadId} status=${input.status} error=${input.error ?? 'n/a'} summary=${input.summary}`,
      );
    }
    const analyzedAt = new Date();
    const json: ResumeMatchResultJson =
      input.result ??
      ({
        version: 1,
        status: input.status as ResumeMatchResultJson['status'],
        score: null,
        confidence: null,
        summary: input.summary,
        strengths: [],
        gaps: [],
        criticalGaps: [],
        evaluation: [],
        job: {
          profileId: input.jobProfileId,
          title: null,
          fingerprint: input.jobFingerprint,
          version: null,
        },
        cv: {
          source: null,
          hash: input.cvHash,
          charCount: input.extractedText?.length ?? 0,
        },
        scoring: {
          method: 'importance_strength_v1',
          analyzerVersion: RESUME_SCREEN_ANALYZER_VERSION,
          score0: null,
          criticalGeoMean: null,
          gamma: SCORE_CONSTANTS.GAMMA,
        },
        analyzedAt: analyzedAt.toISOString(),
        error: input.error ?? undefined,
      } satisfies ResumeMatchResultJson);

    await this.repo.mergeLeadOverlay(input.leadId, {
      resumeMatchStatus: input.status,
      resumeMatchScore:
        input.score != null ? String(input.score) : input.result?.score != null
          ? String(input.result.score)
          : null,
      resumeMatchConfidence:
        input.confidence != null
          ? String(input.confidence)
          : input.result?.confidence != null
            ? String(input.result.confidence)
            : null,
      resumeMatchJson: json as unknown as Record<string, unknown>,
      resumeMatchJobProfileId: input.jobProfileId,
      resumeMatchJobFingerprint: input.jobFingerprint,
      resumeMatchCvHash: input.cvHash,
      resumeMatchAnalyzerVersion: RESUME_SCREEN_ANALYZER_VERSION,
      resumeMatchAnalyzedAt: analyzedAt,
      resumeMatchError: input.error,
      resumeExtractedText: input.extractedText,
    });
  }
}
