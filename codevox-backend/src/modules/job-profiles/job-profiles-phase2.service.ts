import { AssessmentExecutionRepository } from '../assessment-execution/assessment-execution.repository';
import { EvaluationService } from '../assessment-execution/services/evaluation.service';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, MoreThanOrEqual, Repository } from 'typeorm';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import { RbacPermissionService } from '../../authorization/rbac-permission.service';
import {
  AssessmentTemplateMysql,
  AssessmentTemplateStatus,
} from '../assessment-platform/assessment-engine/entities/assessment-template.mysql.entity';
import { JobProfileMysql, JobProfileStatus } from './entities/job-profile.mysql.entity';
import {
  JobProfileApprovalMysql,
  JobProfileApprovalStatus,
} from './entities/job-profile-approval.mysql.entity';
import { JobProfileVersionMysql } from './entities/job-profile-version.mysql.entity';
import { CompetencyLibraryMysql } from './entities/competency-library.mysql.entity';
import { JobProfileCompetencyMysql } from './entities/job-profile-competency.mysql.entity';
import { QuestionLibraryMysql } from './entities/question-library.mysql.entity';
import { JobProfilePreviewAuditMysql } from './entities/job-profile-preview-audit.mysql.entity';
import { JobApplicationMysql, JobApplicationStatus } from './entities/job-application.mysql.entity';
import {
  QuestionBankDifficulty,
  QuestionBankQuestionMysql,
  QuestionBankStatus,
  QuestionBankType,
} from './entities/question-bank-question.mysql.entity';
import { QuestionBankVersionMysql } from './entities/question-bank-version.mysql.entity';
import { QuestionBankSetMysql } from './entities/question-bank-set.mysql.entity';
import { QuestionBankSetItemMysql } from './entities/question-bank-set-item.mysql.entity';
import { ProblemBankProblemMysql, ProblemBankStatus } from './entities/problem-bank-problem.mysql.entity';
import { ProblemBankVersionMysql } from './entities/problem-bank-version.mysql.entity';
import { ProblemBankTestCaseMysql } from './entities/problem-bank-test-case.mysql.entity';
import { ProblemBankLanguageTemplateMysql } from './entities/problem-bank-language-template.mysql.entity';
import { ProblemBankSetMysql } from './entities/problem-bank-set.mysql.entity';
import { ProblemBankSetItemMysql } from './entities/problem-bank-set-item.mysql.entity';
import { InterviewRoundQuestionSnapshotMysql } from './entities/interview-round-question-snapshot.mysql.entity';
import { InterviewRoundProblemSnapshotMysql } from './entities/interview-round-problem-snapshot.mysql.entity';
import { JobProfilesRepository } from './job-profiles.repository';
import { JobProfilesService } from './job-profiles.service';
import { JobProfilesAiService } from './job-profiles-ai.service';
import {
  diffSnapshots,
  filterProfileFields,
  type ComplianceConfig,
  type NotificationConfig,
} from './job-profiles-phase2.util';
import { seniorityToDifficulty } from './job-profiles.util';

function resolveBiasCheckPassed(value: number | boolean | null | undefined, fallback = true): boolean {
  if (value == null) return fallback;
  if (typeof value === 'boolean') return value;
  return value !== 0;
}

@Injectable()
export class JobProfilesPhase2Service {
  constructor(
    private readonly evaluation: EvaluationService,
    private readonly executionRepo: AssessmentExecutionRepository,
    private readonly repo: JobProfilesRepository,
    private readonly core: JobProfilesService,
    private readonly rbac: RbacPermissionService,
    private readonly ai: JobProfilesAiService,
    @InjectRepository(JobProfileVersionMysql)
    private readonly versions: Repository<JobProfileVersionMysql>,
    @InjectRepository(JobProfileApprovalMysql)
    private readonly approvals: Repository<JobProfileApprovalMysql>,
    @InjectRepository(CompetencyLibraryMysql)
    private readonly competencyLib: Repository<CompetencyLibraryMysql>,
    @InjectRepository(JobProfileCompetencyMysql)
    private readonly profileCompetencies: Repository<JobProfileCompetencyMysql>,
    @InjectRepository(QuestionLibraryMysql)
    private readonly questionLib: Repository<QuestionLibraryMysql>,
    @InjectRepository(JobProfilePreviewAuditMysql)
    private readonly previewAudit: Repository<JobProfilePreviewAuditMysql>,
    @InjectRepository(JobApplicationMysql)
    private readonly applications: Repository<JobApplicationMysql>,
    @InjectRepository(AssessmentTemplateMysql)
    private readonly templates: Repository<AssessmentTemplateMysql>,
    @InjectRepository(QuestionBankQuestionMysql)
    private readonly questionBank: Repository<QuestionBankQuestionMysql>,
    @InjectRepository(QuestionBankVersionMysql)
    private readonly questionVersions: Repository<QuestionBankVersionMysql>,
    @InjectRepository(QuestionBankSetMysql)
    private readonly questionSets: Repository<QuestionBankSetMysql>,
    @InjectRepository(QuestionBankSetItemMysql)
    private readonly questionSetItems: Repository<QuestionBankSetItemMysql>,
    @InjectRepository(ProblemBankProblemMysql)
    private readonly problemBank: Repository<ProblemBankProblemMysql>,
    @InjectRepository(ProblemBankVersionMysql)
    private readonly problemVersions: Repository<ProblemBankVersionMysql>,
    @InjectRepository(ProblemBankTestCaseMysql)
    private readonly problemCases: Repository<ProblemBankTestCaseMysql>,
    @InjectRepository(ProblemBankLanguageTemplateMysql)
    private readonly problemLanguageTemplates: Repository<ProblemBankLanguageTemplateMysql>,
    @InjectRepository(ProblemBankSetMysql)
    private readonly problemSets: Repository<ProblemBankSetMysql>,
    @InjectRepository(ProblemBankSetItemMysql)
    private readonly problemSetItems: Repository<ProblemBankSetItemMysql>,
    @InjectRepository(InterviewRoundQuestionSnapshotMysql)
    private readonly questionSnapshots: Repository<InterviewRoundQuestionSnapshotMysql>,
    @InjectRepository(InterviewRoundProblemSnapshotMysql)
    private readonly problemSnapshots: Repository<InterviewRoundProblemSnapshotMysql>,
  ) {}

  private async assertWrite(actor: JwtUserPayload) {
    const ok = await this.rbac.hasPermission(actor, 'job_profiles:write');
    if (!ok) {
      const fallback = await this.rbac.hasPermission(actor, 'assessments:write');
      if (!fallback) throw new ForbiddenException();
    }
  }

  private async assertRead(actor: JwtUserPayload) {
    if (await this.rbac.hasPermission(actor, 'job_profiles:read')) return;
    if (await this.rbac.hasPermission(actor, 'assessments:read')) return;
    throw new ForbiddenException();
  }

  private async assertApprove(actor: JwtUserPayload) {
    const ok = await this.rbac.hasPermission(actor, 'job_profiles:approve');
    if (!ok) throw new ForbiddenException('Approval permission required');
  }

  async snapshotVersion(actor: JwtUserPayload, profileId: string) {
    await this.assertWrite(actor);
    const detail = await this.core.get(actor, profileId);
    const profile = await this.repo.requireById(profileId);
    const versionNumber = profile.version;
    await this.versions.save(
      this.versions.create({
        jobProfileId: profileId,
        versionNumber,
        snapshot: detail as unknown as Record<string, unknown>,
        createdByUserId: actor.sub,
        inactive: 0,
      }),
    );
    return { version_number: versionNumber };
  }

  async listVersions(actor: JwtUserPayload, profileId: string) {
    await this.core.get(actor, profileId);
    const rows = await this.versions.find({
      where: { jobProfileId: profileId, inactive: 0 },
      order: { versionNumber: 'DESC' },
    });
    return rows.map((v) => ({
      id: v.id,
      version_number: v.versionNumber,
      created_by_user_id: v.createdByUserId,
      created_at: v.createdAt.toISOString(),
    }));
  }

  async diffVersions(actor: JwtUserPayload, profileId: string, v1: number, v2: number) {
    await this.core.get(actor, profileId);
    const [a, b] = await Promise.all([
      this.versions.findOne({ where: { jobProfileId: profileId, versionNumber: v1, inactive: 0 } }),
      this.versions.findOne({ where: { jobProfileId: profileId, versionNumber: v2, inactive: 0 } }),
    ]);
    if (!a || !b) throw new NotFoundException('Version not found');
    return {
      from: v1,
      to: v2,
      changes: diffSnapshots(
        (a.snapshot.profile as Record<string, unknown>) ?? {},
        (b.snapshot.profile as Record<string, unknown>) ?? {},
      ),
      stage_changes: diffSnapshots(
        { stages: a.snapshot.stages },
        { stages: b.snapshot.stages },
      ),
    };
  }

  async submitForApproval(actor: JwtUserPayload, profileId: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(profileId);
    const compliance = (row.complianceConfig ?? {}) as ComplianceConfig;
    await this.snapshotVersion(actor, profileId);

    const approval = await this.approvals.save(
      this.approvals.create({
        jobProfileId: profileId,
        versionNumber: row.version,
        requestedByUserId: actor.sub,
        status: JobProfileApprovalStatus.PENDING,
        inactive: 0,
      }),
    );

    if (compliance.approval_required !== false) {
      await this.repo.patchProfile(profileId, { status: JobProfileStatus.PENDING_APPROVAL });
    }

    return { approval_id: approval.id, status: approval.status };
  }

  async approveProfile(actor: JwtUserPayload, profileId: string, body: { comment?: string }) {
    await this.assertApprove(actor);
    const pending = await this.approvals.findOne({
      where: { jobProfileId: profileId, status: JobProfileApprovalStatus.PENDING, inactive: 0 },
      order: { createdAt: 'DESC' },
    });
    if (!pending) throw new BadRequestException('No pending approval');

    await this.approvals.update(
      { id: pending.id },
      {
        status: JobProfileApprovalStatus.APPROVED,
        reviewerUserId: actor.sub,
        comment: body.comment ?? null,
        resolvedAt: new Date(),
      },
    );

    return this.activateProfile(actor, profileId);
  }

  async rejectApproval(actor: JwtUserPayload, profileId: string, body: { comment?: string }) {
    await this.assertApprove(actor);
    const pending = await this.approvals.findOne({
      where: { jobProfileId: profileId, status: JobProfileApprovalStatus.PENDING, inactive: 0 },
      order: { createdAt: 'DESC' },
    });
    if (!pending) throw new BadRequestException('No pending approval');

    await this.approvals.update(
      { id: pending.id },
      {
        status: JobProfileApprovalStatus.REJECTED,
        reviewerUserId: actor.sub,
        comment: body.comment ?? null,
        resolvedAt: new Date(),
      },
    );
    await this.repo.patchProfile(profileId, { status: JobProfileStatus.DRAFT });
    return { status: 'rejected' };
  }

  async activateProfile(actor: JwtUserPayload, profileId: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(profileId);
    const stages = await this.repo.listStages(profileId);
    if (!stages.length) throw new BadRequestException('At least one stage is required');

    let templateId = row.assessmentTemplateId;
    if (!templateId) {
      const template = await this.templates.save(
        this.templates.create({
          name: `${row.title} Pack`,
          role: row.title,
          difficulty: seniorityToDifficulty(row.seniorityLevel),
          assessmentType: 'TECHNICAL',
          templateJson: {
            required_skills: row.requiredSkills ?? [],
            responsibilities: row.responsibilities ?? [],
          },
          status: AssessmentTemplateStatus.ACTIVE,
        }),
      );
      templateId = template.id;
    }

    const nextVersion = row.version + 1;
    await this.repo.patchProfile(profileId, {
      status: JobProfileStatus.ACTIVE,
      publishedAt: new Date(),
      assessmentTemplateId: templateId,
      version: nextVersion,
      autonomousInterviewConfig: {
        ...(row.autonomousInterviewConfig ?? {}),
        job_profile_id: profileId,
      },
    });

    const detail = await this.core.get(actor, profileId);
    await this.versions.save(
      this.versions.create({
        jobProfileId: profileId,
        versionNumber: nextVersion,
        snapshot: detail as unknown as Record<string, unknown>,
        createdByUserId: actor.sub,
        inactive: 0,
      }),
    );
    return this.core.get(actor, profileId);
  }

  async updatePhase2Config(
    actor: JwtUserPayload,
    profileId: string,
    body: {
      compliance_config?: ComplianceConfig;
      threshold_config?: Record<string, unknown>;
      progression_config?: Record<string, unknown>;
      notification_config?: NotificationConfig;
      field_permissions?: Record<string, string[]>;
    },
  ) {
    await this.assertWrite(actor);
    const patch: Partial<JobProfileMysql> = {};
    if (body.compliance_config) patch.complianceConfig = body.compliance_config;
    if (body.threshold_config) patch.thresholdConfig = body.threshold_config;
    if (body.progression_config) patch.progressionConfig = body.progression_config;
    if (body.notification_config) patch.notificationConfig = body.notification_config;
    if (body.field_permissions) patch.fieldPermissions = body.field_permissions;
    await this.repo.patchProfile(profileId, patch);
    return this.core.get(actor, profileId);
  }

  async listCompetencyLibrary(actor: JwtUserPayload, department?: string) {
    await this.rbac.hasPermission(actor, 'job_profiles:read');
    const qb = this.competencyLib
      .createQueryBuilder('c')
      .where('c.inactive = 0')
      .orderBy('c.name', 'ASC');
    if (department) {
      qb.andWhere('(c.department IS NULL OR c.department = :department)', { department });
    }
    const rows = await qb.getMany();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      description: r.description,
      department: r.department,
      default_target_score: r.defaultTargetScore != null ? Number(r.defaultTargetScore) : null,
      default_weight_pct: r.defaultWeightPct != null ? Number(r.defaultWeightPct) : null,
    }));
  }

  /** Distinct competencies used on job profile rubrics (`job_profile_competencies`). */
  async listJobProfileCompetencyCatalog(actor: JwtUserPayload, department?: string) {
    await this.rbac.hasPermission(actor, 'job_profiles:read');
    const qb = this.profileCompetencies
      .createQueryBuilder('c')
      .innerJoin('c.profile', 'p')
      .leftJoin(CompetencyLibraryMysql, 'lib', 'lib.name = c.name AND lib.inactive = 0')
      .select('c.name', 'name')
      .addSelect('MIN(c.id)', 'id')
      .addSelect('MIN(c.category)', 'category')
      .addSelect('AVG(c.target_score)', 'default_target_score')
      .addSelect('AVG(c.weight_pct)', 'default_weight_pct')
      .addSelect('MAX(lib.description)', 'description')
      .addSelect('COUNT(DISTINCT c.job_profile_id)', 'profile_count')
      .where('c.inactive = 0')
      .andWhere('p.inactive = 0');
    if (department?.trim()) {
      qb.andWhere('p.department = :department', { department: department.trim() });
    }
    const rows = await qb.groupBy('c.name').orderBy('c.name', 'ASC').getRawMany<{
      id: string;
      name: string;
      category: string;
      default_target_score: string | null;
      default_weight_pct: string | null;
      description: string | null;
      profile_count: string;
    }>();
    return rows.map((r) => ({
      id: String(r.id),
      name: r.name,
      category: r.category,
      description: r.description,
      default_target_score: r.default_target_score != null ? Number(r.default_target_score) : null,
      default_weight_pct: r.default_weight_pct != null ? Number(r.default_weight_pct) : null,
      profile_count: Number(r.profile_count) || 0,
    }));
  }

  async listQuestionLibrary(actor: JwtUserPayload, department?: string) {
    await this.rbac.hasPermission(actor, 'job_profiles:read');
    const qb = this.questionLib
      .createQueryBuilder('q')
      .where('q.inactive = 0')
      .orderBy('q.id', 'DESC');
    if (department) {
      qb.andWhere('(q.department IS NULL OR q.department = :department)', { department });
    }
    const rows = await qb.getMany();
    return rows.map((r) => ({
      id: r.id,
      prompt: r.prompt,
      kind: r.kind,
      stage_type: r.stageType,
      department: r.department,
      metadata: r.metadata,
    }));
  }

  async startPreviewAudit(actor: JwtUserPayload, profileId: string, candidateToken: string) {
    await this.assertWrite(actor);
    const row = await this.previewAudit.save(
      this.previewAudit.create({
        jobProfileId: profileId,
        recruiterUserId: actor.sub,
        candidateToken,
        events: [],
        inactive: 0,
      }),
    );
    return { audit_id: row.id };
  }

  async appendPreviewAuditEvent(auditId: string, event: Record<string, unknown>) {
    const row = await this.previewAudit.findOne({ where: { id: auditId, inactive: 0 } });
    if (!row) return;
    const events = [...(row.events ?? []), { ...event, at: new Date().toISOString() }];
    await this.previewAudit.update(
      { id: auditId },
      { events } as Parameters<Repository<JobProfilePreviewAuditMysql>['update']>[1],
    );
  }

  async endPreviewAudit(auditId: string) {
    await this.previewAudit.update({ id: auditId }, { endedAt: new Date() });
  }

  async listPreviewAudits(actor: JwtUserPayload, profileId: string) {
    await this.core.get(actor, profileId);
    const rows = await this.previewAudit.find({
      where: { jobProfileId: profileId, inactive: 0 },
      order: { startedAt: 'DESC' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      candidate_token: r.candidateToken,
      recruiter_user_id: r.recruiterUserId,
      event_count: r.events?.length ?? 0,
      started_at: r.startedAt.toISOString(),
      ended_at: r.endedAt?.toISOString() ?? null,
    }));
  }

  async getExtendedAnalytics(actor: JwtUserPayload, profileId: string, days?: number) {
    const base = await this.core.getAnalytics(actor, profileId, days);
    const cutoff = days ? new Date(Date.now() - days * 86400000) : null;
    const apps = await this.applications.find({
      where: {
        jobProfileId: profileId,
        inactive: 0,
        ...(cutoff ? { appliedAt: MoreThanOrEqual(cutoff) } : {}),
      },
    });
    const hired = apps.filter((a) => a.status === JobApplicationStatus.HIRED);
    const timeToFillDays = hired.length
      ? Math.round(
          hired.reduce((s, a) => {
            const end = a.updatedAt.getTime();
            return s + (end - a.appliedAt.getTime()) / 86400000;
          }, 0) / hired.length,
        )
      : null;

    const scoreBuckets = [0, 0, 0, 0, 0];
    for (const app of apps) {
      const idx = app.pendingHumanReview ? 2 : app.status === JobApplicationStatus.HIRED ? 4 : 1;
      scoreBuckets[Math.min(4, idx)] += 1;
    }

    const profile = await this.repo.requireById(profileId);
    const stages = await this.repo.listStages(profileId);
    const slaDays = (profile.notificationConfig as NotificationConfig)?.stall_days_threshold ?? 7;
    const stageSla = stages.map((s) => {
      const inStage = apps.filter((a) => a.currentStageId === s.id);
      const breached = inStage.filter((a) => {
        const ref = a.stageEnteredAt ?? a.updatedAt;
        return (Date.now() - ref.getTime()) / 86400000 > slaDays;
      }).length;
      return { stage_id: s.id, name: s.name, candidates: inStage.length, sla_breaches: breached };
    });

    let assessmentMetrics = {
      total_interviews: 0,
      avg_voice_score: null as number | null,
      avg_coding_score: null as number | null,
      proctor_clean_count: 0,
      proctor_strike_count: 0,
      proctor_terminated_count: 0,
      proctor_pass_rate_pct: 100,
      interview_pass_rate_pct: null as number | null,
    };

    try {
      const interviewSql = `
        SELECT 
          COUNT(*) as total_interviews,
          AVG(CASE WHEN stage1_voice_score > 0 THEN stage1_voice_score ELSE NULL END) as avg_voice_score,
          AVG(CASE WHEN code_quality_score IS NOT NULL THEN code_quality_score ELSE NULL END) as avg_coding_score,
          SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(proctor_summary, '$.by_type.media_permission_terminated')) > 0 THEN 1 ELSE 0 END) as terminated_count,
          SUM(CASE WHEN JSON_UNQUOTE(JSON_EXTRACT(proctor_summary, '$.by_type.media_permission_revoked')) > 0 THEN 1 ELSE 0 END) as strike_count,
          SUM(CASE WHEN final_decision IN ('advance', 'hire') THEN 1 ELSE 0 END) as passed_count
        FROM candidate_autonomous_interviews 
        WHERE job_profile_id = ? AND is_preview = 0
        ${cutoff ? 'AND created_at >= ?' : ''}
      `;
      const sqlParams: unknown[] = [profileId];
      if (cutoff) sqlParams.push(cutoff);
      const [rawStats] = (await this.applications.manager.query(interviewSql, sqlParams)) as Array<Record<string, unknown>>;

      if (rawStats) {
        const totalInterviews = Number(rawStats.total_interviews ?? 0);
        const avgVoice = rawStats.avg_voice_score != null ? Math.round(Number(rawStats.avg_voice_score) * 10) / 10 : null;
        const avgCoding = rawStats.avg_coding_score != null ? Math.round(Number(rawStats.avg_coding_score)) : null;
        const terminated = Number(rawStats.terminated_count ?? 0);
        const strikes = Number(rawStats.strike_count ?? 0);
        const clean = Math.max(0, totalInterviews - terminated);
        const proctorRate = totalInterviews > 0 ? Math.round((clean / totalInterviews) * 100) : 100;
        const passRate = totalInterviews > 0 ? Math.round((Number(rawStats.passed_count ?? 0) / totalInterviews) * 100) : null;

        assessmentMetrics = {
          total_interviews: totalInterviews,
          avg_voice_score: avgVoice,
          avg_coding_score: avgCoding,
          proctor_clean_count: clean,
          proctor_strike_count: strikes,
          proctor_terminated_count: terminated,
          proctor_pass_rate_pct: proctorRate,
          interview_pass_rate_pct: passRate,
        };
      }
    } catch {
      // Gracefully fallback if query fails
    }

    return {
      ...base,
      time_to_fill_days: timeToFillDays,
      score_histogram: scoreBuckets.map((count, i) => ({
        bucket: `${i * 2}-${i * 2 + 2}`,
        count,
      })),
      stage_sla: stageSla,
      stall_threshold_days: slaDays,
      selected_days: days ?? null,
      assessment_metrics: assessmentMetrics,
    };
  }

  async getProfileWithFieldPermissions(actor: JwtUserPayload, profileId: string) {
    const detail = await this.core.get(actor, profileId);
    const profile = await this.repo.requireById(profileId);
    const canWrite = await this.rbac.hasPermission(actor, 'job_profiles:write');
    const canApprove = await this.rbac.hasPermission(actor, 'job_profiles:approve');
    const isOwner = profile.ownerUserId === actor.sub;
    detail.profile = filterProfileFields(
      detail.profile,
      { isOwner, canWrite, canApprove },
      profile.fieldPermissions as Record<string, string[]> | null,
    );
    return detail;
  }

  async listPendingApprovals(actor: JwtUserPayload) {
    await this.assertApprove(actor);
    const rows = await this.approvals.find({
      where: { status: JobProfileApprovalStatus.PENDING, inactive: 0 },
      order: { createdAt: 'DESC' },
    });
    const [profileRows] = await this.repo.listProfiles({ limit: 500, offset: 0 });
    const byId = new Map(profileRows.map((p) => [p.id, p]));
    return rows.map((a) => ({
      approval_id: a.id,
      job_profile_id: a.jobProfileId,
      version_number: a.versionNumber,
      title: byId.get(a.jobProfileId)?.title ?? null,
      requested_at: a.createdAt.toISOString(),
    }));
  }

  async listQuestionBank(
    actor: JwtUserPayload,
    query: {
      page?: number;
      page_size?: number;
      search?: string;
      type?: string[];
      competency?: string[];
      difficulty?: string[];
      status?: string[];
      topic?: string;
      min_usage?: number;
      max_usage?: number;
      sort_by?: string;
      sort_order?: 'asc' | 'desc';
    },
  ) {
    await this.assertRead(actor);
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size ?? 25)));
    const qb = this.questionBank.createQueryBuilder('q').where('q.inactive = 0');
    if (query.search?.trim()) {
      const like = `%${query.search.trim()}%`;
      qb.andWhere('(q.question_text LIKE :like OR q.expected_answer_notes LIKE :like)', { like });
    }
    if (query.type?.length) qb.andWhere('q.question_type IN (:...type)', { type: query.type });
    if (query.difficulty?.length) qb.andWhere('q.difficulty IN (:...difficulty)', { difficulty: query.difficulty });
    if (query.status?.length) qb.andWhere('q.status IN (:...status)', { status: query.status });
    if (query.competency?.length) {
      qb.andWhere(
        new Brackets((sub) => {
          query.competency!.forEach((tag, index) => {
            const exactParam = `qCompTag${index}`;
            const searchParam = `qCompSearch${index}`;
            const likeParam = `qCompLike${index}`;
            const textParam = `qCompText${index}`;
            const normalized = tag.trim();
            const like = `%${normalized}%`;
            const likeLower = `%${normalized.toLowerCase()}%`;
            sub.orWhere(
              `(JSON_CONTAINS(q.competency_tags, :${exactParam}) OR JSON_SEARCH(q.competency_tags, 'one', :${searchParam}) IS NOT NULL OR LOWER(CAST(q.competency_tags AS CHAR)) LIKE :${likeParam} OR JSON_SEARCH(q.topic_tags, 'one', :${searchParam}) IS NOT NULL OR LOWER(CAST(q.topic_tags AS CHAR)) LIKE :${likeParam} OR q.question_text LIKE :${textParam} OR q.question_text_plain LIKE :${textParam})`,
              {
                [exactParam]: JSON.stringify(normalized),
                [searchParam]: normalized,
                [likeParam]: likeLower,
                [textParam]: like,
              },
            );
          });
        }),
      );
    }
    if (query.topic?.trim()) qb.andWhere('JSON_SEARCH(q.topic_tags, "one", :topic) IS NOT NULL', { topic: query.topic.trim() });
    if (query.min_usage != null) qb.andWhere('q.usage_count >= :minUsage', { minUsage: Number(query.min_usage) });
    if (query.max_usage != null) qb.andWhere('q.usage_count <= :maxUsage', { maxUsage: Number(query.max_usage) });
    const sortBy = new Set(['created_at', 'updated_at', 'usage_count', 'difficulty', 'status']).has(query.sort_by ?? '')
      ? query.sort_by!
      : 'created_at';
    qb.orderBy(`q.${sortBy}`, (query.sort_order ?? 'desc').toUpperCase() as 'ASC' | 'DESC');
    qb.take(pageSize).skip((page - 1) * pageSize);
    const [rows, total] = await qb.getManyAndCount();
    return { items: rows, total, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async getQuestionBankQuestion(actor: JwtUserPayload, id: string) {
    await this.assertWrite(actor);
    const row = await this.questionBank.findOne({ where: { id, inactive: 0 } });
    if (!row) throw new NotFoundException('Question not found');
    return row;
  }

  async createQuestionBankQuestion(
    actor: JwtUserPayload,
    body: Partial<QuestionBankQuestionMysql> & { bias_check_acknowledged?: boolean },
  ) {
    await this.assertWrite(actor);
    const publishing = body.status === QuestionBankStatus.PUBLISHED;
    const biasPassed = resolveBiasCheckPassed(body.biasCheckPassed);
    if (publishing && !biasPassed && !body.bias_check_acknowledged) {
      throw new BadRequestException(
        'Publish blocked: bias check flagged this question. Acknowledge the bias warning before publishing.',
      );
    }
    const row = await this.questionBank.save(
      this.questionBank.create({
        questionText: body.questionText ?? '',
        questionTextPlain: body.questionTextPlain ?? null,
        questionType: body.questionType ?? QuestionBankType.TECHNICAL,
        difficulty: body.difficulty ?? QuestionBankDifficulty.MEDIUM,
        status: publishing ? QuestionBankStatus.PUBLISHED : (body.status ?? QuestionBankStatus.DRAFT),
        competencyTags: body.competencyTags ?? null,
        topicTags: body.topicTags ?? null,
        expectedAnswerNotes: body.expectedAnswerNotes ?? null,
        idealAnswerKeywords: body.idealAnswerKeywords ?? null,
        followUpQuestion: body.followUpQuestion ?? null,
        followUpTrigger: body.followUpTrigger ?? null,
        redFlagSignals: body.redFlagSignals ?? null,
        biasCheckPassed: biasPassed ? 1 : 0,
        biasCheckNotes: body.biasCheckNotes ?? null,
        timeGuidanceSeconds: body.timeGuidanceSeconds ?? null,
        createdByUserId: actor.sub,
        updatedByUserId: actor.sub,
        inactive: 0,
      }),
    );
    await this.createQuestionVersion(row.id, actor.sub, 'Initial draft');
    return row;
  }

  async updateQuestionBankQuestion(
    actor: JwtUserPayload,
    id: string,
    body: Partial<QuestionBankQuestionMysql> & { bias_check_acknowledged?: boolean },
  ) {
    await this.assertWrite(actor);
    const row = await this.questionBank.findOne({ where: { id, inactive: 0 } });
    if (!row) throw new NotFoundException('Question not found');
    const publishing = body.status === QuestionBankStatus.PUBLISHED;
    const biasPassed = resolveBiasCheckPassed(body.biasCheckPassed, row.biasCheckPassed !== 0);
    if (publishing && !biasPassed && !body.bias_check_acknowledged) {
      throw new BadRequestException(
        'Publish blocked: bias check flagged this question. Acknowledge the bias warning before publishing.',
      );
    }
    Object.assign(row, body, { updatedByUserId: actor.sub });
    if (body.biasCheckPassed != null) {
      row.biasCheckPassed = biasPassed ? 1 : 0;
    }
    const saved = await this.questionBank.save(row);
    await this.createQuestionVersion(saved.id, actor.sub, body.status ? `Status changed to ${body.status}` : 'Question updated');
    return saved;
  }

  async archiveQuestionBankQuestion(actor: JwtUserPayload, id: string) {
    await this.assertWrite(actor);
    const row = await this.questionBank.findOne({ where: { id, inactive: 0 } });
    if (!row) throw new NotFoundException('Question not found');
    row.status = QuestionBankStatus.ARCHIVED;
    row.updatedByUserId = actor.sub;
    return this.questionBank.save(row);
  }

  async bulkQuestionBankAction(actor: JwtUserPayload, body: { ids: string[]; action: string; topic_tags?: string[]; set_id?: string; bias_check_acknowledged?: boolean }) {
    await this.assertWrite(actor);
    if (!body.ids?.length) return { affected: 0 };
    if (body.action === 'publish') {
      const rows = await this.questionBank.find({ where: { id: In(body.ids), inactive: 0 } });
      const blocked = rows.filter((row) => row.biasCheckPassed === 0);
      if (blocked.length && !body.bias_check_acknowledged) {
        throw new BadRequestException(
          `${blocked.length} question(s) failed bias check. Acknowledge before bulk publishing.`,
        );
      }
      await this.questionBank.update({ id: In(body.ids), inactive: 0 }, { status: QuestionBankStatus.PUBLISHED });
      return { affected: body.ids.length };
    }
    if (body.action === 'archive') {
      await this.questionBank.update({ id: In(body.ids), inactive: 0 }, { status: QuestionBankStatus.ARCHIVED });
      return { affected: body.ids.length };
    }
    if (body.action === 'tag' && body.topic_tags) {
      const rows = await this.questionBank.find({ where: { id: In(body.ids), inactive: 0 } });
      for (const row of rows) row.topicTags = [...new Set([...(row.topicTags ?? []), ...body.topic_tags])];
      await this.questionBank.save(rows);
      return { affected: rows.length };
    }
    if (body.action === 'add_to_set' && body.set_id) {
      const existing = await this.questionSetItems.find({ where: { setId: body.set_id, inactive: 0 } });
      const existingIds = new Set(existing.map((x) => x.questionId));
      const inserts = body.ids.filter((q) => !existingIds.has(q)).map((q, i) => this.questionSetItems.create({ setId: body.set_id!, questionId: q, sortOrder: existing.length + i, inactive: 0 }));
      if (inserts.length) await this.questionSetItems.save(inserts);
      return { affected: body.ids.length };
    }
    return { affected: 0 };
  }

  async listQuestionVersions(actor: JwtUserPayload, questionId: string) {
    await this.assertWrite(actor);
    return this.questionVersions.find({ where: { questionId, inactive: 0 }, order: { versionNumber: 'DESC' } });
  }

  async restoreQuestionVersion(actor: JwtUserPayload, questionId: string, versionNumber: number) {
    await this.assertWrite(actor);
    const version = await this.questionVersions.findOne({ where: { questionId, versionNumber, inactive: 0 } });
    if (!version) throw new NotFoundException('Version not found');
    const row = await this.questionBank.findOne({ where: { id: questionId, inactive: 0 } });
    if (!row) throw new NotFoundException('Question not found');
    Object.assign(row, version.snapshot);
    row.updatedByUserId = actor.sub;
    const saved = await this.questionBank.save(row);
    await this.createQuestionVersion(saved.id, actor.sub, `Restored version ${versionNumber}`);
    return saved;
  }

  
  async getDashboardStats(actor: JwtUserPayload) {
    const raw = await this.problemBank
      .createQueryBuilder('p')
      .select([
        "SUM(CASE WHEN p.status = 'draft' THEN 1 ELSE 0 END) as draft",
        "SUM(CASE WHEN p.status = 'published' THEN 1 ELSE 0 END) as published",
        "SUM(CASE WHEN p.workspace_type = 'code' THEN 1 ELSE 0 END) as coding",
        "SUM(CASE WHEN (p.workspace_type = 'sql' OR p.workspace_type = 'database') THEN 1 ELSE 0 END) as database_count"
      ])
      .where('p.inactive = 0')
      .getRawOne();

    const [activeRow] = await this.problemBank.manager.query(
      `SELECT COUNT(*) AS activeTests
       FROM coding_round_submissions
       WHERE status = 'in_progress' AND inactive = 0`,
    );

    return {
      problemBank: {
        totalDraft: Number(raw?.draft || 0),
        totalPublished: Number(raw?.published || 0),
        codingProblems: Number(raw?.coding || 0),
        databaseProblems: Number(raw?.database_count || 0),
      },
      integrity: await this.executionRepo.getIntegritySummary(Number(activeRow?.activeTests || 0)),
    };
  }

  async listProblemBank(actor: JwtUserPayload, query: { page?: number; page_size?: number; search?: string; status?: string[]; difficulty?: string[]; topic?: string; competency?: string[]; }) {
    await this.assertRead(actor);
    const page = Math.max(1, Number(query.page ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.page_size ?? 25)));
    const qb = this.problemBank.createQueryBuilder('p').where('p.inactive = 0');
    if (query.search?.trim()) {
      const like = `%${query.search.trim()}%`;
      qb.andWhere('(p.title LIKE :like OR p.statement_md LIKE :like)', { like });
    }
    if (query.status?.length) qb.andWhere('p.status IN (:...status)', { status: query.status });
    if (query.difficulty?.length) qb.andWhere('p.difficulty IN (:...difficulty)', { difficulty: query.difficulty });
    if (query.topic?.trim()) qb.andWhere('JSON_SEARCH(p.topic_tags, "one", :topic) IS NOT NULL', { topic: query.topic.trim() });
    if (query.competency?.length) {
      qb.andWhere(
        new Brackets((sub) => {
          query.competency!.forEach((tag, index) => {
            const tagParam = `pbCompTag${index}`;
            const searchParam = `pbCompSearch${index}`;
            const likeParam = `pbCompLike${index}`;
            const normalized = tag.trim();
            sub.orWhere(
              `(JSON_CONTAINS(p.topic_tags, :${tagParam}) OR JSON_SEARCH(p.topic_tags, 'one', :${searchParam}) IS NOT NULL OR LOWER(CAST(p.topic_tags AS CHAR)) LIKE :${likeParam} OR p.title LIKE :${likeParam} OR p.statement_md LIKE :${likeParam})`,
              {
                [tagParam]: JSON.stringify(normalized),
                [searchParam]: normalized,
                [likeParam]: `%${normalized}%`,
              },
            );
          });
        }),
      );
    }
    qb.orderBy('p.created_at', 'DESC').take(pageSize).skip((page - 1) * pageSize);
    const [rows, total] = await qb.getManyAndCount();
    const rowIds = rows.map((row) => row.id);
    const countsRaw = rowIds.length
      ? await this.problemCases
          .createQueryBuilder('c')
          .select('c.problem_id', 'problemId')
          .addSelect('COUNT(*)', 'count')
          .where('c.inactive = 0')
          .andWhere('c.problem_id IN (:...rowIds)', { rowIds })
          .groupBy('c.problem_id')
          .getRawMany<{ problemId: string; count: string }>()
      : [];
    const countByProblemId = new Map(countsRaw.map((r) => [String(r.problemId), Number(r.count)]));
    const items = rows.map((row) => ({ ...row, testCaseCount: countByProblemId.get(String(row.id)) ?? 0 }));
    return { items, total, page, page_size: pageSize, total_pages: Math.max(1, Math.ceil(total / pageSize)) };
  }

  async createProblem(actor: JwtUserPayload, body: Partial<ProblemBankProblemMysql> & { language_templates?: Array<{ language_code: string; starter_code?: string; internal_solution?: string }>; test_cases?: Array<Partial<ProblemBankTestCaseMysql>>; }) {
    await this.assertWrite(actor);
    const row = await this.problemBank.save(this.problemBank.create({
      title: body.title ?? 'Untitled Problem',
      statementMd: body.statementMd ?? '',
      difficulty: body.difficulty ?? QuestionBankDifficulty.MEDIUM,
      marks: Number(body.marks ?? 0),
      status: body.status ?? ProblemBankStatus.DRAFT,
      topicTags: body.topicTags ?? null,
      allowedLanguages: body.allowedLanguages ?? null,
      timeLimitMinutes: body.timeLimitMinutes ?? null,
      workspaceType: body.workspaceType ?? 'code',
      evaluationMode: body.evaluationMode ?? 'TESTCASE',
      environmentConfig: body.environmentConfig ?? null,
      evaluationConfig: body.evaluationConfig ?? null,
      hints: body.hints ?? null,
      createdByUserId: actor.sub,
      updatedByUserId: actor.sub,
      inactive: 0,
    }));
    if (body.language_templates?.length) {
      await this.problemLanguageTemplates.save(body.language_templates.map((t) => this.problemLanguageTemplates.create({ problemId: row.id, languageCode: t.language_code, starterCode: t.starter_code ?? null, internalSolution: t.internal_solution ?? null, inactive: 0 })));
    }
    if (body.test_cases?.length) {
      await this.problemCases.save(body.test_cases.map((c, i) => this.problemCases.create({ problemId: row.id, inputValue: c.inputValue ?? '', expectedOutput: c.expectedOutput ?? '', isVisible: c.isVisible ?? 1, isHidden: c.isHidden ?? 0, isEdgeCase: c.isEdgeCase ?? 0, description: c.description ?? null, sortOrder: i, inactive: 0 })));
    }
    await this.createProblemVersion(row.id, actor.sub, 'Initial draft');
    return row;
  }


  async verifyProblemDraft(actor: JwtUserPayload, body: { language: string; sourceCode: string; testCases: any[]; environmentConfig?: any }) {
    await this.assertWrite(actor);
    const { language, sourceCode, testCases, environmentConfig } = body;
    
    if (!language || !sourceCode || !Array.isArray(testCases)) {
      throw new BadRequestException('language, sourceCode, and testCases are required');
    }

    // Mock QuestionEvaluationInput
    const questionMock = {
      questionId: 'draft',
      title: 'Draft',
      marks: 10,
    };

    // Format testCases to match what EvaluationService expects
    const formattedTestCases = testCases.map((tc, index) => ({
      id: tc.id || `tc-${index}`,
      input: tc.inputValue || tc.input || '',
      expectedOutput: tc.expectedOutput || '',
    }));

    // Call EvaluationService
    const result = await this.evaluation.evaluateQuestion(
      questionMock,
      language,
      sourceCode,
      formattedTestCases as any,
      environmentConfig
    );

    return result;
  }

  async updateProblem(actor: JwtUserPayload, id: string, body: Partial<ProblemBankProblemMysql>) {
    await this.assertWrite(actor);
    const row = await this.problemBank.findOne({ where: { id, inactive: 0 } });
    if (!row) throw new NotFoundException('Problem not found');
    Object.assign(row, body, { updatedByUserId: actor.sub });
    const saved = await this.problemBank.save(row);
    await this.createProblemVersion(saved.id, actor.sub, 'Problem updated');
    return saved;
  }

  async upsertProblemTestCases(actor: JwtUserPayload, problemId: string, testCases: Array<Partial<ProblemBankTestCaseMysql>>) {
    await this.assertWrite(actor);
    await this.problemCases.update({ problemId }, { inactive: 1 });
    const rows = await this.problemCases.save(testCases.map((c, i) => this.problemCases.create({ problemId, inputValue: c.inputValue ?? '', expectedOutput: c.expectedOutput ?? '', isVisible: c.isVisible ?? 1, isHidden: c.isHidden ?? 0, isEdgeCase: c.isEdgeCase ?? 0, description: c.description ?? null, sortOrder: i, inactive: 0 })));
    await this.createProblemVersion(problemId, actor.sub, 'Test cases updated');
    return rows;
  }

  async archiveProblemBank(actor: JwtUserPayload, id: string) {
    await this.assertWrite(actor);
    const row = await this.problemBank.findOne({ where: { id, inactive: 0 } });
    if (!row) throw new NotFoundException('Problem not found');
    row.status = ProblemBankStatus.ARCHIVED;
    row.updatedByUserId = actor.sub;
    await this.problemBank.save(row);
    await this.createProblemVersion(row.id, actor.sub, 'Archived');
    return row;
  }

  async validateProblemForPublish(actor: JwtUserPayload, problemId: string) {
    await this.assertWrite(actor);
    const problem = await this.problemBank.findOne({ where: { id: problemId, inactive: 0 } });
    if (!problem) throw new NotFoundException('Problem not found');

    const isDatabase = (problem.topicTags || []).some(t => t.toLowerCase().includes('database') || t.toLowerCase().includes('sql')) || problem.title.toLowerCase().includes('sql');

    const cases = await this.problemCases.find({ where: { problemId, inactive: 0 } });
    if (!isDatabase && !cases.length) {
      throw new BadRequestException('At least one test case is required');
    }

    const templates = await this.problemLanguageTemplates.find({ where: { problemId, inactive: 0 } });
    if (!templates.length) throw new BadRequestException('At least one language template is required');

    await this.problemBank.update({ id: problemId, inactive: 0 }, { status: ProblemBankStatus.PUBLISHED });
    await this.createProblemVersion(problemId, actor.sub, 'Published');
    return { valid: true };
  }

  async getProblemDetail(actor: JwtUserPayload, problemId: string) {
    await this.assertWrite(actor);
    const problem = await this.problemBank.findOne({ where: { id: problemId, inactive: 0 } });
    if (!problem) throw new NotFoundException('Problem not found');
    const [testCases, languageTemplates] = await Promise.all([
      this.problemCases.find({ where: { problemId, inactive: 0 }, order: { sortOrder: 'ASC' } }),
      this.problemLanguageTemplates.find({ where: { problemId, inactive: 0 }, order: { languageCode: 'ASC' } }),
    ]);
    return { ...problem, test_cases: testCases, language_templates: languageTemplates };
  }

  async listProblemVersions(actor: JwtUserPayload, problemId: string) {
    await this.assertWrite(actor);
    return this.problemVersions.find({ where: { problemId, inactive: 0 }, order: { versionNumber: 'DESC' } });
  }

  async snapshotInterviewRoundContent(actor: JwtUserPayload, body: { job_application_id: string; lead_id?: string; items: Array<{ stage_id?: string; question_id?: string; question_version_number?: number; problem_id?: string; problem_version_number?: number; payload: Record<string, unknown>; }>; }) {
    await this.assertWrite(actor);
    const qRows = body.items.filter((i) => i.question_id).map((i) =>
      this.questionSnapshots.create({
        jobApplicationId: body.job_application_id,
        leadId: body.lead_id ?? null,
        stageId: i.stage_id ?? null,
        questionId: i.question_id ?? null,
        questionVersionNumber: i.question_version_number ?? null,
        snapshotJson: i.payload,
        inactive: 0,
      }),
    );
    const pRows = body.items.filter((i) => i.problem_id).map((i) =>
      this.problemSnapshots.create({
        jobApplicationId: body.job_application_id,
        leadId: body.lead_id ?? null,
        stageId: i.stage_id ?? null,
        problemId: i.problem_id ?? null,
        problemVersionNumber: i.problem_version_number ?? null,
        snapshotJson: i.payload,
        inactive: 0,
      }),
    );
    if (qRows.length) await this.questionSnapshots.save(qRows);
    if (pRows.length) await this.problemSnapshots.save(pRows);
    return { question_items: qRows.length, problem_items: pRows.length };
  }

  async getInterviewRoundSnapshot(actor: JwtUserPayload, jobApplicationId: string) {
    await this.assertWrite(actor);
    const [questions, problems] = await Promise.all([
      this.questionSnapshots.find({ where: { jobApplicationId, inactive: 0 }, order: { createdAt: 'ASC' } }),
      this.problemSnapshots.find({ where: { jobApplicationId, inactive: 0 }, order: { createdAt: 'ASC' } }),
    ]);
    return { questions, problems };
  }

  async aiQuestionGenerator(
    actor: JwtUserPayload,
    body: {
      competency?: string;
      competency_name?: string;
      competency_description?: string;
      competency_rubric_criteria?: string;
      difficulty?: string;
      question_type?: string;
      question_types?: string[];
      count?: number;
      question_count?: number;
      seniority_level?: string;
      job_role?: string;
      job_profile_id?: string;
      industry_domain?: string;
      tech_stack?: string;
      additional_context?: string;
    },
  ) {
    await this.assertWrite(actor);
    return this.ai.generateQuestionBankQuestions({
      question_count: Number(body.question_count ?? body.count ?? 3),
      job_role: body.job_role ?? 'General Role',
      competency_name: body.competency_name ?? body.competency ?? 'General competency',
      competency_description: body.competency_description,
      competency_rubric_criteria: body.competency_rubric_criteria,
      seniority_level: body.seniority_level ?? 'MID-LEVEL',
      question_type: body.question_type,
      question_types: body.question_types,
      industry_domain: body.industry_domain,
      tech_stack: body.tech_stack,
      additional_context: body.additional_context,
      difficulty: body.difficulty,
      job_profile_id: body.job_profile_id,
    });
  }

  async aiProblemGenerator(
    actor: JwtUserPayload,
    body: {
      generator?: 'coding' | 'database';
      topic_tag: string;
      problem_pattern?: string;
      difficulty?: string;
      job_profile_id?: string;
      job_role?: string;
      competency_name?: string;
      competency_description?: string;
      seniority_level?: string;
      industry_domain?: string;
      tech_stack?: string;
      allowed_languages?: string[];
      database_type?: string;
      constraints?: {
        input_size?: string;
        value_range?: string;
        memory_mb?: number;
        time_limit_ms?: number;
      };
      seed_options?: { random_seed?: number; size?: 'small' | 'medium' | 'large' };
      requires_sandbox_database?: boolean;
      generate?: {
        problem_statement?: boolean;
        starter_code?: boolean;
        internal_solution?: boolean;
        test_cases?: boolean;
        complexity_analysis?: boolean;
        hints?: boolean;
        database_schema?: boolean;
        seed_data?: boolean;
        entity_descriptions?: boolean;
        relationships?: boolean;
        sql_queries?: boolean;
      };
    },
  ) {
    await this.assertWrite(actor);
    return this.ai.generateAssessmentDraft(body);
  }

  async aiDatabaseGenerator(actor: JwtUserPayload, body: Record<string, unknown>) {
    await this.assertWrite(actor);
    return this.ai.generateDatabaseAssessmentDraft(body as never);
  }

  async getBankAnalytics(actor: JwtUserPayload) {
    await this.assertWrite(actor);
    const [questionCount, publishedQuestions, lowSignal, problemCount, publishedProblems, retiredProblems] = await Promise.all([
      this.questionBank.count({ where: { inactive: 0 } }),
      this.questionBank.count({ where: { inactive: 0, status: QuestionBankStatus.PUBLISHED } }),
      this.questionBank.count({ where: { inactive: 0, lowSignalFlag: 1 } }),
      this.problemBank.count({ where: { inactive: 0 } }),
      this.problemBank.count({ where: { inactive: 0, status: ProblemBankStatus.PUBLISHED } }),
      this.problemBank.count({ where: { inactive: 0, status: ProblemBankStatus.RETIRED } }),
    ]);
    return {
      questions: { total: questionCount, published: publishedQuestions, low_signal_flagged: lowSignal },
      problems: { total: problemCount, published: publishedProblems, retired: retiredProblems },
    };
  }

  private async createQuestionVersion(questionId: string, userId: string, summary: string) {
    const row = await this.questionBank.findOne({ where: { id: questionId, inactive: 0 } });
    if (!row) return;
    const latest = await this.questionVersions.findOne({ where: { questionId, inactive: 0 }, order: { versionNumber: 'DESC' } });
    await this.questionVersions.save(this.questionVersions.create({
      questionId,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      snapshot: row as unknown as Record<string, unknown>,
      changeSummary: summary,
      createdByUserId: userId,
      inactive: 0,
    }));
  }

  private async createProblemVersion(problemId: string, userId: string, summary: string) {
    const row = await this.problemBank.findOne({ where: { id: problemId, inactive: 0 } });
    if (!row) return;
    const [testCases, templates] = await Promise.all([
      this.problemCases.find({ where: { problemId, inactive: 0 }, order: { sortOrder: 'ASC' } }),
      this.problemLanguageTemplates.find({ where: { problemId, inactive: 0 } }),
    ]);
    const latest = await this.problemVersions.findOne({ where: { problemId, inactive: 0 }, order: { versionNumber: 'DESC' } });
    await this.problemVersions.save(this.problemVersions.create({
      problemId,
      versionNumber: (latest?.versionNumber ?? 0) + 1,
      snapshot: { ...row, test_cases: testCases, language_templates: templates } as unknown as Record<string, unknown>,
      changeSummary: summary,
      createdByUserId: userId,
      inactive: 0,
    }));
  }
}
