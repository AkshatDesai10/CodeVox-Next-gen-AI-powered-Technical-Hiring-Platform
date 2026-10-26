import { Inject, Injectable, NotFoundException, forwardRef ,BadRequestException} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobApplicationMysql } from './entities/job-application.mysql.entity';
import { JobProfileMysql } from './entities/job-profile.mysql.entity';
import { JobProfileStageMysql, JobStageType } from './entities/job-profile-stage.mysql.entity';
import { CandidateMysql } from '../assessment-execution/entities/candidate.mysql.entity';
import { randomBytes } from 'crypto';
import { OpenAiClientService } from '../assessment-platform/assessment-ai/openai-client.service';
import { AutonomousInterviewRepository } from '../autonomous-interview/autonomous-interview.repository';
import { CandidateAutonomousInterviewMysql, AutonomousInterviewPhase } from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import { extractReportText } from '../ai-detection/text-extraction.util';
import { RecruitmentService } from '../recruitment/recruitment.service';
import { RecruitmentRepository } from '../recruitment/recruitment.repository';
import { ResumeScreeningService } from '../recruitment/resume-screening/resume-screening.service';
import { RoundSnapshotService } from '../assessment-reports/round-snapshot.service';
import { resolveInitialInterviewPhase, isBehaviouralAiStage } from './interview-phase.util';
import { ProjectInterviewService } from '../project-interview/project-interview.service';
import {
  buildLocalUploadUrl,
  resolveLocalDownloadUrl,
  underUploads,
  uploadBuffer,
} from '../../files/local-storage';

const pdfParse = require('pdf-parse');

const demoCandidates = new Map<string, { name: string; email: string }>();

const DEFAULT_FACE_CONSENT_TEXT =
  'I consent to capture and store my facial photograph for identity verification and assessment integrity. ' +
  'My photo will be stored securely and used only for this recruitment process.';

/** FACE / FACE_VERIFICATION: on|true|1|yes (default) vs off|false|0|no. */
function isFaceVerificationEnabled(): boolean {
  const val = (process.env.FACE ?? process.env.FACE_VERIFICATION ?? 'on')
    .trim()
    .toLowerCase();
  return val === 'on' || val === 'true' || val === '1' || val === 'yes';
}

function identityMode(): 'face' | 'permissions_only' {
  return isFaceVerificationEnabled() ? 'face' : 'permissions_only';
}

function isIdentityComplete(app: JobApplicationMysql): boolean {
  // Approach A: when face capture is off, portal identity is complete server-side
  // (device permissions are enforced client-side per session only).
  if (!isFaceVerificationEnabled()) return true;
  return Boolean(app.faceConsentRecordedAt && app.faceCapturedAt && app.facePhotoStorageKey);
}

function proctorStageType(interview: CandidateAutonomousInterviewMysql): string {
  const meta = interview.proctorSummary as Record<string, unknown> | null;
  return typeof meta?.stageType === 'string' ? meta.stageType : '';
}

/** A Defend/Build completion must not count as AI Verbal or HR. */
function sessionMatchesPortalStage(
  stageType: JobStageType,
  interview: CandidateAutonomousInterviewMysql,
): boolean {
  const stored = proctorStageType(interview);
  if (stageType === JobStageType.AI_VERBAL || stageType === JobStageType.SCREENING) {
    return stored === JobStageType.AI_VERBAL || stored === JobStageType.SCREENING;
  }
  if (stageType === JobStageType.AI_SCREENING) return stored === JobStageType.AI_SCREENING;
  if (stageType === JobStageType.HR_VERBAL) return stored === JobStageType.HR_VERBAL;
  return stored === stageType;
}

async function resolveFacePhotoUrl(
  app: Pick<JobApplicationMysql, 'facePhotoUrl' | 'facePhotoStorageKey'>,
): Promise<string | null> {
  const storagePath =
    app.facePhotoUrl?.trim() ||
    app.facePhotoStorageKey?.trim() ||
    '';
  if (!storagePath) return null;
  try {
    return await resolveLocalDownloadUrl({
      storagePath,
    });
  } catch {
    return app.facePhotoUrl?.trim() || null;
  }
}

/** Map demo CV LLM extract into ResumeScreeningEngine candidate-model shape. */
function demoCvExtractToCandidateModel(
  extracted: Record<string, unknown>,
): Record<string, unknown> | null {
  if (!extracted || typeof extracted !== 'object') return null;
  const skills = Array.isArray(extracted.skills)
    ? extracted.skills.map(String).filter((s) => s.trim())
    : [];
  const projectsRaw = extracted.projects_summary;
  const projects = Array.isArray(projectsRaw)
    ? projectsRaw.map(String).filter((s) => s.trim())
    : typeof projectsRaw === 'string' && projectsRaw.trim()
      ? [projectsRaw.trim()]
      : [];
  const education =
    typeof extracted.education_summary === 'string' && extracted.education_summary.trim()
      ? [extracted.education_summary.trim()]
      : [];
  const experience =
    typeof extracted.experience_summary === 'string' && extracted.experience_summary.trim()
      ? [extracted.experience_summary.trim()]
      : [];
  const summary =
    typeof extracted.summary === 'string' ? extracted.summary.trim() : '';
  if (!skills.length && !projects.length && !education.length && !experience.length && !summary) {
    return null;
  }
  return {
    summary,
    roles: experience,
    relevantYearsByDomain:
      extracted.experience_years != null && Number.isFinite(Number(extracted.experience_years))
        ? { overall: Number(extracted.experience_years) }
        : {},
    skills,
    tools: [],
    education,
    projects,
    leadership: [],
    evidenceDensity: Math.min(1, (skills.length + projects.length + experience.length) / 12),
    contradictions: [],
  };
}

@Injectable()
export class CandidatePortalService {
  constructor(
    @InjectRepository(JobApplicationMysql)
    private readonly applications: Repository<JobApplicationMysql>,
    @InjectRepository(JobProfileMysql)
    private readonly profiles: Repository<JobProfileMysql>,
    @InjectRepository(JobProfileStageMysql)
    private readonly stages: Repository<JobProfileStageMysql>,
    @InjectRepository(CandidateMysql)
    private readonly candidates: Repository<CandidateMysql>,
    private readonly openai: OpenAiClientService,
    private readonly interviewRepo: AutonomousInterviewRepository,
    @Inject(forwardRef(() => RecruitmentService))
    private readonly recruitmentService: RecruitmentService,
    private readonly recruitmentRepo: RecruitmentRepository,
    @Inject(forwardRef(() => ResumeScreeningService))
    private readonly resumeScreening: ResumeScreeningService,
    private readonly roundSnapshots: RoundSnapshotService,
    private readonly projectInterview: ProjectInterviewService,
  ) { }

  /**
   * Round progress for ops dashboards (Today's Interviews).
   * Maps portal stage statuses → completed / live / not_started / upcoming.
   * NOT_STARTED (current unlocked round) must not be collapsed into upcoming.
   */
  async getRoundProgressForToken(token: string): Promise<{
    rounds: Array<{
      id: string;
      name: string;
      type: string;
      status: 'completed' | 'live' | 'not_started' | 'upcoming';
    }>;
    completed_count: number;
    total_count: number;
  } | null> {
    try {
      const dash = await this.getDashboardPayload(token, { skipSideEffects: true });
      const rounds = (dash.stages ?? []).map((s: {
        id: string;
        name: string;
        type: string;
        status: string;
      }) => {
        const raw = String(s.status ?? '').toUpperCase();
        let status: 'completed' | 'live' | 'not_started' | 'upcoming' = 'upcoming';
        if (raw === 'COMPLETED') status = 'completed';
        else if (raw === 'IN_PROGRESS') status = 'live';
        else if (raw === 'NOT_STARTED') status = 'not_started';
        else status = 'upcoming'; // LOCKED / unknown → future rounds
        return {
          id: String(s.id),
          name: s.name,
          type: s.type,
          status,
        };
      });
      return {
        rounds,
        completed_count: rounds.filter((r) => r.status === 'completed').length,
        total_count: rounds.length,
      };
    } catch {
      return null;
    }
  }

  /** Newest session for this stage. An older abandoned attempt must not keep the round open. */
  private async interviewForStage(portalToken: string, stageType: JobStageType) {
    const rows = await this.interviewRepo.findAllForPortalToken(portalToken);
    const matches = rows.filter(
      (row) => row.candidateToken !== portalToken && sessionMatchesPortalStage(stageType, row),
    );
    return matches[0] ?? null;
  }

  async getDashboardPayload(token: string, opts?: { skipSideEffects?: boolean }) {
    const application = await this.applications.findOne({
      where: { candidateToken: token, inactive: 0 },
      relations: ['profile'],
    });

    if (!application) {
      throw new NotFoundException('Invalid or expired candidate token');
    }

    const profile = application.profile;
    if (!profile) {
      throw new NotFoundException('Associated job profile not found');
    }

    // Trigger background resume parse (non-blocking)
    if (!opts?.skipSideEffects) {
      this.recruitmentService.triggerBackgroundResumeParse(application).catch(console.error);
    }

    // Include only stages assigned to this application (not live profile churn).
    const allStages = await this.stages.find({
      where: { jobProfileId: profile.id },
      order: { sortOrder: 'ASC' },
    });
    const snapshots = await this.roundSnapshots.ensureForApplication(
      String(application.id),
    );
    const stages = this.roundSnapshots.pipelineStagesForApplication(
      application,
      allStages,
      snapshots,
    );

    const currentStageIdx = stages.findIndex((s) => String(s.id) === String(application.currentStageId));

    let effectiveCurrentIdx = currentStageIdx;
    if (application.status === 'rejected') {
      effectiveCurrentIdx = stages.length;
    } else if (currentStageIdx === -1) {
      effectiveCurrentIdx = 0;
    }
    // Do NOT treat hired/completed as "all rounds done" up-front — that hid remaining
    // rounds (e.g. Build & Defend) when advance incorrectly marked the application finished.

    // Heal stuck applications: round already finished but pipeline never advanced
    // (e.g. older demo isPreview path / missing portalToken). Unlock the next stage.
    if (
      effectiveCurrentIdx >= 0 &&
      effectiveCurrentIdx < stages.length &&
      application.status !== 'rejected'
    ) {
      const currentStage = stages[effectiveCurrentIdx];
      if (currentStage?.stageType === JobStageType.PROJECT_INTERVIEW) {
        const projectStatus = await this.projectInterview.getPortalStatus(
          String(application.id),
          String(currentStage.id),
        );
        if (projectStatus === 'COMPLETED') {
          if (effectiveCurrentIdx + 1 < stages.length) {
            const next = stages[effectiveCurrentIdx + 1];
            await this.applications.update(
              { id: application.id },
              {
                currentStageId: next.id,
                status: 'in_progress' as any,
              },
            );
            application.currentStageId = next.id;
            application.status = 'in_progress' as any;
            effectiveCurrentIdx = effectiveCurrentIdx + 1;
          } else {
            effectiveCurrentIdx = stages.length;
          }
        }
      } else if (
        currentStage?.stageType === JobStageType.HR_VERBAL ||
        currentStage?.stageType === JobStageType.AI_VERBAL ||
        currentStage?.stageType === JobStageType.SCREENING ||
        currentStage?.stageType === JobStageType.AI_SCREENING
      ) {
        const interview = await this.interviewRepo.findForApplicationAndStage(
          token,
          String(currentStage.id),
          currentStage.stageType,
        );
        const hasHr =
          interview?.hrVoiceAudit != null &&
          typeof interview.hrVoiceAudit === 'object' &&
          Object.keys(interview.hrVoiceAudit as object).length > 0;
        const hasTech =
          interview?.stage1VoiceAudit != null &&
          typeof interview.stage1VoiceAudit === 'object' &&
          Object.keys(interview.stage1VoiceAudit as object).length > 0;
        const hasScreeningAudit =
          interview?.screeningVoiceAudit != null &&
          typeof interview.screeningVoiceAudit === 'object' &&
          Object.keys(interview.screeningVoiceAudit as object).length > 0;
        // Stage-scoped evidence only — do not treat a generic "completed" phase
        // from another round as finishing the current stage.
        const currentDone =
          (currentStage.stageType === JobStageType.HR_VERBAL && (hasHr || interview?.currentPhase === 'completed')) ||
          ((currentStage.stageType === JobStageType.AI_VERBAL ||
            currentStage.stageType === JobStageType.SCREENING) &&
            (hasTech || interview?.currentPhase === 'completed')) ||
          (currentStage.stageType === JobStageType.AI_SCREENING &&
            (hasScreeningAudit || interview?.currentPhase === 'completed'));

        if (currentDone && effectiveCurrentIdx + 1 < stages.length) {
          const next = stages[effectiveCurrentIdx + 1];
          await this.applications.update(
            { id: application.id },
            {
              currentStageId: next.id,
              status: 'in_progress' as any,
            },
          );
          application.currentStageId = next.id;
          application.status = 'in_progress' as any;
          effectiveCurrentIdx = effectiveCurrentIdx + 1;
        } else if (currentDone && effectiveCurrentIdx + 1 >= stages.length) {
          effectiveCurrentIdx = stages.length;
        }
      }
    }

    // If app was marked hired/completed early but later assigned rounds still exist
    // and are not the current pointer past the end, reopen the dashboard journey.
    if (
      (application.status === 'hired' || application.status === 'completed') &&
      effectiveCurrentIdx < stages.length
    ) {
      await this.applications.update(
        { id: application.id },
        { status: 'in_progress' as any },
      );
      application.status = 'in_progress' as any;
    }

    const identityComplete = isIdentityComplete(application);

    const mappedStages = await Promise.all(stages.map(async (stage, idx) => {
      let status: 'COMPLETED' | 'IN_PROGRESS' | 'LOCKED' | 'NOT_STARTED' = 'LOCKED';

      if (idx < effectiveCurrentIdx) {
        status = 'COMPLETED';
      } else if (idx === effectiveCurrentIdx) {
        status = 'NOT_STARTED';

        const isVerbal =
          stage.stageType === JobStageType.AI_VERBAL ||
          stage.stageType === JobStageType.SCREENING ||
          stage.stageType === JobStageType.HR_VERBAL ||
          stage.stageType === JobStageType.AI_SCREENING;

        if (stage.stageType === JobStageType.PROJECT_INTERVIEW) {
          status = await this.projectInterview.getPortalStatus(
            String(application.id),
            String(stage.id),
          );
        } else if (isVerbal) {
          // Look up session specifically for this stage (matches stageId or stageType)
          const interview = await this.interviewRepo.findForApplicationAndStage(
            token,
            String(stage.id),
            stage.stageType,
          );
          if (interview) {
            const phase = String(interview.currentPhase ?? '');
            const hasHr =
              interview.hrVoiceAudit != null &&
              typeof interview.hrVoiceAudit === 'object' &&
              Object.keys(interview.hrVoiceAudit as object).length > 0;
            const hasTech =
              interview.stage1VoiceAudit != null &&
              typeof interview.stage1VoiceAudit === 'object' &&
              Object.keys(interview.stage1VoiceAudit as object).length > 0;
            const hasScreening =
              interview.screeningVoiceAudit != null &&
              typeof interview.screeningVoiceAudit === 'object';

            if (stage.stageType === JobStageType.HR_VERBAL) {
              if (hasHr || phase === 'completed') {
                status = 'COMPLETED';
              } else if (phase === 'hr_verbal') {
                status = 'IN_PROGRESS';
              }
            } else if (stage.stageType === JobStageType.AI_SCREENING) {
              const audit = interview.screeningVoiceAudit as Record<string, unknown> | null;
              const analyzerStatus = String(audit?.analyzerStatus ?? '');
              if (analyzerStatus === 'COMPLETED' || hasScreening || phase === 'completed') {
                status = 'COMPLETED';
              } else if (phase === 'ai_screening') {
                status = 'IN_PROGRESS';
              }
            } else if (sessionMatchesPortalStage(stage.stageType, interview)) {
              // Only this round's own session. Defend's completed phase is not AI Verbal.
              if (hasTech || phase === 'completed') {
                status = 'COMPLETED';
              } else if (
                phase === 'intro_verbal' ||
                phase === 'sandbox_code' ||
                phase === 'closing'
              ) {
                status = 'IN_PROGRESS';
              }
            }
          }
        }

        // Soft-lock current round until portal identity is complete (no-op when FACE=off).
        if (!identityComplete && (status === 'NOT_STARTED' || status === 'IN_PROGRESS')) {
          status = 'LOCKED';
        }
      } else {
        status = 'LOCKED';
      }

      return {
        id: stage.id,
        name: stage.name,
        type: stage.stageType,
        sortOrder: stage.sortOrder,
        status,
        description: stage.description,
      };
    }));

    const candidateRec = await this.candidates.findOne({ where: { id: application.candidateId } });
    let candidateName = candidateRec ? `${candidateRec.firstName || ''} ${candidateRec.lastName || ''}`.trim() || 'Candidate' : 'Candidate';
    let candidateEmail = candidateRec?.email || '';

    if (application.source === 'demo_testing' && demoCandidates.has(token)) {
      const demoData = demoCandidates.get(token)!;
      candidateName = demoData.name;
      candidateEmail = demoData.email;
    }

    const sourceLeadId = application.source?.startsWith('lead:')
      ? application.source.slice('lead:'.length)
      : null;
    const leadOverlay = sourceLeadId
      ? await this.recruitmentRepo.findLeadOverlay(sourceLeadId).catch(() => null)
      : null;
    const parsedOverlay = (leadOverlay?.parsedResumeJson ?? null) as Record<
      string,
      unknown
    > | null;
    const firstNameRaw = String(candidateRec?.firstName ?? '').trim();
    const firstNamePending = firstNameRaw.toLowerCase() === 'pending';
    const onboardingRequired = parsedOverlay?.onboarding_required === true;
    // Name gate: empty / placeholder "Pending" (bulk-invite self-onboard).
    const needsName = !firstNameRaw || firstNamePending;
    // Resume gate only for bulk-invite self-onboard flows — do not block
    // existing single-invite candidates who were created without a resume.
    const needsResume = onboardingRequired && !candidateRec?.resumeUrl;
    const resumeScreening = await this.resumeScreening
      .getApplicationResumeMatch(String(application.id), sourceLeadId)
      .catch(() => null);

    return {
      candidate: {
        id: application.candidateId,
        name: candidateName,
        email: candidateEmail,
      },
      application: {
        id: application.id,
        status: application.status,
        appliedAt: application.appliedAt,
        auto_action: application.autoAction,
      },
      identity: {
        required: isFaceVerificationEnabled(),
        mode: identityMode(),
        consent_recorded: Boolean(application.faceConsentRecordedAt),
        face_captured: Boolean(application.faceCapturedAt && application.facePhotoStorageKey),
        complete: identityComplete,
        consent_text: DEFAULT_FACE_CONSENT_TEXT,
        face_photo_url: await resolveFacePhotoUrl(application),
      },
      interview_language: application.interviewLanguage === 'hi' ? 'hi' : 'en',
      guidelines_accepted: Boolean(application.guidelinesAcceptedAt),
      onboarding: {
        needs_name: needsName,
        needs_resume: needsResume,
        complete: !needsName && !needsResume,
        assigned_slot_label: leadOverlay?.inviteSlotLabel ?? null,
      },
      job: {
        id: profile.id,
        title: profile.title,
        department: profile.department,
        location: profile.locationText,
        responsibilities: profile.responsibilities,
        requiredSkills: profile.requiredSkills,
        progressionMode: (profile.progressionConfig as any)?.mode || 'sequential',
      },
      stages: mappedStages,
      resume_screening: resumeScreening
        ? {
            status: resumeScreening.resume_match_status,
            score: resumeScreening.resume_match_score,
            confidence: resumeScreening.resume_match_confidence,
            summary: resumeScreening.summary ?? null,
            strengths: resumeScreening.strengths ?? [],
            gaps: resumeScreening.gaps ?? [],
            analyzed_at: resumeScreening.resume_match_analyzed_at,
            error: resumeScreening.resume_match_error,
          }
        : null,
    };
  }

  async onboardCandidate(
    token: string,
    body: { name?: string },
    resumeFile?: Express.Multer.File,
  ) {
    const application = await this.applications.findOne({
      where: { candidateToken: token, inactive: 0 },
    });
    if (!application) throw new NotFoundException('Invalid or expired candidate token');

    const candidate = await this.candidates.findOne({
      where: { id: application.candidateId },
    });
    if (!candidate) throw new NotFoundException('Candidate not found');

    const name = String(body.name ?? '').trim();
    if (!name) throw new BadRequestException('Name is required');

    const [firstName, ...rest] = name.split(/\s+/);
    const lastName = rest.join(' ').trim() || null;
    candidate.firstName = firstName;
    candidate.lastName = lastName;

    let resumeUrl = candidate.resumeUrl ?? null;
    let extractedText: string | null = null;
    let extractedData: Record<string, unknown> = {};

    if (resumeFile?.buffer?.length) {
      const original = String(resumeFile.originalname ?? '').toLowerCase();
      const mime = String(resumeFile.mimetype ?? '').toLowerCase();
      const isPdf = original.endsWith('.pdf') || mime.includes('pdf');
      const isDocx =
        original.endsWith('.docx') ||
        mime.includes('wordprocessingml') ||
        mime.includes('officedocument');
      if (!isPdf && !isDocx) {
        throw new BadRequestException('Only PDF and DOCX resumes are supported');
      }
      if (resumeFile.buffer.length > 8 * 1024 * 1024) {
        throw new BadRequestException('Resume must be 8MB or smaller');
      }

      const ext = (original.match(/\.[a-z0-9]+$/i)?.[0] ?? '.pdf').toLowerCase();
      const key = underUploads(
        'candidate-resumes',
        String(candidate.id),
        `${Date.now()}${ext}`,
      );
      resumeUrl = await uploadBuffer({
        key,
        body: resumeFile.buffer,
        contentType: resumeFile.mimetype || 'application/octet-stream',
      });
      candidate.resumeUrl = resumeUrl;

      try {
        extractedText = await extractReportText(resumeFile);
        if (this.openai.isConfigured() && extractedText) {
          const ai = await this.openai.chatJson<{
            skills: string[];
            experience_years: number | null;
            education_summary: string;
            experience_summary: string;
            projects_summary: string;
            summary: string;
          }>([
            {
              role: 'system',
              content:
                'You are a strict data extractor. You MUST output ONLY valid JSON without any markdown formatting, backticks, or extra text. Return JSON exactly matching this schema: { "skills": string[], "experience_years": number|null, "education_summary": string, "experience_summary": string, "projects_summary": string, "summary": string }',
            },
            {
              role: 'user',
              content: `Extract detailed technical projects and work experience from this resume.\n\n${extractedText.slice(0, 8000)}`,
            },
          ]);
          if (!(ai as Record<string, unknown> | undefined)?.__isFallback) {
            extractedData = ai as Record<string, unknown>;
          }
        }
      } catch (err) {
        console.error('Failed to parse resume during onboard:', err);
      }

      if (extractedData.skills) {
        const sk = extractedData.skills;
        candidate.skills = Array.isArray(sk) ? sk.map(String) : [];
      }
      if (extractedData.experience_years != null) {
        candidate.experienceYears = String(extractedData.experience_years);
      }
      if (extractedData.education_summary) {
        candidate.educationSummary = String(extractedData.education_summary);
      }
      if (extractedData.experience_summary) {
        candidate.experienceSummary = String(extractedData.experience_summary);
      }
      if (extractedData.projects_summary) {
        const ps = extractedData.projects_summary;
        candidate.projectsSummary = Array.isArray(ps)
          ? (ps as string[]).join('\n\n')
          : String(ps);
      }
    }

    await this.candidates.save(candidate);

    const stillNeedsResume = !candidate.resumeUrl;
    let wasOnboardingRequired = false;

    if (application.source?.startsWith('lead:')) {
      const leadId = application.source.slice('lead:'.length);
      const overlay = await this.recruitmentRepo.findLeadOverlay(leadId);
      if (overlay) {
        const prev = (overlay.parsedResumeJson ?? {}) as Record<string, unknown>;
        wasOnboardingRequired = prev.onboarding_required === true;
        // Keep flag until resume is uploaded for bulk-invite self-onboard flows.
        const stillRequired = wasOnboardingRequired && stillNeedsResume;
        const updated = await this.recruitmentRepo.mergeLeadOverlay(leadId, {
          resumeExtractedText: extractedText?.trim() || overlay.resumeExtractedText,
          parsedResumeJson: {
            ...prev,
            first_name: firstName,
            last_name: lastName ?? '',
            name,
            resume_url: resumeUrl ?? prev.resume_url ?? null,
            onboarding_required: stillRequired,
            ...(extractedData.skills ? { skills: extractedData.skills } : {}),
            ...(extractedData.experience_summary
              ? { experience_summary: extractedData.experience_summary }
              : {}),
            ...(extractedData.education_summary
              ? { education_summary: extractedData.education_summary }
              : {}),
            ...(extractedData.projects_summary
              ? { projects_summary: extractedData.projects_summary }
              : {}),
          },
        });

        if (extractedText?.trim()) {
          void this.resumeScreening
            .ensureManualLeadScreened(updated)
            .catch((err) => {
              console.error(
                `Onboard resume screen enqueue failed for lead ${leadId}:`,
                err,
              );
            });
          void this.recruitmentService
            .triggerBackgroundResumeParse(application)
            .catch(console.error);
        }
      }
    }

    const needsResume = wasOnboardingRequired && stillNeedsResume;
    return {
      candidate: {
        name: `${candidate.firstName || ''} ${candidate.lastName || ''}`.trim() || name,
        email: candidate.email,
      },
      onboarding: {
        complete: !needsResume,
        needs_name: false,
        needs_resume: needsResume,
      },
    };
  }

  private async requireApplicationByToken(token: string): Promise<JobApplicationMysql> {
    const application = await this.applications.findOne({
      where: { candidateToken: token, inactive: 0 },
    });
    if (!application) throw new NotFoundException('Invalid or expired candidate token');
    return application;
  }

  async recordFaceConsent(token: string) {
    if (!isFaceVerificationEnabled()) {
      throw new BadRequestException('Face verification is disabled for this environment');
    }
    const application = await this.requireApplicationByToken(token);
    if (!application.faceConsentRecordedAt) {
      const now = new Date();
      await this.applications.update(
        { id: application.id },
        { faceConsentRecordedAt: now },
      );
      application.faceConsentRecordedAt = now;
    }
    return {
      consent_recorded: true,
      face_captured: Boolean(application.faceCapturedAt && application.facePhotoStorageKey),
      complete: isIdentityComplete(application),
    };
  }

  async savePortalPreferences(
    token: string,
    body: { interview_language?: string; accept_guidelines?: boolean },
  ) {
    const application = await this.requireApplicationByToken(token);
    const patch: { interviewLanguage?: string; guidelinesAcceptedAt?: Date } = {};
    const raw = (body.interview_language ?? '').trim().toLowerCase();
    if (raw === 'en' || raw === 'hi') {
      patch.interviewLanguage = raw;
      application.interviewLanguage = raw;
    }
    if (body.accept_guidelines && !application.guidelinesAcceptedAt) {
      const now = new Date();
      patch.guidelinesAcceptedAt = now;
      application.guidelinesAcceptedAt = now;
    }
    if (Object.keys(patch).length) {
      await this.applications.update({ id: application.id }, patch);
    }
    return {
      interview_language: application.interviewLanguage === 'hi' ? 'hi' : 'en',
      guidelines_accepted: Boolean(application.guidelinesAcceptedAt),
    };
  }

  async captureFacePhoto(
    token: string,
    body: { image_base64?: string; face_descriptor?: number[] | null },
  ) {
    if (!isFaceVerificationEnabled()) {
      throw new BadRequestException('Face verification is disabled for this environment');
    }
    const application = await this.requireApplicationByToken(token);
    if (!application.faceConsentRecordedAt) {
      throw new BadRequestException('Please accept consent before capturing your face photo');
    }

    const raw = (body.image_base64 ?? '').trim();
    if (!raw) throw new BadRequestException('image_base64 is required');

    const base64 = raw.includes(',') ? raw.slice(raw.indexOf(',') + 1) : raw;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      throw new BadRequestException('Invalid image_base64');
    }
    if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
      throw new BadRequestException('Face photo must be between 1 byte and 8MB');
    }

    const key = underUploads('candidate-faces', String(application.id), `${Date.now()}.jpg`);

    const url = await uploadBuffer({
      key,
      body: buffer,
      contentType: 'image/jpeg',
    });

    const descriptor =
      Array.isArray(body.face_descriptor) && body.face_descriptor.length >= 64
        ? body.face_descriptor.map((n) => Number(n)).filter((n) => Number.isFinite(n))
        : null;
    if (!descriptor || descriptor.length < 64) {
      throw new BadRequestException(
        'A clear detected face is required before saving. Please retake the photo.',
      );
    }

    const now = new Date();
    const storedUrl = url || buildLocalUploadUrl(key);
    await this.applications.update(
      { id: application.id },
      {
        faceCapturedAt: now,
        facePhotoStorageKey: key,
        facePhotoUrl: storedUrl,
        referenceFaceDescriptor: descriptor,
      },
    );

    const viewUrl = await resolveFacePhotoUrl({
      facePhotoUrl: storedUrl,
      facePhotoStorageKey: key,
    });

    return {
      consent_recorded: true,
      face_captured: true,
      complete: true,
      face_photo_url: viewUrl || storedUrl,
      storage_key: key,
    };
  }

  async createDemoApplication(jobProfileId: string, candidateName: string, candidateEmail: string, resumeFile?: Express.Multer.File) {
    if (!jobProfileId) {
      throw new BadRequestException('Job Profile ID is required.');
    }
    const profile = await this.profiles.findOne({ where: { id: jobProfileId, inactive: 0 } });
    if (!profile) throw new NotFoundException('Job profile not found');

    const stages = await this.stages.find({
      where: { jobProfileId: profile.id, inactive: 0 },
      order: { sortOrder: 'ASC' },
    });

    const firstStage = stages[0];
    const demoToken = 'demo_' + randomBytes(16).toString('hex');

    // Parse resume if provided (PDF / DOCX / text with resilient extractors)
    let extractedData: any = {};
    let rawCvTextForScreening: string | null = null;
    if (resumeFile && resumeFile.buffer) {
      try {
        const rawText = await extractReportText(resumeFile);
        rawCvTextForScreening = rawText;

        if (this.openai.isConfigured()) {
          const ai = await this.openai.chatJson<{
            skills: string[];
            experience_years: number | null;
            education_summary: string;
            experience_summary: string;
            projects_summary: string;
            summary: string;
          }>([
            {
              role: 'system',
              content: 'You are a strict data extractor. You MUST output ONLY valid JSON without any markdown formatting, backticks, or extra text. Return JSON exactly matching this schema: { "skills": string[], "experience_years": number|null, "education_summary": string, "experience_summary": string, "projects_summary": string, "summary": string }'
            },
            {
              role: 'user',
              content: `Extract detailed technical projects and work experience from this resume.\n\n${rawText.slice(0, 8000)}`
            }
          ]);

          if ((ai as Record<string, unknown> | undefined)?.__isFallback) {
            console.warn('[CV_PARSE_FALLBACK_REJECTED]', {
              rawTextLength: rawText.length,
              preview: rawText.slice(0, 500),
              reason: 'resume extraction returned fallback payload instead of real CV data',
            });
            extractedData = {};
          } else {
            extractedData = ai;
          }
        }
      } catch (err) {
        console.error('Failed to parse resume for demo candidate:', err);
      }
    }

    // Create or update a real candidate record for demo
    const [firstName, ...lastNames] = candidateName.split(' ');
    const email = candidateEmail || `demo_${Date.now()}@example.com`;
    
    let candidate = await this.candidates.findOne({ where: { email } });
    if (!candidate) {
      candidate = this.candidates.create({
        firstName: firstName || 'Demo',
        lastName: lastNames.join(' ') || null,
        email: email,
        status: 'ACTIVE',
      });
    } else {
      candidate.firstName = firstName || 'Demo';
      candidate.lastName = lastNames.join(' ') || null;
    }
    
    if (extractedData.skills) {
      const sk = extractedData.skills;
      candidate.skills = Array.isArray(sk) ? sk.map(String) : [];
    }
    if (extractedData.experience_years != null) candidate.experienceYears = String(extractedData.experience_years);
    if (extractedData.education_summary) candidate.educationSummary = String(extractedData.education_summary);
    if (extractedData.experience_summary) candidate.experienceSummary = String(extractedData.experience_summary);
    if (extractedData.projects_summary) {
      // AI sometimes returns an array instead of a string — always normalize to string
      const ps = extractedData.projects_summary;
      candidate.projectsSummary = Array.isArray(ps) ? (ps as string[]).join('\n\n') : String(ps);
    }

    let savedCandidate: typeof candidate;
    try {
      savedCandidate = await this.candidates.save(candidate);
    } catch (saveErr: any) {
      // If save fails (e.g. column mismatch from stale DB schema), strip optional fields and retry
      console.error('Candidate save failed, retrying without extracted data:', saveErr?.message);
      candidate.skills = null;
      candidate.projectsSummary = null;
      candidate.experienceSummary = null;
      candidate.educationSummary = null;
      candidate.experienceYears = null;
      savedCandidate = await this.candidates.save(candidate);
    }

    const app = this.applications.create({
      jobProfileId: profile.id,
      candidateId: savedCandidate.id,
      candidateToken: demoToken,
      currentStageId: firstStage?.id ?? null,
      status: 'in_progress' as any,
      source: 'demo_testing',
      inactive: 0,
    });

    const savedApp = await this.applications.save(app);
    demoCandidates.set(demoToken, { name: candidateName, email: candidateEmail });
    await this.roundSnapshots.freezeAssignedPipeline(String(savedApp.id));



    const config = profile.autonomousInterviewConfig ?? {};
    const allStages = await this.stages.find({
      where: { jobProfileId: profile.id, inactive: 0 },
      order: { sortOrder: 'ASC' },
    });
    await this.interviewRepo.createSeed({
      candidateToken: demoToken,
      jobProfileId: profile.id,
      isPreview: 1, // Treat demo as preview
      currentPhase: resolveInitialInterviewPhase(allStages),
      techStack: (config as any).tech_stack ?? profile.requiredSkills?.[0] ?? 'General',
      resumeSkills: savedCandidate.skills ?? profile.requiredSkills ?? [],
      proctorSummary: {
        portalToken: demoToken,
        isDemo: true,
        candidateName: candidateName.trim() || savedCandidate.firstName || 'Demo Candidate',
        candidateEmail: email,
      },
    } as Partial<CandidateAutonomousInterviewMysql>);

    // Same ResumeScreeningEngine as Lead Inbox — persist under app:{id} for portal dashboard.
    // Reuse demo CV extract as candidate model + JD factor cache to cut Gemini calls (4 → ~2).
    if (rawCvTextForScreening?.trim()) {
      const precomputedCandidateModel = demoCvExtractToCandidateModel(extractedData);
      void this.resumeScreening
        .analyzeAndPersistForApplication({
          applicationId: String(savedApp.id),
          jobProfileId: profile.id,
          rawCvText: rawCvTextForScreening,
          candidateLabel: `demo:${candidateEmail || candidateName}:${profile.title}`,
          precomputedCandidateModel,
          forceRefreshJobModel: false,
        })
        .catch((err) => {
          console.error('[RESUME_SCREEN_DEMO] failed:', err);
        });
    }

    return { token: demoToken };
  }

  /**
   * Called when candidate clicks "Start Round" for any stage from the portal.
   * Creates a fresh ses_... session seed for that specific stage and returns
   * the URL the frontend should redirect to.
   */
  async startStage(portalToken: string, stageId: string) {
    const application = await this.applications.findOne({
      where: { candidateToken: portalToken, inactive: 0 },
      relations: ['profile'],
    });
    if (!application) throw new NotFoundException('Invalid or expired candidate token');

    if (isFaceVerificationEnabled() && !isIdentityComplete(application)) {
      throw new BadRequestException(
        'Face capture and consent are required before starting any round',
      );
    }
    if (!application.guidelinesAcceptedAt) {
      throw new BadRequestException(
        'Please accept the assessment guidelines once before starting a round',
      );
    }

    const profile = application.profile;
    if (!profile) throw new NotFoundException('Associated job profile not found');

    // Validate the stage belongs to this profile
    const stage = await this.stages.findOne({
      where: { id: stageId as any, jobProfileId: profile.id, inactive: 0 },
    });
    if (!stage) throw new NotFoundException('Stage not found for this application');

    // Get candidate for resume skills
    const candidate = await this.candidates.findOne({ where: { id: application.candidateId } });

    // Determine the starting phase for this specific stage
    const config = profile.autonomousInterviewConfig ?? {};
    const allStages = await this.stages.find({
      where: { jobProfileId: profile.id, inactive: 0 },
      order: { sortOrder: 'ASC' },
    });

    // Coding, Take-Home, Screening, and Custom rounds use the portal token directly.
    // They look up the application via candidate_token = portalToken — no ses_xxx needed.
    // Only AI verbal rounds need a session row in the autonomous interview table.
    const isScreening =
      stage.stageType === JobStageType.AI_SCREENING ||
      /screen/i.test(stage.name || '');

    const isAiRound =
      stage.stageType === JobStageType.AI_VERBAL ||
      stage.stageType === JobStageType.HR_VERBAL ||
      isScreening;

    if (stage.stageType === JobStageType.PROJECT_INTERVIEW) {
      const submission = await this.projectInterview.ensureForApplication(
        String(application.id),
        String(stage.id),
      );
      if (!submission) throw new BadRequestException('Could not start the Build & Defend round');
      return {
        token: submission.submissionToken,
        url: `/assessments/candidate/project-interview/${submission.submissionToken}`,
      };
    }

    if (!isAiRound) {
      let url = `/candidate/coding/${portalToken}`;
      if (stage.stageType === JobStageType.SCREENING || stage.stageType === JobStageType.CUSTOM) {
        url = `/assessments/candidate/${portalToken}`;
      }
      return { token: portalToken, url };
    }

    // For AI verbal rounds: create a fresh ses_xxx session in the autonomous interview table.
    const startingPhase =
      isScreening
        ? AutonomousInterviewPhase.AI_SCREENING
        : isBehaviouralAiStage(stage)
        ? AutonomousInterviewPhase.HR_VERBAL
        : AutonomousInterviewPhase.INTRO_VERBAL;

    const sessionToken = 'ses_' + randomBytes(16).toString('hex');

    await this.interviewRepo.createSeed({
      candidateToken: sessionToken,
      jobProfileId: profile.id,
      // Demo applications must still advance the pipeline and persist reports;
      // isPreview is reserved for true preview links without a job application.
      isPreview: 0,
      currentPhase: startingPhase,
      techStack: (config as any).tech_stack ?? profile.requiredSkills?.[0] ?? 'General',
      resumeSkills: candidate?.skills ?? profile.requiredSkills ?? [],
      proctorSummary: {
        portalToken: application.candidateToken,
        isBehavioral: isBehaviouralAiStage(stage),
        stageId: String(stage.id),
        stageType: isScreening ? JobStageType.AI_SCREENING : stage.stageType,
      },
    } as Partial<CandidateAutonomousInterviewMysql>);

    return {
      token: sessionToken,
      url: `/autonomous-interview/${sessionToken}?portalToken=${portalToken}`,
    };
  }
}
