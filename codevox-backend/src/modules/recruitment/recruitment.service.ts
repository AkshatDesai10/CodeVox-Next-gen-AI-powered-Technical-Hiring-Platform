import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import { RbacPermissionService } from '../../authorization/rbac-permission.service';
import { JobProfilesService } from '../job-profiles/job-profiles.service';
import { JobProfilesRepository } from '../job-profiles/job-profiles.repository';
import { CandidatePortalService } from '../job-profiles/candidate-portal.service';
import { JobApplicationMysql, JobApplicationStatus } from '../job-profiles/entities/job-application.mysql.entity';
import { CandidateMysql } from '../assessment-execution/entities/candidate.mysql.entity';
import { RecruitmentRepository } from './recruitment.repository';
import { RecruitmentAiService } from './recruitment-ai.service';
import { RecruitmentInterviewOverlayMysql } from './entities/recruitment-interview-overlay.mysql.entity';
import { EmailService } from '../email/email.service';
import { buildMagicLinkEmail, buildNoOpeningEmail } from '../email/email-templates';
import { JobProfileStatus } from '../job-profiles/entities/job-profile.mysql.entity';
import { ResumeScreeningService } from './resume-screening/resume-screening.service';
import type { RecruitmentLeadOverlayMysql } from './entities/recruitment-lead-overlay.mysql.entity';
import type { RecruitmentInterviewTimeSlotMysql } from './entities/recruitment-interview-time-slot.mysql.entity';
import {
  INBOX_PIPELINE_STAGES,
  type LocalLeadRow,
} from './recruitment-local.types';
import { randomBytes } from 'crypto';
import { uploadBuffer, underUploads } from '../../files/local-storage';
import { extractReportText } from '../ai-detection/text-extraction.util';

const IST_TZ = 'Asia/Kolkata';
const MAX_BULK_RESUMES = 50;
const MAX_RESUME_BYTES = 8 * 1024 * 1024;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const SIMPLE_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

type UploadedResumeFile = {
  buffer?: Buffer;
  mimetype?: string;
  originalname?: string;
  size?: number;
};

function nameFromResumeFilename(originalname?: string): string {
  const base = String(originalname ?? '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\b(resume|cv|curriculum vitae)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!base) return 'Candidate';
  return base
    .split(' ')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ')
    .slice(0, 120);
}

function emailFromText(text: string): string | null {
  const match = text.match(EMAIL_RE);
  return match ? match[0].toLowerCase() : null;
}

function isAllowedResumeMime(file: UploadedResumeFile): boolean {
  const name = String(file.originalname ?? '').toLowerCase();
  const mime = String(file.mimetype ?? '').toLowerCase();
  if (name.endsWith('.pdf') || mime.includes('pdf')) return true;
  if (name.endsWith('.docx') || mime.includes('wordprocessingml') || mime.includes('officedocument')) {
    return true;
  }
  if (name.endsWith('.doc') || mime === 'application/msword') return true;
  return false;
}

function formatDateInIst(value: Date): string {
  // en-CA yields YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: IST_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function formatTimeInIst(value: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: IST_TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(value);
}

@Injectable()
export class RecruitmentService {
  constructor(
    private readonly rbac: RbacPermissionService,
    private readonly repo: RecruitmentRepository,
    private readonly ai: RecruitmentAiService,
    private readonly jobProfiles: JobProfilesService,
    private readonly jobRepo: JobProfilesRepository,
    private readonly resumeScreening: ResumeScreeningService,
    @InjectRepository(JobApplicationMysql)
    private readonly applications: Repository<JobApplicationMysql>,
    @InjectRepository(CandidateMysql)
    private readonly candidates: Repository<CandidateMysql>,
    private readonly emailService: EmailService,
    @Inject(forwardRef(() => CandidatePortalService))
    private readonly candidatePortal: CandidatePortalService,
  ) {}

  private async assertRead(actor: JwtUserPayload) {
    const ok = await this.rbac.hasPermission(actor, 'job_profiles:read');
    if (!ok) {
      const fallback = await this.rbac.hasPermission(actor, 'assessments:read');
      if (!fallback) throw new ForbiddenException();
    }
  }

  private async assertWrite(actor: JwtUserPayload) {
    const ok = await this.rbac.hasPermission(actor, 'job_profiles:write');
    if (!ok) {
      const fallback = await this.rbac.hasPermission(actor, 'assessments:write');
      if (!fallback) throw new ForbiddenException();
    }
  }

  private actorId(actor: JwtUserPayload) {
    return actor.sub;
  }

  private mapLeadListItem(
    lead: LocalLeadRow,
    overlay?: RecruitmentLeadOverlayMysql | null,
  ) {
    return {
      lead_id: lead.lead_id,
      id: lead.id,
      first_name: lead.firstname,
      last_name: lead.lastname,
      email: lead.email,
      phone: lead.phoneno ?? lead.whatsappnumber,
      lead_stage: lead.lead_stage,
      lead_sub_stage: lead.lead_sub_stage,
      portal_stage: overlay?.portalStage ?? null,
      effective_stage: overlay?.portalStage ?? lead.lead_stage,
      priority: lead.priority,
      acad_year: lead.acad_year,
      created_at: lead.created_at,
      counselor_id: lead.counselor_id,
      lead_source: lead.lead_source,
      lead_sub_source: lead.lead_sub_source,
      lead_score: lead.lead_score,
      ai_score: overlay?.aiScore != null ? Number(overlay.aiScore) : null,
      duplicate_strength: lead.duplicate_strength,
      duplicate_match_count: lead.duplicate_match_count,
      verified_lead: lead.verified_lead,
      courses: lead.lead_courses,
      resume_url: lead.resume_url,
      experience_years: lead.experience_years,
      current_company: lead.current_company,
      notice_period_days: lead.notice_period_days,
      invite_status: overlay?.inviteStatus ?? null,
      invite_token: overlay?.inviteToken ?? null,
      invite_slot_id: overlay?.inviteSlotId ?? null,
      invite_slot_label: overlay?.inviteSlotLabel ?? null,
      invite_slot_date: overlay?.inviteSlotDate
        ? String(overlay.inviteSlotDate).slice(0, 10)
        : null,
      ...this.resumeScreening.mapListFields(overlay),
    };
  }

  private portalBaseUrl() {
    return (process.env.APP_BASE_URL || 'http://localhost:5182').replace(/\/+$/, '');
  }

  private manualLeadRow(overlay: RecruitmentLeadOverlayMysql): LocalLeadRow | null {
    const raw = overlay.parsedResumeJson;
    if (!raw) return null;
    const isManual = raw.source === 'manual';
    const first = String(raw.first_name ?? raw.firstname ?? '').trim();
    const last = String(raw.last_name ?? raw.lastname ?? '').trim();
    const email = String(raw.email ?? '').trim();
    const jobTitle = String(raw.job_title ?? '').trim();
    const resumeUrl = String(raw.resume_url ?? '').trim() || null;
    if (!first || !email) return null;
    return {
      id: overlay.leadId,
      lead_id: overlay.leadId,
      firstname: first,
      middlename: null,
      lastname: last || null,
      email,
      phoneno: String(raw.phone ?? raw.phoneno ?? '').trim() || null,
      whatsappnumber: null,
      lead_type: isManual ? 'manual' : String(raw.lead_type ?? 'local'),
      lead_stage: overlay.portalStage ?? (isManual ? 'Scheduled' : 'New'),
      lead_sub_stage: null,
      priority: null,
      acad_year: null,
      created_at: overlay.createdAt?.toISOString?.() ?? null,
      counselor_id: overlay.counselorOverrideId,
      lead_source: isManual ? 'Manual' : String(raw.lead_source ?? 'Local'),
      lead_sub_source: null,
      lead_score: null,
      duplicate_strength: null,
      duplicate_match_count: null,
      verified_lead: 1,
      corr_country: null,
      corr_state: null,
      corr_city: null,
      gender: null,
      nationality: null,
      form_step_name: null,
      form_completed: 1,
      lead_courses: jobTitle ? [{ course_name: jobTitle, lead_id: overlay.leadId }] : [],
      document_uploads: resumeUrl
        ? [{ document_name: 'Resume', document_url: resumeUrl, lead_id: overlay.leadId }]
        : [],
      educational_details: Array.isArray(raw.education) ? (raw.education as unknown[]) : [],
      leads_answers:
        raw.inferred_from_answers && typeof raw.inferred_from_answers === 'object'
          ? (raw.inferred_from_answers as Record<string, string>)
          : null,
      resume_url: resumeUrl,
      experience_years:
        raw.experience_years != null && Number.isFinite(Number(raw.experience_years))
          ? Number(raw.experience_years)
          : null,
      current_company: String(raw.current_company ?? '').trim() || null,
      notice_period_days:
        raw.notice_period_days != null && Number.isFinite(Number(raw.notice_period_days))
          ? Number(raw.notice_period_days)
          : null,
      raw: raw,
    };
  }

  private async resolveLocalLead(leadId: string): Promise<{
    lead: LocalLeadRow;
    overlay: RecruitmentLeadOverlayMysql;
  } | null> {
    const overlay = await this.repo.findLeadOverlay(leadId);
    if (!overlay) return null;
    const lead = this.manualLeadRow(overlay);
    if (!lead) return null;
    return { lead, overlay };
  }

  private async uploadManualResume(
    leadId: string,
    resume?: UploadedResumeFile,
  ): Promise<string | undefined> {
    if (!resume?.buffer?.length) return undefined;
    if (resume.buffer.length > MAX_RESUME_BYTES) {
      throw new BadRequestException('Resume must be 8MB or smaller');
    }
    const original = resume.originalname ?? 'resume.pdf';
    const ext = (original.match(/\.[a-z0-9]+$/i)?.[0] ?? '.pdf').toLowerCase();
    return uploadBuffer({
      body: resume.buffer,
      contentType: resume.mimetype || 'application/octet-stream',
      key: underUploads('candidate-resumes', leadId, `${Date.now()}${ext}`),
    });
  }

  private async inferIdentityFromResume(
    resume?: UploadedResumeFile,
  ): Promise<{ name: string; email: string | null; extractedText: string | null }> {
    const nameFromFile = nameFromResumeFilename(resume?.originalname);
    let extractedText: string | null = null;
    let email: string | null = null;
    if (resume?.buffer?.length) {
      try {
        extractedText = await extractReportText({
          fieldname: 'resume',
          originalname: resume.originalname ?? 'resume.pdf',
          encoding: '7bit',
          mimetype: resume.mimetype || 'application/octet-stream',
          size: resume.buffer.length,
          buffer: resume.buffer,
          destination: '',
          filename: resume.originalname ?? 'resume.pdf',
          path: '',
          stream: undefined as never,
        });
        email = emailFromText(extractedText);
      } catch (err) {
        console.warn(
          `Bulk resume text extract failed for ${resume.originalname ?? 'file'}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return { name: nameFromFile, email, extractedText };
  }

  /**
   * Creates a manual lead overlay without inviting/emailing.
   * Used by bulk upload (PENDING) and as the base for createManualCandidate.
   */
  private async createManualLeadPending(input: {
    name: string;
    email: string;
    jobProfileId: string;
    jobTitle: string;
    resume?: UploadedResumeFile;
    inviteStatus?: string | null;
    portalStage?: string;
    actorId?: string;
    extractedText?: string | null;
    onboardingRequired?: boolean;
  }) {
    const leadId = `manual_${randomBytes(8).toString('hex')}`;
    const [firstName, ...rest] = input.name.trim().split(/\s+/);
    const lastName = rest.join(' ');
    const email = input.email.trim().toLowerCase();
    const resumeUrl = await this.uploadManualResume(leadId, input.resume);

    const overlay = await this.repo.mergeLeadOverlay(leadId, {
      inviteStatus: input.inviteStatus ?? 'PENDING',
      inviteToken: null,
      portalStage: input.portalStage ?? 'New',
      resumeExtractedText: input.extractedText?.trim() || null,
      parsedResumeJson: {
        source: 'manual',
        first_name: firstName,
        last_name: lastName,
        email,
        job_profile_id: input.jobProfileId,
        job_title: input.jobTitle,
        resume_url: resumeUrl,
        ...(input.onboardingRequired ? { onboarding_required: true } : {}),
      },
    });

    await this.resumeScreening.ensureManualLeadScreened(overlay).catch((err) => {
      console.error(`Manual lead resume screen enqueue failed for lead ${leadId}:`, err);
    });

    await this.repo.logActivity({
      leadId,
      eventType: 'manual_candidate_pending',
      eventSummary: `Manual candidate created for review (${email}) — ${input.jobTitle}`,
      eventJson: {
        jobTitle: input.jobTitle,
        profileId: input.jobProfileId,
        resume_url: resumeUrl ?? null,
      },
      actorId: input.actorId,
    });

    return { leadId, firstName, lastName, email, resumeUrl, overlay };
  }

  async createManualCandidate(
    actor: JwtUserPayload,
    body: {
      name?: string;
      email?: string;
      job_profile_id?: string;
      slot_id?: string;
      slot_date?: string;
    },
    resume?: UploadedResumeFile,
  ) {
    await this.assertWrite(actor);
    const name = String(body.name ?? '').trim();
    const email = String(body.email ?? '').trim().toLowerCase();
    const profileId = String(body.job_profile_id ?? '').trim();
    const slotId = String(body.slot_id ?? '').trim() || undefined;
    const slotDate = String(body.slot_date ?? '').trim() || undefined;
    if (!name || !email.includes('@')) {
      throw new BadRequestException('Name and a valid email are required');
    }
    if (!profileId) throw new BadRequestException('Select a job role');
    if (resume?.buffer?.length && resume.buffer.length > MAX_RESUME_BYTES) {
      throw new BadRequestException('Resume must be 8MB or smaller');
    }

    const profile = await this.jobRepo.findById(profileId);
    const jobTitle = profile?.title ?? 'Assessment';
    const created = await this.createManualLeadPending({
      name,
      email,
      jobProfileId: profileId,
      jobTitle,
      resume,
      inviteStatus: 'PENDING',
      portalStage: 'New',
      actorId: this.actorId(actor),
    });

    const invited = await this.inviteLeadToAssessment(actor, created.leadId, {
      jobProfileId: profileId,
      ...(slotId && slotDate ? { slot_id: slotId, slot_date: slotDate } : {}),
    });

    if (invited.status === 'INVITED' && !invited.email_sent) {
      throw new BadRequestException(
        'Candidate was created, but the magic link email was not sent. Check SMTP settings, then open this lead and send the invite again.',
      );
    }

    return {
      status: invited.status,
      invite_token: invited.invite_token,
      interview_url: invited.interview_url,
      email_sent: invited.email_sent ?? false,
      lead_id: created.leadId,
    };
  }

  async bulkCreateCandidates(
    actor: JwtUserPayload,
    body: { job_profile_id?: string },
    resumes: UploadedResumeFile[],
  ) {
    await this.assertWrite(actor);
    const profileId = String(body.job_profile_id ?? '').trim();
    if (!profileId) throw new BadRequestException('job_profile_id is required');
    if (!resumes?.length) throw new BadRequestException('Upload at least one resume');
    if (resumes.length > MAX_BULK_RESUMES) {
      throw new BadRequestException(`Maximum ${MAX_BULK_RESUMES} resumes per upload`);
    }

    const profile = await this.jobRepo.findById(profileId);
    if (!profile) throw new NotFoundException('Job profile not found');
    const jobTitle = profile.title ?? 'Assessment';

    const items: Array<{
      lead_id?: string;
      name?: string;
      resume_url?: string | null;
      error?: string;
    }> = [];
    let created = 0;
    let failed = 0;

    for (const file of resumes) {
      const original = file.originalname ?? 'resume';
      try {
        if (!file.buffer?.length) {
          throw new BadRequestException('Empty file');
        }
        if (file.buffer.length > MAX_RESUME_BYTES) {
          throw new BadRequestException('Resume must be 8MB or smaller');
        }
        if (!isAllowedResumeMime(file)) {
          throw new BadRequestException('Only PDF and DOCX resumes are supported');
        }

        const inferred = await this.inferIdentityFromResume(file);
        const name = inferred.name || nameFromResumeFilename(original);
        const email =
          inferred.email && inferred.email.includes('@')
            ? inferred.email
            : `noreply+pending_${randomBytes(4).toString('hex')}@localhost`;

        const createdLead = await this.createManualLeadPending({
          name,
          email,
          jobProfileId: profileId,
          jobTitle,
          resume: file,
          inviteStatus: 'PENDING',
          portalStage: 'New',
          actorId: this.actorId(actor),
          extractedText: inferred.extractedText,
        });

        if (!inferred.email) {
          const placeholder = `noreply+${createdLead.leadId}@localhost`;
          await this.repo.mergeLeadOverlay(createdLead.leadId, {
            parsedResumeJson: {
              ...(createdLead.overlay.parsedResumeJson as Record<string, unknown>),
              email: placeholder,
            },
          });
        }

        created += 1;
        items.push({
          lead_id: createdLead.leadId,
          name,
          resume_url: createdLead.resumeUrl ?? null,
        });
      } catch (err) {
        failed += 1;
        items.push({
          name: nameFromResumeFilename(original),
          error: err instanceof Error ? err.message : 'Failed to create candidate',
        });
      }
    }

    return { created, failed, items };
  }

  async batchInviteLeads(
    actor: JwtUserPayload,
    body: {
      lead_ids?: string[];
      job_profile_id?: string;
      min_score?: number;
    },
  ) {
    await this.assertWrite(actor);
    const leadIds = Array.isArray(body.lead_ids)
      ? body.lead_ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    const profileId = String(body.job_profile_id ?? '').trim() || undefined;
    const minScore =
      body.min_score != null && Number.isFinite(Number(body.min_score))
        ? Number(body.min_score)
        : undefined;

    let targets: string[] = leadIds;

    if (minScore != null && leadIds.length === 0) {
      const overlays = await this.repo.findInboxLeadOverlays();
      targets = overlays
        .filter((o) => {
          if (o.inviteStatus === 'INVITED') return false;
          const score =
            o.resumeMatchScore != null && Number.isFinite(Number(o.resumeMatchScore))
              ? Number(o.resumeMatchScore)
              : null;
          if (score == null || score < minScore) return false;
          if (profileId) {
            const parsed = o.parsedResumeJson as Record<string, unknown> | null;
            const overlayProfile = String(parsed?.job_profile_id ?? '').trim();
            const screenedProfile = String(o.resumeMatchJobProfileId ?? '').trim();
            const matchesProfile =
              overlayProfile === profileId || screenedProfile === profileId;
            if (!matchesProfile) return false;
          }
          return true;
        })
        .map((o) => o.leadId);
    }

    if (!targets.length) {
      throw new BadRequestException(
        minScore != null
          ? 'No leads matched the score filter'
          : 'Provide lead_ids or min_score',
      );
    }

    const results: Array<{
      lead_id: string;
      status: string;
      skipped?: boolean;
      error?: string;
      invite_token?: string;
      interview_url?: string;
    }> = [];
    let invited = 0;
    let skipped = 0;

    for (const leadId of targets) {
      try {
        const result = await this.inviteLeadToAssessment(actor, leadId, {
          jobProfileId: profileId,
        });
        if (result.status === 'ALREADY_INVITED') {
          skipped += 1;
          results.push({
            lead_id: leadId,
            status: result.status,
            skipped: true,
            invite_token: result.invite_token,
            interview_url: result.interview_url,
          });
        } else if (result.status === 'INVITED') {
          invited += 1;
          results.push({
            lead_id: leadId,
            status: result.status,
            invite_token: result.invite_token,
            interview_url: result.interview_url,
          });
        } else {
          skipped += 1;
          results.push({
            lead_id: leadId,
            status: result.status,
            skipped: true,
          });
        }
      } catch (err) {
        skipped += 1;
        results.push({
          lead_id: leadId,
          status: 'ERROR',
          skipped: true,
          error: err instanceof Error ? err.message : 'Invite failed',
        });
      }
    }

    return { invited, skipped, results };
  }

  private matchesLeadFilters(
    lead: LocalLeadRow,
    query: {
      global_filter?: string;
      course_name?: string;
      lead_stage?: string;
      date_from?: string;
      date_to?: string;
    },
  ): boolean {
    const stageFilter = (query.lead_stage ?? '').trim();
    if (stageFilter) {
      const effective = lead.lead_stage ?? '';
      if (effective !== stageFilter) return false;
    }
    if (
      query.course_name &&
      !lead.lead_courses.some((c) => c.course_name === query.course_name)
    ) {
      return false;
    }
    if (query.date_from && lead.created_at) {
      const from = new Date(query.date_from).getTime();
      if (!Number.isNaN(from) && new Date(lead.created_at).getTime() < from) return false;
    }
    if (query.date_to && lead.created_at) {
      const toDate = new Date(query.date_to);
      if (!Number.isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        if (new Date(lead.created_at).getTime() > toDate.getTime()) return false;
      }
    }
    const search = (query.global_filter ?? '').trim().toLowerCase();
    if (!search) return true;
    const hay = `${lead.firstname} ${lead.lastname ?? ''} ${lead.email}`.toLowerCase();
    return hay.includes(search);
  }

  async listLeads(
    actor: JwtUserPayload,
    query: {
      page?: number;
      pageSize?: number;
      acad_year?: string;
      global_filter?: string;
      course_name?: string;
      lead_stage?: string;
      priority?: string;
      counselor_id?: string;
      date_from?: string;
      date_to?: string;
    },
  ) {
    await this.assertRead(actor);

    const overlays = await this.repo.findInboxLeadOverlays();
    const overlayByLead = new Map(overlays.map((o) => [o.leadId, o]));
    const allLeads = overlays
      .map((overlay) => this.manualLeadRow(overlay))
      .filter((lead): lead is LocalLeadRow => Boolean(lead))
      .filter((lead) => this.matchesLeadFilters(lead, query));

    const pageNumber = Math.max(1, Number(query.page ?? 1) || 1);
    const pageSize = Math.max(1, Math.min(100, Number(query.pageSize ?? 25) || 25));
    const total = allLeads.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
    const start = (pageNumber - 1) * pageSize;
    const pageItems = allLeads.slice(start, start + pageSize);

    await Promise.all(
      pageItems.map(async (l) => {
        const existing = overlayByLead.get(l.lead_id);
        if (!existing || !l.lead_id.startsWith('manual_')) return;
        overlayByLead.set(
          l.lead_id,
          await this.resumeScreening.ensureManualLeadScreened(existing),
        );
      }),
    );

    return {
      items: pageItems.map((l) =>
        this.mapLeadListItem(l, overlayByLead.get(l.lead_id)),
      ),
      page: pageNumber,
      page_size: pageSize,
      total,
      total_pages: totalPages,
      has_next_page: pageNumber < totalPages,
      has_previous_page: pageNumber > 1,
      stats: {
        total_active: total,
        high_score: allLeads.filter(
          (l) =>
            (l.lead_score ?? 0) >= 90 ||
            Number(overlayByLead.get(l.lead_id)?.aiScore ?? 0) >= 90,
        ).length,
        verified: allLeads.filter((l) => l.verified_lead === 1).length,
        duplicates: allLeads.filter((l) => (l.duplicate_match_count ?? 0) > 0).length,
      },
    };
  }

  async getLeadInboxStageCounts(
    actor: JwtUserPayload,
    query: {
      acad_year?: string;
      global_filter?: string;
      course_name?: string;
      priority?: string;
      counselor_id?: string;
      date_from?: string;
      date_to?: string;
    },
  ) {
    await this.assertRead(actor);
    const overlays = await this.repo.findInboxLeadOverlays();
    const stage_counts: Record<string, number> = {};
    for (const stage of INBOX_PIPELINE_STAGES) {
      stage_counts[stage] = 0;
    }
    for (const overlay of overlays) {
      const lead = this.manualLeadRow(overlay);
      if (!lead) continue;
      if (!this.matchesLeadFilters(lead, query)) continue;
      const stage =
        overlay.portalStage ?? lead.lead_stage ?? 'New';
      stage_counts[stage] = (stage_counts[stage] ?? 0) + 1;
    }
    return { stage_counts };
  }

  async getLead(actor: JwtUserPayload, leadId: string) {
    await this.assertRead(actor);
    const resolved = await this.resolveLocalLead(leadId);
    if (!resolved) throw new NotFoundException('Lead not found');
    const { lead } = resolved;

    const claimed = leadId.startsWith('manual_')
      ? await this.resumeScreening.ensureManualLeadScreened(resolved.overlay)
      : null;

    const overlay =
      claimed ?? resolved.overlay ?? (await this.repo.findLeadOverlay(lead.lead_id));
    const localInterviews = await this.repo.findLocalInterviewsForLead(lead.lead_id);
    const links = await this.repo.findLinksForLead(lead.lead_id);
    const activities = await this.repo.listActivitiesForLead(lead.lead_id);
    const communications = await this.repo.listCommunicationsForLead(lead.lead_id);

    const localApps = await this.applications.find({
      where: { source: `lead:${lead.lead_id}`, inactive: 0 },
    });

    return {
      lead: {
        ...this.mapLeadListItem(lead, overlay ?? undefined),
        middlename: lead.middlename,
        whatsappnumber: lead.whatsappnumber,
        gender: lead.gender,
        nationality: lead.nationality,
        corr_country: lead.corr_country,
        corr_state: lead.corr_state,
        corr_city: lead.corr_city,
        form_step_name: lead.form_step_name,
        form_completed: lead.form_completed,
        document_uploads: lead.document_uploads,
        educational_details: lead.educational_details,
        leads_answers: lead.leads_answers,
        raw_fields: lead.raw,
      },
      overlay: overlay
        ? {
            portal_stage: overlay.portalStage,
            counselor_override_id: overlay.counselorOverrideId,
            notes: overlay.notes,
            ai_score: overlay.aiScore != null ? Number(overlay.aiScore) : null,
            ai_qualification: overlay.aiQualificationJson,
            parsed_resume: overlay.parsedResumeJson,
            resume_mismatch: overlay.resumeMismatchFlag === 1,
            last_local_action_at: overlay.lastLocalActionAt,
            invite_status: overlay.inviteStatus,
            invite_token: overlay.inviteToken,
            resume_match: overlay.resumeMatchJson ?? null,
            ...this.resumeScreening.mapListFields(overlay),
          }
        : null,
      interviews: [] as unknown[],
      interviews_local: localInterviews.map((i) => this.mapLocalInterview(i)),
      autonomous_sessions: localApps.map((a) => ({
        application_id: a.id,
        candidate_token: a.candidateToken,
        status: a.status,
        interview_url: a.candidateToken
          ? `/autonomous-interview/${a.candidateToken}`
          : null,
      })),
      links,
      timeline: activities,
      communications,
      ai_brief: this.ai.buildLeadBrief(lead),
    };
  }

  private mapLocalInterview(i: RecruitmentInterviewOverlayMysql) {
    return {
      id: i.id,
      overlay_id: i.id,
      interview_ref_id: i.interviewRefId,
      lead_id: i.leadId,
      candidate_name: '',
      email: null as string | null,
      phone: null as string | null,
      course_name: null as string | null,
      interview_type: i.interviewType,
      interview_mode: i.interviewMode,
      interview_status: i.portalStatus ?? 'Scheduled',
      portal_status: i.portalStatus,
      effective_status: i.portalStatus ?? 'Scheduled',
      appointment_date: i.scheduledDate,
      appointment_time: i.scheduledTime,
      meeting_url: i.meetingUrl,
      remarks_desc: i.remarksDesc,
      interview_result: i.result,
      interview_remark: i.remark,
      created_by_name: null as string | null,
    };
  }

  async updateLeadOverlay(
    actor: JwtUserPayload,
    leadId: string,
    body: {
      portal_stage?: string;
      counselor_override_id?: string;
      notes?: string;
    },
  ) {
    await this.assertWrite(actor);
    const overlay = await this.repo.mergeLeadOverlay(leadId, {
      portalStage: body.portal_stage,
      counselorOverrideId: body.counselor_override_id,
      notes: body.notes,
    });
    await this.repo.logActivity({
      leadId: leadId,
      eventType: 'lead_overlay_updated',
      eventSummary: `Lead overlay updated`,
      eventJson: body as Record<string, unknown>,
      actorId: this.actorId(actor),
    });
    return overlay;
  }

  async scheduleLocalInterview(
    actor: JwtUserPayload,
    leadId: string,
    body: {
      appointment_date: string;
      appointment_time: string;
      interview_type: string;
      interview_mode: string;
      remarks_desc?: string;
      meeting_url?: string;
    },
  ) {
    await this.assertWrite(actor);
    if (!body.appointment_date || !body.appointment_time) {
      throw new BadRequestException('Date and time are required');
    }

    const interview = await this.repo.interviewOverlays.save(
      this.repo.interviewOverlays.create({
        leadId: leadId,
        portalStatus: 'Scheduled',
        scheduledDate: body.appointment_date,
        scheduledTime: body.appointment_time,
        interviewType: body.interview_type,
        interviewMode: body.interview_mode,
        remarksDesc: body.remarks_desc ?? null,
        meetingUrl: body.meeting_url ?? null,
        inactive: 0,
      }),
    );

    await this.repo.mergeLeadOverlay(leadId, { portalStage: 'Scheduled' });
    await this.repo.links.save(
      this.repo.links.create({
        leadId: leadId,
        localInterviewOverlayId: interview.id,
        inactive: 0,
      }),
    );
    await this.repo.recordStatusChange({
      interviewOverlayId: interview.id,
      fromStatus: null,
      toStatus: 'Scheduled',
      changedBy: this.actorId(actor),
    });
    await this.repo.logActivity({
      leadId: leadId,
      interviewRefId: interview.id,
      eventType: 'interview_scheduled_local',
      eventSummary: `Interview scheduled locally for ${body.appointment_date} ${body.appointment_time}`,
      actorId: this.actorId(actor),
    });

    return this.mapLocalInterview(interview);
  }

  async startAiInterview(
    actor: JwtUserPayload,
    leadId: string,
    body?: { job_profile_id?: string },
  ) {
    await this.assertWrite(actor);
    const resolved = await this.resolveLocalLead(leadId);
    if (!resolved) throw new NotFoundException('Lead not found');
    const { lead, overlay } = resolved;

    let profileId = body?.job_profile_id;
    if (!profileId) {
      const course = lead.lead_courses[0]?.course_name;
      if (course) {
        const [rows] = await this.jobRepo.listProfiles({ search: course, limit: 5 });
        const match = rows.find(
          (p) => p.title.toLowerCase() === course.toLowerCase(),
        ) ?? rows[0];
        profileId = match?.id;
      }
    }
    if (!profileId) {
      throw new BadRequestException(
        'No matching job profile — pass job_profile_id or link a profile to the course',
      );
    }

    const parsed = overlay.parsedResumeJson as Record<string, unknown> | null;

    const result = await this.jobProfiles.inviteLeadToInterview(actor, profileId, {
      lead_id: lead.lead_id,
      first_name: lead.firstname,
      last_name: lead.lastname ?? undefined,
      email: lead.email,
      phone: lead.phoneno ?? lead.whatsappnumber ?? undefined,
      resume_url: lead.resume_url ?? undefined,
      experience_years: lead.experience_years ?? undefined,
      skills: lead.lead_courses
        .map((c) => c.course_name)
        .filter((n): n is string => Boolean(n)),
      projects_summary: parsed?.projects_summary as string | undefined,
      experience_summary: parsed?.experience_summary as string | undefined,
      education_summary: parsed?.education_summary as string | undefined,
    });

    await this.repo.links.save(
      this.repo.links.create({
        leadId: lead.lead_id,
        localApplicationToken: result.application_token,
        inactive: 0,
      }),
    );
    await this.repo.logActivity({
      leadId: lead.lead_id,
      eventType: 'ai_interview_started',
      eventSummary: 'Autonomous interview session created',
      eventJson: result as unknown as Record<string, unknown>,
      actorId: this.actorId(actor),
    });

    return result;
  }

  async listInterviews(
    actor: JwtUserPayload,
    query: {
      status?: string;
      interview_type?: string;
      interview_mode?: string;
      course_name?: string;
      counselor_id?: string;
      date_from?: string;
      date_to?: string;
      lead_id?: string;
    },
  ) {
    await this.assertRead(actor);

    const where: Record<string, unknown> = { inactive: 0 };
    if (query.lead_id?.trim()) where.leadId = query.lead_id.trim();

    let local = await this.repo.interviewOverlays.find({
      where,
      order: { createdAt: 'DESC' },
      take: 200,
    });

    if (query.interview_type?.trim()) {
      local = local.filter((l) => l.interviewType === query.interview_type);
    }
    if (query.interview_mode?.trim()) {
      local = local.filter((l) => l.interviewMode === query.interview_mode);
    }
    if (query.date_from?.trim()) {
      local = local.filter(
        (l) => (l.scheduledDate ?? '') >= query.date_from!.trim(),
      );
    }
    if (query.date_to?.trim()) {
      local = local.filter(
        (l) => (l.scheduledDate ?? '') <= query.date_to!.trim(),
      );
    }
    if (query.status?.trim() && query.status !== '1') {
      local = local.filter(
        (l) => (l.portalStatus ?? '').toLowerCase() === query.status!.trim().toLowerCase(),
      );
    }

    const merged = local.map((l) => this.mapLocalInterview(l));

    const statusCounts: Record<string, number> = {};
    for (const row of merged) {
      const s = row.effective_status ?? 'Unknown';
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }

    return {
      items: merged,
      total: merged.length,
      stats: { status_counts: statusCounts },
    };
  }

  private placeholderCandidateName(name: string | null | undefined) {
    const normalized = String(name ?? '').trim().toLowerCase();
    return !normalized || normalized === 'candidate' || normalized === 'demo candidate';
  }

  private async applyActualCandidateNames(
    rows: Array<{
      invite_token?: string | null;
      lead_id?: string | null;
      candidate_name: string;
      email: string | null;
      course_name: string | null;
    }>,
  ) {
    const tokens = [
      ...new Set(rows.map((row) => String(row.invite_token ?? '').trim()).filter(Boolean)),
    ];
    const byToken = new Map<
      string,
      { name: string; email: string | null; courseName: string | null }
    >();
    if (tokens.length) {
      const placeholders = tokens.map(() => '?').join(',');
      const found = await this.applications.manager.query(
        `SELECT a.candidate_token AS token,
                TRIM(CONCAT(c.first_name, ' ', IFNULL(c.last_name, ''))) AS candidate_name,
                c.email AS email,
                p.title AS job_title
         FROM job_applications a
         INNER JOIN candidates c ON c.id = a.candidate_id AND c.inactive = 0
         LEFT JOIN job_profiles p ON p.id = a.job_profile_id
         WHERE a.inactive = 0 AND a.candidate_token IN (${placeholders})`,
        tokens,
      );
      for (const row of found as Array<{
        token: string;
        candidate_name: string | null;
        email: string | null;
        job_title: string | null;
      }>) {
        const name = String(row.candidate_name ?? '').trim();
        if (!name || this.placeholderCandidateName(name)) continue;
        byToken.set(String(row.token), {
          name,
          email: row.email ?? null,
          courseName: row.job_title ?? null,
        });
      }
    }

    for (const row of rows) {
      const token = String(row.invite_token ?? '').trim();
      const identity = token ? byToken.get(token) : undefined;
      if (!identity) continue;
      row.candidate_name = identity.name;
      if (!row.email && identity.email) row.email = identity.email;
      if (!row.course_name && identity.courseName) row.course_name = identity.courseName;
    }
  }

  async getTodayInterviews(actor: JwtUserPayload) {
    await this.assertRead(actor);
    const today = this.todayDateString();
    const baseUrl = (process.env.APP_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');

    const localOverlays = await this.repo.interviewOverlays.find({
      where: { inactive: 0 },
      order: { createdAt: 'DESC' },
      take: 200,
    });
    const mappedLocal = await Promise.all(
      localOverlays
        .filter((o) => (o.scheduledDate ?? '').slice(0, 10) === today)
        .map(async (o) => {
          const mapped = this.mapLocalInterview(o);
          const leadOverlay = o.leadId
            ? await this.repo.findLeadOverlay(o.leadId)
            : null;
          const lead = leadOverlay ? this.manualLeadRow(leadOverlay) : null;
          const joinUrl =
            mapped.meeting_url ||
            (leadOverlay?.inviteToken
              ? `${baseUrl}/candidate/portal/${leadOverlay.inviteToken}`
              : null);
          return {
            ...mapped,
            candidate_name: lead
              ? [lead.firstname, lead.lastname].filter(Boolean).join(' ')
              : mapped.candidate_name,
            email: lead?.email ?? mapped.email,
            phone: lead?.phoneno ?? mapped.phone,
            course_name: lead?.lead_courses[0]?.course_name ?? mapped.course_name,
            invite_token: leadOverlay?.inviteToken ?? null,
            join_url: joinUrl,
            source: 'local' as const,
          };
        }),
    );

    type TodayInterviewRow = (typeof mappedLocal)[number] | {
      id: string;
      application_id?: string | null;
      overlay_id: string | null;
      interview_ref_id: null;
      lead_id: string;
      candidate_name: string;
      email: string | null;
      phone: string | null;
      course_name: string | null;
      interview_type: string;
      interview_mode: string;
      interview_status: string;
      portal_status: string;
      effective_status: string;
      appointment_date: string;
      appointment_time: string | null;
      meeting_url: string | null;
      remarks_desc: null;
      interview_result: null;
      interview_remark: null;
      invite_token: string | null;
      join_url: string | null;
      source: 'demo';
    };

    // Include all active or recently updated applications for *today* (IST).
    // Buffer 48h to safely capture timezone overlaps and active sessions.
    const sinceUtc = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const demoAppsRaw = await this.applications
      .createQueryBuilder('a')
      .leftJoinAndSelect('a.profile', 'profile')
      .where('a.inactive = 0')
      .andWhere('a.status IN (:...statuses)', {
        statuses: [
          JobApplicationStatus.APPLIED,
          JobApplicationStatus.IN_PROGRESS,
          JobApplicationStatus.COMPLETED,
          JobApplicationStatus.HIRED,
        ],
      })
      .andWhere(
        '(a.applied_at >= :since OR a.updated_at >= :since OR a.status = :inProgress)',
        { since: sinceUtc, inProgress: JobApplicationStatus.IN_PROGRESS },
      )
      .getMany();

    const demoApps = demoAppsRaw
      .filter((a) => {
        const appliedDay = a.appliedAt ? formatDateInIst(a.appliedAt) : null;
        const updatedDay = a.updatedAt ? formatDateInIst(a.updatedAt) : null;
        return (
          appliedDay === today ||
          updatedDay === today ||
          a.status === JobApplicationStatus.IN_PROGRESS
        );
      })
      .sort((a, b) => {
        const at = a.updatedAt?.getTime?.() ?? a.appliedAt?.getTime?.() ?? 0;
        const bt = b.updatedAt?.getTime?.() ?? b.appliedAt?.getTime?.() ?? 0;
        return bt - at;
      })
      .slice(0, 50);

    const demoCandidateIds = [
      ...new Set(demoApps.map((a) => String(a.candidateId ?? '')).filter(Boolean)),
    ];
    const demoCandidates = demoCandidateIds.length
      ? await this.candidates
          .createQueryBuilder('c')
          .where('CAST(c.id AS CHAR) IN (:...ids)', { ids: demoCandidateIds })
          .getMany()
      : [];
    const candidateById = new Map(demoCandidates.map((c) => [String(c.id), c]));

    // Fallback names from demo interview seeds (survives candidate-row lookup issues).
    const demoTokens = demoApps
      .map((a) => a.candidateToken?.trim())
      .filter((t): t is string => Boolean(t));
    const seedNameByToken = new Map<string, string>();
    if (demoTokens.length) {
      const placeholders = demoTokens.map(() => '?').join(',');
      const seeds = await this.applications.manager.query(
        `SELECT candidate_token AS token,
                JSON_UNQUOTE(JSON_EXTRACT(proctor_summary, '$.candidateName')) AS candidate_name
         FROM candidate_autonomous_interviews
         WHERE candidate_token IN (${placeholders})`,
        demoTokens,
      );
      for (const row of seeds as Array<{ token: string; candidate_name: string | null }>) {
        const name = String(row.candidate_name ?? '').trim();
        if (name && name !== 'null') seedNameByToken.set(String(row.token), name);
      }
    }

    const existingTokens = new Set(
      mappedLocal
        .map((r) => String(r.invite_token ?? ''))
        .filter(Boolean),
    );

    type PipelineRound = {
      id: string;
      name: string;
      type: string;
      status: 'completed' | 'live' | 'not_started' | 'upcoming';
    };
    type EnrichedTodayRow = TodayInterviewRow & {
      pipeline_rounds?: PipelineRound[];
      rounds_completed?: number;
      rounds_total?: number;
      sort_at?: string;
    };

    const demoRows: EnrichedTodayRow[] = [];
    for (const app of demoApps) {
      const token = app.candidateToken?.trim();
      if (!token || existingTokens.has(token)) continue;
      const appliedDay = app.appliedAt
        ? formatDateInIst(app.appliedAt)
        : today;
      const cand = candidateById.get(String(app.candidateId));
      const fromCand = cand
        ? [cand.firstName, cand.lastName].filter(Boolean).join(' ').trim()
        : '';
      const candidateName =
        fromCand ||
        seedNameByToken.get(token) ||
        cand?.email?.split('@')[0] ||
        'Candidate';
      const joinUrl = `${baseUrl}/candidate/portal/${token}`;
      const appliedTime = app.appliedAt ? formatTimeInIst(app.appliedAt) : null;
      const sortAt = (app.updatedAt ?? app.appliedAt)?.toISOString?.() ?? `${appliedDay}T${appliedTime ?? '00:00'}`;
      const isCompleted = app.status === JobApplicationStatus.COMPLETED || app.status === JobApplicationStatus.HIRED;
      demoRows.push({
        id: `app-${app.id}`,
        application_id: String(app.id),
        overlay_id: null,
        interview_ref_id: null,
        lead_id: `app:${app.id}`,
        candidate_name: candidateName,
        email: cand?.email ?? null,
        phone: cand?.phone ?? null,
        course_name: app.profile?.title ?? 'Technical Assessment',
        interview_type: app.profile?.title ? 'Assessment' : 'Demo',
        interview_mode: 'Portal',
        interview_status: isCompleted ? 'Completed' : 'Scheduled',
        portal_status: app.status,
        effective_status: isCompleted ? 'Completed' : 'Scheduled',
        appointment_date: appliedDay,
        appointment_time: appliedTime,
        meeting_url: joinUrl,
        remarks_desc: null,
        interview_result: null,
        interview_remark: null,
        invite_token: token,
        join_url: joinUrl,
        source: 'demo' as const,
        sort_at: sortAt,
      });
      existingTokens.add(token);
    }

    const merged: EnrichedTodayRow[] = [
      ...mappedLocal.map((r) => ({
        ...r,
        sort_at: `${r.appointment_date ?? today}T${r.appointment_time ?? '00:00'}`,
      })),
      ...demoRows,
    ].filter((r) => {
      const day = String(r.appointment_date ?? '').slice(0, 10);
      return !day || day === today;
    });

    await this.applyActualCandidateNames(merged);

    // Attach real job-profile round progress for portal tokens (demo + magic-link).
    const progressByToken = new Map<
      string,
      { rounds: PipelineRound[]; completed_count: number; total_count: number }
    >();
    const tokensToResolve = [
      ...new Set(
        merged
          .map((r) => String(r.invite_token ?? '').trim())
          .filter(Boolean),
      ),
    ];
    await Promise.all(
      tokensToResolve.map(async (token) => {
        const progress = await this.candidatePortal.getRoundProgressForToken(token);
        if (progress) progressByToken.set(token, progress);
      }),
    );

    for (const row of merged) {
      const token = String(row.invite_token ?? '').trim();
      const progress = token ? progressByToken.get(token) : undefined;
      if (!progress) continue;
      row.pipeline_rounds = progress.rounds;
      row.rounds_completed = progress.completed_count;
      row.rounds_total = progress.total_count;
      // Drive Overall Status from pipeline, not the single Scheduled shell row.
      if (progress.total_count > 0) {
        if (progress.completed_count >= progress.total_count) {
          row.effective_status = 'Completed';
        } else if (progress.rounds.some((r) => r.status === 'live')) {
          row.effective_status = 'In Progress';
        } else {
          row.effective_status = 'Scheduled';
        }
      }
    }

    // Newest first (most recently added / updated at the top).
    merged.sort((a, b) => String(b.sort_at ?? '').localeCompare(String(a.sort_at ?? '')));

    return { items: merged };
  }

  async getInterview(actor: JwtUserPayload, id: string) {
    await this.assertRead(actor);

    let overlay =
      (await this.repo.findInterviewOverlayById(id)) ??
      (await this.repo.findInterviewOverlayByRefId(id));
    if (!overlay) throw new NotFoundException('Interview not found');

    const leadId = overlay.leadId;
    const resolved = leadId ? await this.resolveLocalLead(leadId) : null;
    const lead = resolved?.lead ?? null;
    const history = await this.repo.listStatusHistory(overlay.id);
    const allRounds = leadId
      ? await this.repo.findLocalInterviewsForLead(leadId)
      : [];

    return {
      interview: this.mapLocalInterview(overlay),
      lead: lead ? this.mapLeadListItem(lead, resolved?.overlay) : null,
      lead_detail: lead,
      status_history: history,
      all_rounds: allRounds.map((r) => this.mapLocalInterview(r)),
      checklist: {
        consent_acknowledged: overlay.consentAcknowledged === 1,
        remarks_sent: overlay.remarksSent === 1,
        reminder_24h_sent: overlay.reminder24hSent === 1,
        reminder_1h_sent: overlay.reminder1hSent === 1,
        reminder_15m_sent: overlay.reminder15mSent === 1,
        candidate_confirmed: overlay.candidateConfirmed === 1,
      },
      ai_brief: lead ? this.ai.buildLeadBrief(lead) : null,
    };
  }

  async updateInterviewStatus(
    actor: JwtUserPayload,
    id: string,
    body: {
      portal_status: string;
      reason?: string;
      result?: string;
      remark?: string;
      no_show_reason?: string;
      reschedule_reason?: string;
      cancel_reason?: string;
    },
  ) {
    await this.assertWrite(actor);
    let overlay =
      (await this.repo.findInterviewOverlayByRefId(id)) ??
      (await this.repo.findInterviewOverlayById(id));
    if (!overlay) throw new NotFoundException('Interview overlay not found');

    const from = overlay.portalStatus;
    overlay.portalStatus = body.portal_status;
    if (body.result !== undefined) overlay.result = body.result;
    if (body.remark !== undefined) overlay.remark = body.remark;
    if (body.no_show_reason) overlay.noShowReason = body.no_show_reason;
    if (body.reschedule_reason) overlay.rescheduleReason = body.reschedule_reason;
    if (body.cancel_reason) overlay.cancelReason = body.cancel_reason;
    overlay.enteredBy = this.actorId(actor);
    overlay.enteredAt = new Date();
    await this.repo.interviewOverlays.save(overlay);

    await this.repo.recordStatusChange({
      interviewOverlayId: overlay.id,
      fromStatus: from,
      toStatus: body.portal_status,
      reason: body.reason,
      changedBy: this.actorId(actor),
    });

    if (body.portal_status === 'Completed' || body.portal_status === 'Interviewed') {
      await this.repo.mergeLeadOverlay(overlay.leadId, {
        portalStage: 'Interviewed',
      });
    }

    return this.getInterview(actor, overlay.id);
  }

  async updateInterviewChecklist(
    actor: JwtUserPayload,
    id: string,
    body: Partial<{
      consent_acknowledged: boolean;
      remarks_sent: boolean;
      reminder_24h_sent: boolean;
      reminder_1h_sent: boolean;
      reminder_15m_sent: boolean;
      candidate_confirmed: boolean;
    }>,
  ) {
    await this.assertWrite(actor);
    let overlay =
      (await this.repo.findInterviewOverlayByRefId(id)) ??
      (await this.repo.findInterviewOverlayById(id));
    if (!overlay) throw new NotFoundException('Interview not found');

    if (body.consent_acknowledged !== undefined) {
      overlay.consentAcknowledged = body.consent_acknowledged ? 1 : 0;
    }
    if (body.remarks_sent !== undefined) overlay.remarksSent = body.remarks_sent ? 1 : 0;
    if (body.reminder_24h_sent !== undefined) {
      overlay.reminder24hSent = body.reminder_24h_sent ? 1 : 0;
    }
    if (body.reminder_1h_sent !== undefined) {
      overlay.reminder1hSent = body.reminder_1h_sent ? 1 : 0;
    }
    if (body.reminder_15m_sent !== undefined) {
      overlay.reminder15mSent = body.reminder_15m_sent ? 1 : 0;
    }
    if (body.candidate_confirmed !== undefined) {
      overlay.candidateConfirmed = body.candidate_confirmed ? 1 : 0;
    }
    await this.repo.interviewOverlays.save(overlay);
    return { checklist: body };
  }

  async sendReminder(
    actor: JwtUserPayload,
    leadId: string,
    body: { channel: string; message: string; subject?: string },
  ) {
    await this.assertWrite(actor);
    const log = await this.repo.communications.save(
      this.repo.communications.create({
        leadId: leadId,
        channel: body.channel,
        direction: 'outbound',
        subject: body.subject ?? null,
        body: body.message,
        sentBy: this.actorId(actor),
        inactive: 0,
      }),
    );
    await this.repo.logActivity({
      leadId: leadId,
      eventType: 'reminder_sent',
      eventSummary: `${body.channel} reminder logged (manual)`,
      actorId: this.actorId(actor),
    });
    return log;
  }

  async scoreLeadAi(actor: JwtUserPayload, leadId: string, courseName?: string) {
    await this.assertRead(actor);
    const resolved = await this.resolveLocalLead(leadId);
    if (!resolved) throw new NotFoundException('Lead not found');
    return this.ai.scoreLead(resolved.lead, courseName);
  }

  async qualifyLeadAi(actor: JwtUserPayload, leadId: string, courseName?: string) {
    await this.assertRead(actor);
    const resolved = await this.resolveLocalLead(leadId);
    if (!resolved) throw new NotFoundException('Lead not found');
    return this.ai.qualifyLead(resolved.lead, courseName);
  }

  async parseResume(actor: JwtUserPayload, leadId: string) {
    await this.assertWrite(actor);
    const resolved = await this.resolveLocalLead(leadId);
    if (!resolved) throw new NotFoundException('Lead not found');
    return this.ai.parseResume(resolved.lead);
  }

  async getResumeScreen(actor: JwtUserPayload, leadId: string) {
    await this.assertRead(actor);
    return this.resumeScreening.getResumeScreen(leadId);
  }

  async rerunResumeScreen(actor: JwtUserPayload, leadId: string) {
    await this.assertWrite(actor);
    return this.resumeScreening.requestManualRerun(leadId);
  }

  async draftInterviewResultAi(
    actor: JwtUserPayload,
    interviewId: string,
    body?: { summary?: string },
  ) {
    await this.assertWrite(actor);
    const detail = await this.getInterview(actor, interviewId);
    const lead = detail.lead_detail as LocalLeadRow | null;
    if (!lead) throw new BadRequestException('Lead data unavailable');

    const draft = await this.ai.draftInterviewResult(
      lead,
      body?.summary ?? '',
    );

    let overlay =
      (await this.repo.findInterviewOverlayByRefId(interviewId)) ??
      (await this.repo.findInterviewOverlayById(interviewId));
    if (overlay) {
      overlay.aiDraftResultJson = draft as unknown as Record<string, unknown>;
      overlay.aiRecommendation = draft.recommendation;
      await this.repo.interviewOverlays.save(overlay);
    }

    return draft;
  }

  async inviteLeadToAssessment(
    actor: JwtUserPayload,
    leadId: string,
    opts?: { jobProfileId?: string; slot_id?: string; slot_date?: string },
  ) {
    await this.assertWrite(actor);
    const resolved = await this.resolveLocalLead(leadId);
    if (!resolved) throw new NotFoundException('Lead not found');
    const { lead } = resolved;

    const existingOverlay = await this.repo.findLeadOverlay(lead.lead_id);
    if (existingOverlay?.inviteStatus === 'INVITED' && existingOverlay.inviteToken) {
      const baseUrl = this.portalBaseUrl();
      return {
        status: 'ALREADY_INVITED' as const,
        invite_token: existingOverlay.inviteToken,
        interview_url: `${baseUrl}/candidate/portal/${existingOverlay.inviteToken}`,
        slot_label: existingOverlay.inviteSlotLabel ?? null,
        slot_date: existingOverlay.inviteSlotDate
          ? String(existingOverlay.inviteSlotDate).slice(0, 10)
          : null,
      };
    }

    const slotId = String(opts?.slot_id ?? '').trim();
    const appointmentDate = String(opts?.slot_date ?? '').trim();
    let bookableSlot: RecruitmentInterviewTimeSlotMysql | null = null;
    let slotLabel: string | null = null;
    if (slotId && appointmentDate) {
      bookableSlot = await this.requireBookableSlot(slotId, appointmentDate);
      slotLabel = this.formatInviteSlotLabel(bookableSlot, appointmentDate);
    }

    const candidateName = [lead.firstname, lead.lastname].filter(Boolean).join(' ') || 'Candidate';
    const courseName = lead.lead_courses[0]?.course_name ?? null;
    const parsed = existingOverlay?.parsedResumeJson as Record<string, unknown> | null | undefined;

    let profileId =
      String(opts?.jobProfileId ?? '').trim() ||
      String(parsed?.job_profile_id ?? '').trim() ||
      undefined;

    if (!profileId && courseName) {
      const [rows] = await this.jobRepo.listProfiles({ search: courseName, limit: 5 });
      const match = rows.find(
        (p) => p.title.toLowerCase() === courseName.toLowerCase() && p.status === JobProfileStatus.ACTIVE,
      ) ?? rows.find((p) => p.status === JobProfileStatus.ACTIVE) ?? rows[0];
      profileId = match?.id;
    }

    const baseUrl = this.portalBaseUrl();

    if (profileId) {
      const result = await this.jobProfiles.inviteLeadToInterview(actor, profileId, {
        lead_id: lead.lead_id,
        first_name: lead.firstname,
        last_name: lead.lastname ?? undefined,
        email: lead.email,
        phone: lead.phoneno ?? lead.whatsappnumber ?? undefined,
        resume_url: lead.resume_url ?? undefined,
        experience_years: lead.experience_years ?? undefined,
        skills: lead.lead_courses
          .map((c) => c.course_name)
          .filter((n): n is string => Boolean(n)),
        projects_summary:
          typeof parsed?.projects_summary === 'string' ? parsed.projects_summary : undefined,
        experience_summary:
          typeof parsed?.experience_summary === 'string' ? parsed.experience_summary : undefined,
        education_summary:
          typeof parsed?.education_summary === 'string' ? parsed.education_summary : undefined,
      });

      const token = result.application_token;
      const magicLinkUrl = `${baseUrl}/candidate/portal/${token}`;

      const profile = await this.jobRepo.findById(profileId);
      const jobTitle = profile?.title ?? courseName ?? 'Assessment';

      const emailContent = buildMagicLinkEmail(
        candidateName,
        jobTitle,
        magicLinkUrl,
        slotLabel,
      );
      const sent = await this.emailService.sendMail(
        lead.email,
        emailContent.subject,
        emailContent.html,
      );

      if (bookableSlot) {
        bookableSlot.bookedCount = Number(bookableSlot.bookedCount ?? 0) + 1;
        await this.repo.timeSlots.save(bookableSlot);
      }

      await this.repo.mergeLeadOverlay(lead.lead_id, {
        inviteStatus: 'INVITED',
        inviteToken: token,
        portalStage: 'Contacted',
        lastLocalActionAt: new Date(),
        ...(bookableSlot
          ? {
              inviteSlotId: bookableSlot.id,
              inviteSlotLabel: slotLabel,
              inviteSlotDate: appointmentDate,
            }
          : {}),
      });

      await this.repo.links.save(
        this.repo.links.create({
          leadId: lead.lead_id,
          localApplicationToken: token,
          inactive: 0,
        }),
      );

      await this.repo.logActivity({
        leadId: lead.lead_id,
        eventType: 'lead_invited',
        eventSummary: slotLabel
          ? `Magic link sent to ${lead.email} for ${jobTitle} (${slotLabel})`
          : `Magic link sent to ${lead.email} for ${jobTitle}`,
        eventJson: {
          token,
          jobTitle,
          profileId,
          ...(bookableSlot
            ? { slot_id: bookableSlot.id, slot_date: appointmentDate }
            : {}),
        } as Record<string, unknown>,
        actorId: this.actorId(actor),
      });

      return {
        status: 'INVITED' as const,
        invite_token: token,
        interview_url: magicLinkUrl,
        email_sent: Boolean(sent.accepted),
        slot_label: slotLabel,
        slot_date: bookableSlot ? appointmentDate : null,
        slot_id: bookableSlot ? bookableSlot.id : null,
      };
    }

    const emailContent = buildNoOpeningEmail(candidateName, courseName ?? 'the applied position');
    const sent = await this.emailService.sendMail(
      lead.email,
      emailContent.subject,
      emailContent.html,
    );

    await this.repo.mergeLeadOverlay(lead.lead_id, {
      inviteStatus: 'NO_OPENING',
      lastLocalActionAt: new Date(),
    });

    await this.repo.logActivity({
      leadId: lead.lead_id,
      eventType: 'lead_no_opening',
      eventSummary: `No matching job profile for course "${courseName ?? 'unknown'}" — no-opening email sent`,
      actorId: this.actorId(actor),
    });

    return {
      status: 'NO_OPENING' as const,
      email_sent: Boolean(sent.accepted),
    };
  }

  private normalizeTimeValue(value: unknown) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      const hh = String(value.getHours()).padStart(2, '0');
      const mm = String(value.getMinutes()).padStart(2, '0');
      const ss = String(value.getSeconds()).padStart(2, '0');
      return `${hh}:${mm}:${ss}`;
    }

    let trimmed = String(value ?? '').trim();
    if (!trimmed) {
      throw new BadRequestException('Time must be HH:mm or HH:mm:ss');
    }

    const iso = trimmed.match(/T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (iso) {
      return `${iso[1]}:${iso[2]}:${iso[3] ?? '00'}`;
    }

    trimmed = trimmed.replace(/^(\d{1,2}:\d{2}(?::\d{2})?)\.\d+$/, '$1');

    const match = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) {
      throw new BadRequestException('Time must be HH:mm or HH:mm:ss');
    }
    const hh = String(Number(match[1])).padStart(2, '0');
    const mm = match[2];
    const ss = match[3] ?? '00';
    return `${hh}:${mm}:${ss}`;
  }

  private timeToSeconds(value: unknown) {
    const normalized = this.normalizeTimeValue(value);
    const [hh, mm, ss] = normalized.split(':').map((part) => Number(part));
    return hh * 3600 + mm * 60 + ss;
  }

  private assertEndAfterStart(startTime: unknown, endTime: unknown) {
    if (this.timeToSeconds(endTime) <= this.timeToSeconds(startTime)) {
      throw new BadRequestException('end_time must be after start_time');
    }
  }

  private formatTimeOnly(value: unknown) {
    try {
      return this.normalizeTimeValue(value);
    } catch {
      return '00:00:00';
    }
  }

  private formatTimeSlotLabel(slot: RecruitmentInterviewTimeSlotMysql) {
    const start = this.formatTimeOnly(slot.startTime).slice(0, 5);
    const end = this.formatTimeOnly(slot.endTime).slice(0, 5);
    const tz = slot.timezone || 'Asia/Kolkata';
    const range = `${start}–${end} (${tz})`;
    return slot.label?.trim() ? `${slot.label.trim()} · ${range}` : range;
  }

  private formatInviteSlotLabel(
    slot: RecruitmentInterviewTimeSlotMysql,
    appointmentDate: string,
  ) {
    const date = String(appointmentDate).slice(0, 10);
    const start = this.formatTimeOnly(slot.startTime).slice(0, 5);
    const end = this.formatTimeOnly(slot.endTime).slice(0, 5);
    const tz = slot.timezone || 'Asia/Kolkata';
    const range = `${date} ${start}–${end} (${tz})`;
    return slot.label?.trim() ? `${slot.label.trim()} · ${range}` : range;
  }

  private mapTimeSlot(
    slot: RecruitmentInterviewTimeSlotMysql,
    bookedForDate?: number,
  ) {
    const capacity = Number(slot.capacity ?? 0);
    const booked =
      bookedForDate != null ? Number(bookedForDate) : Number(slot.bookedCount ?? 0);
    return {
      id: slot.id,
      label: slot.label,
      start_time: this.formatTimeOnly(slot.startTime),
      end_time: this.formatTimeOnly(slot.endTime),
      timezone: slot.timezone,
      capacity,
      booked_count: booked,
      remaining: Math.max(0, capacity - booked),
      status: slot.status,
      notes: slot.notes,
      display_label: this.formatTimeSlotLabel(slot),
      created_at: slot.createdAt,
      updated_at: slot.updatedAt,
    };
  }

  private async countBookingsForSlotOnDate(slotId: string, appointmentDate: string) {
    return this.repo.leadOverlays.count({
      where: {
        inviteSlotId: slotId as any,
        inviteSlotDate: appointmentDate,
        inviteStatus: 'INVITED',
        inactive: 0,
      },
    });
  }

  private async requireBookableSlot(slotId: string, appointmentDate: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(appointmentDate)) {
      throw new BadRequestException('slot_date must be YYYY-MM-DD');
    }
    if (appointmentDate < this.todayDateString()) {
      throw new BadRequestException('Selected interview date is in the past');
    }
    const slot = await this.repo.timeSlots.findOne({
      where: { id: slotId, inactive: 0 },
    });
    if (!slot) throw new NotFoundException('Time slot not found');
    if (slot.status !== 'open') {
      throw new BadRequestException('Selected time slot is closed');
    }
    const booked = await this.countBookingsForSlotOnDate(slotId, appointmentDate);
    if (booked >= Number(slot.capacity ?? 0)) {
      throw new BadRequestException('Selected time slot is fully booked for that date');
    }
    return slot;
  }

  async listTimeSlots(
    actor: JwtUserPayload,
    query?: { available_only?: boolean; for_date?: string },
  ) {
    await this.assertRead(actor);
    const slots = await this.repo.timeSlots.find({
      where: { inactive: 0 },
      order: { startTime: 'ASC' },
    });
    let rows = slots;
    if (query?.available_only) {
      rows = rows.filter((s) => s.status === 'open');
    }

    const forDate = String(query?.for_date ?? '').trim();
    const useDate = /^\d{4}-\d{2}-\d{2}$/.test(forDate) ? forDate : null;

    const mapped = await Promise.all(
      rows.map(async (slot) => {
        if (!useDate) return this.mapTimeSlot(slot);
        const booked = await this.countBookingsForSlotOnDate(String(slot.id), useDate);
        if (query?.available_only && booked >= Number(slot.capacity ?? 0)) {
          return null;
        }
        return this.mapTimeSlot(slot, booked);
      }),
    );
    return {
      items: mapped.filter((row): row is NonNullable<typeof row> => row != null),
    };
  }

  async createTimeSlot(
    actor: JwtUserPayload,
    body: {
      label?: string;
      start_time: string;
      end_time: string;
      timezone?: string;
      capacity?: number;
      notes?: string;
      status?: string;
    },
  ) {
    await this.assertWrite(actor);
    const startTime = this.normalizeTimeValue(body.start_time);
    const endTime = this.normalizeTimeValue(body.end_time);
    this.assertEndAfterStart(startTime, endTime);
    const capacity = Math.max(1, Number(body.capacity ?? 1) || 1);
    const status = body.status === 'closed' ? 'closed' : 'open';
    const saved = await this.repo.timeSlots.save(
      this.repo.timeSlots.create({
        label: body.label?.trim() || null,
        slotDate: null,
        startTime,
        endTime,
        timezone: (body.timezone ?? 'Asia/Kolkata').trim() || 'Asia/Kolkata',
        capacity,
        bookedCount: 0,
        status,
        notes: body.notes?.trim() || null,
        inactive: 0,
      }),
    );
    return this.mapTimeSlot(saved);
  }

  async updateTimeSlot(
    actor: JwtUserPayload,
    id: string,
    body: {
      label?: string | null;
      start_time?: string;
      end_time?: string;
      timezone?: string;
      capacity?: number;
      notes?: string | null;
      status?: string;
    },
  ) {
    await this.assertWrite(actor);
    const slot = await this.repo.timeSlots.findOne({ where: { id, inactive: 0 } });
    if (!slot) throw new NotFoundException('Time slot not found');

    if (body.label !== undefined) slot.label = body.label?.trim() || null;
    if (body.start_time !== undefined) {
      slot.startTime = this.normalizeTimeValue(body.start_time);
    }
    if (body.end_time !== undefined) {
      slot.endTime = this.normalizeTimeValue(body.end_time);
    }
    this.assertEndAfterStart(slot.startTime, slot.endTime);
    if (body.timezone !== undefined) {
      slot.timezone = body.timezone.trim() || 'Asia/Kolkata';
    }
    if (body.capacity !== undefined) {
      const capacity = Math.max(1, Number(body.capacity) || 1);
      if (capacity < Number(slot.bookedCount ?? 0)) {
        throw new BadRequestException('capacity cannot be less than booked_count');
      }
      slot.capacity = capacity;
    }
    if (body.notes !== undefined) slot.notes = body.notes?.trim() || null;
    if (body.status !== undefined) {
      slot.status = body.status === 'closed' ? 'closed' : 'open';
    }
    slot.slotDate = null;

    const saved = await this.repo.timeSlots.save(slot);
    return this.mapTimeSlot(saved);
  }

  async deleteTimeSlot(actor: JwtUserPayload, id: string) {
    await this.assertWrite(actor);
    const slot = await this.repo.timeSlots.findOne({ where: { id, inactive: 0 } });
    if (!slot) throw new NotFoundException('Time slot not found');
    slot.inactive = 1;
    slot.status = 'closed';
    await this.repo.timeSlots.save(slot);
    return { id: slot.id, deleted: true };
  }

  async bulkInviteCandidates(
    actor: JwtUserPayload,
    body: { emails?: string[]; job_profile_id?: string; slot_date?: string },
  ) {
    await this.assertWrite(actor);

    const rawEmails = Array.isArray(body.emails) ? body.emails : [];
    let invalidCount = 0;
    const seen = new Set<string>();
    const validEmails: string[] = [];
    for (const raw of rawEmails) {
      const email = String(raw ?? '').trim().toLowerCase();
      if (!email) continue;
      if (!SIMPLE_EMAIL_RE.test(email)) {
        invalidCount += 1;
        continue;
      }
      if (seen.has(email)) continue;
      seen.add(email);
      validEmails.push(email);
    }

    const profileId = String(body.job_profile_id ?? '').trim();
    const slotDate = String(body.slot_date ?? '').trim();
    if (!profileId) throw new BadRequestException('job_profile_id is required');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(slotDate)) {
      throw new BadRequestException('slot_date must be YYYY-MM-DD');
    }
    if (slotDate < this.todayDateString()) {
      throw new BadRequestException('Selected interview date is in the past');
    }
    if (!validEmails.length) {
      throw new BadRequestException('Provide at least one valid email');
    }

    const profile = await this.jobRepo.findById(profileId);
    if (!profile) throw new NotFoundException('Job profile not found');
    const jobTitle = profile.title ?? 'Assessment';

    const slots = await this.repo.timeSlots.find({
      where: { inactive: 0, status: 'open' },
      order: { startTime: 'ASC' },
    });

    const capacityRows: Array<{
      slot: RecruitmentInterviewTimeSlotMysql;
      remaining: number;
      assigned: number;
    }> = [];
    let totalRemaining = 0;
    for (const slot of slots) {
      const booked = await this.countBookingsForSlotOnDate(String(slot.id), slotDate);
      const remaining = Math.max(0, Number(slot.capacity ?? 0) - booked);
      if (remaining > 0) {
        capacityRows.push({ slot, remaining, assigned: 0 });
        totalRemaining += remaining;
      }
    }

    if (totalRemaining === 0) {
      throw new BadRequestException(
        'No open time slots with remaining capacity for the selected date. Please add or reopen a slot.',
      );
    }
    if (validEmails.length > totalRemaining) {
      const overflow = validEmails.length - totalRemaining;
      throw new BadRequestException(
        `Total capacity is ${totalRemaining} across ${capacityRows.length} slots, but ${validEmails.length} emails pasted. Please add another slot or reduce ${overflow} candidates.`,
      );
    }

    const assignments: Array<{
      email: string;
      slot: RecruitmentInterviewTimeSlotMysql;
      slotLabel: string;
    }> = [];
    let slotIdx = 0;
    for (const email of validEmails) {
      while (slotIdx < capacityRows.length && capacityRows[slotIdx].remaining <= 0) {
        slotIdx += 1;
      }
      if (slotIdx >= capacityRows.length) {
        throw new BadRequestException('Ran out of slot capacity during allocation');
      }
      const row = capacityRows[slotIdx];
      assignments.push({
        email,
        slot: row.slot,
        slotLabel: this.formatInviteSlotLabel(row.slot, slotDate),
      });
      row.remaining -= 1;
      row.assigned += 1;
    }

    const items: Array<{
      email: string;
      lead_id?: string;
      status: string;
      invite_token?: string;
      interview_url?: string;
      email_sent?: boolean;
      slot_id?: string;
      slot_label?: string;
      error?: string;
    }> = [];
    let invited = 0;
    let failed = 0;
    let skipped = 0;

    for (const { email, slot, slotLabel } of assignments) {
      try {
        const created = await this.createManualLeadPending({
          name: 'Pending',
          email,
          jobProfileId: profileId,
          jobTitle,
          inviteStatus: 'PENDING',
          portalStage: 'New',
          actorId: this.actorId(actor),
          onboardingRequired: true,
        });

        const result = await this.inviteLeadToAssessment(actor, created.leadId, {
          jobProfileId: profileId,
          slot_id: String(slot.id),
          slot_date: slotDate,
        });

        if (result.status === 'ALREADY_INVITED') {
          skipped += 1;
          items.push({
            email,
            lead_id: created.leadId,
            status: result.status,
            invite_token: result.invite_token,
            interview_url: result.interview_url,
            slot_id: String(slot.id),
            slot_label: slotLabel,
          });
        } else if (result.status === 'INVITED') {
          invited += 1;
          items.push({
            email,
            lead_id: created.leadId,
            status: result.status,
            invite_token: result.invite_token,
            interview_url: result.interview_url,
            email_sent: result.email_sent,
            slot_id: String(slot.id),
            slot_label: result.slot_label ?? slotLabel,
          });
        } else {
          failed += 1;
          items.push({
            email,
            lead_id: created.leadId,
            status: result.status,
            slot_id: String(slot.id),
            slot_label: slotLabel,
            error: 'Invite did not complete',
          });
        }
      } catch (err) {
        failed += 1;
        items.push({
          email,
          status: 'ERROR',
          slot_id: String(slot.id),
          slot_label: slotLabel,
          error: err instanceof Error ? err.message : 'Failed to invite candidate',
        });
      }
    }

    return {
      invited,
      failed,
      skipped,
      invalid_count: invalidCount,
      total_capacity: totalRemaining,
      allocation: capacityRows
        .filter((row) => row.assigned > 0)
        .map((row) => ({
          slot_id: String(row.slot.id),
          slot_label: this.formatInviteSlotLabel(row.slot, slotDate),
          assigned: row.assigned,
        })),
      items,
    };
  }

  private todayDateString() {
    return formatDateInIst(new Date());
  }

  async triggerBackgroundResumeParse(application: JobApplicationMysql): Promise<void> {
    if (!application.source?.startsWith('lead:')) {
      return;
    }

    const leadId = application.source.split(':')[1];
    const overlay = await this.repo.findLeadOverlay(leadId);

    if (overlay && overlay.parsedResumeJson && Object.keys(overlay.parsedResumeJson).length > 0) {
      return;
    }

    try {
      const resolved = await this.resolveLocalLead(leadId);
      if (!resolved?.lead.resume_url) return;

      await this.ai.parseResume(resolved.lead);

      const updatedOverlay = await this.repo.findLeadOverlay(leadId);
      if (updatedOverlay?.parsedResumeJson) {
        const parsed = updatedOverlay.parsedResumeJson as Record<string, unknown>;
        const candidate = await this.candidates.findOne({ where: { id: application.candidateId } });
        if (candidate) {
          if (parsed.projects_summary) candidate.projectsSummary = String(parsed.projects_summary).trim();
          if (parsed.experience_summary) candidate.experienceSummary = String(parsed.experience_summary).trim();
          if (parsed.education_summary) candidate.educationSummary = String(parsed.education_summary).trim();
          await this.candidates.save(candidate);
        }
      }
    } catch (error) {
      console.error(`Background resume parse failed for lead ${leadId}:`, error);
    }
  }
}
