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
import { AutonomousInterviewRepository } from '../autonomous-interview/autonomous-interview.repository';
import {
  AutonomousInterviewPhase,
  CandidateAutonomousInterviewMysql,
} from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import { CandidateMysql } from '../assessment-execution/entities/candidate.mysql.entity';
import {
  AssessmentTemplateMysql,
  AssessmentTemplateStatus,
} from '../assessment-platform/assessment-engine/entities/assessment-template.mysql.entity';
import {
  JobProfileMysql,
  JobProfileStatus,
  JobLocationMode,
} from './entities/job-profile.mysql.entity';
import {
  JobStageMode,
  JobStageType,
  JobProfileStageMysql,
} from './entities/job-profile-stage.mysql.entity';
import { CompetencyCategory } from './entities/job-profile-competency.mysql.entity';
import { JobQuestionKind } from './entities/job-profile-question.mysql.entity';
import { JobApplicationStatus } from './entities/job-application.mysql.entity';
import { JobProfilesRepository } from './job-profiles.repository';
import {
  normalizeAiScreeningRoundConfig,
  validateAiScreeningStages,
} from './ai-screening-round.types';
import {
  normalizeProjectInterviewRoundConfig,
  validateProjectInterviewStages,
} from './project-interview-round.types';
import {
  generateInterviewToken,
  seniorityToDifficulty,
  slugifyTitle,
} from './job-profiles.util';
import { normalizeRubricQuestionPlan } from './rubric-question-plan';
import { firstInterviewStage, resolveInitialInterviewPhase } from './interview-phase.util';
import { verbalBudgetSaveError } from './verbal-interview-budget';
import { TakeHomeOrchestratorService } from '../take-home/take-home-orchestrator.service';
import { RoundSnapshotService } from '../assessment-reports/round-snapshot.service';

const DEFAULT_STAGES: Array<Partial<JobProfileStageMysql>> = [
  {
    stageKey: 'initial_screen',
    name: 'Initial Screen',
    description: 'Automated CV scan and baseline competency check.',
    sortOrder: 0,
    mode: JobStageMode.AI_LED,
    mandatory: 1,
    stageType: JobStageType.SCREENING,
  },
  {
    stageKey: 'technical_assessment',
    name: 'AI-First Technical Assessment',
    description: 'System-generated coding challenge based on job profile.',
    sortOrder: 1,
    mode: JobStageMode.AI_LED,
    mandatory: 1,
    stageType: JobStageType.CODING,
  },
  {
    stageKey: 'hr_panel',
    name: 'Final HR Panel',
    description: 'Culture fit and salary negotiation.',
    sortOrder: 2,
    mode: JobStageMode.HUMAN_LED,
    mandatory: 1,
    stageType: JobStageType.HR_VERBAL,
  },
];

@Injectable()
export class JobProfilesService {
  constructor(
    private readonly repo: JobProfilesRepository,
    private readonly rbac: RbacPermissionService,
    private readonly interviewRepo: AutonomousInterviewRepository,
    @InjectRepository(CandidateMysql)
    private readonly candidates: Repository<CandidateMysql>,
    @InjectRepository(AssessmentTemplateMysql)
    private readonly templates: Repository<AssessmentTemplateMysql>,
    @Inject(forwardRef(() => TakeHomeOrchestratorService))
    private readonly takeHomeOrchestrator: TakeHomeOrchestratorService,
    private readonly roundSnapshots: RoundSnapshotService,
  ) {}

  private async assertWrite(actor: JwtUserPayload) {
    const ok = await this.rbac.hasPermission(actor, 'job_profiles:write');
    if (!ok) {
      const fallback = await this.rbac.hasPermission(actor, 'assessments:write');
      if (!fallback) throw new ForbiddenException();
    }
  }

  private async assertRead(actor: JwtUserPayload) {
    const ok = await this.rbac.hasPermission(actor, 'job_profiles:read');
    if (!ok) {
      const fallback = await this.rbac.hasPermission(actor, 'assessments:read');
      if (!fallback) throw new ForbiddenException();
    }
  }

  serializeProfile(row: JobProfileMysql) {
    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      department: row.department,
      seniority_level: row.seniorityLevel,
      employment_type: row.employmentType,
      openings_count: row.openingsCount,
      responsibilities: row.responsibilities ?? [],
      required_skills: row.requiredSkills ?? [],
      nice_to_have_skills: row.niceToHaveSkills ?? [],
      experience_min: row.experienceMin != null ? Number(row.experienceMin) : null,
      experience_max: row.experienceMax != null ? Number(row.experienceMax) : null,
      compensation_band_min:
        row.compensationBandMin != null ? Number(row.compensationBandMin) : null,
      compensation_band_max:
        row.compensationBandMax != null ? Number(row.compensationBandMax) : null,
      currency: row.currency,
      location_mode: row.locationMode,
      location_text: row.locationText,
      language_required: row.languageRequired,
      owner_user_id: row.ownerUserId,
      hiring_manager_user_id: row.hiringManagerUserId,
      status: row.status,
      assessment_template_id: row.assessmentTemplateId,
      autonomous_interview_config: row.autonomousInterviewConfig,
      candidate_facing_intro: row.candidateFacingIntro,
      compliance_config: row.complianceConfig,
      threshold_config: row.thresholdConfig,
      progression_config: row.progressionConfig,
      notification_config: row.notificationConfig,
      field_permissions: row.fieldPermissions,
      candidate_faq: row.candidateFaq ?? [],
      ai_metadata: row.aiMetadata,
      version: row.version,
      published_at: row.publishedAt?.toISOString() ?? null,
      created_at: row.createdAt?.toISOString(),
      updated_at: row.updatedAt?.toISOString(),
    };
  }

  async list(
    actor: JwtUserPayload,
    opts: { search?: string; status?: string; department?: string; page?: number; pageSize?: number },
  ) {
    await this.assertRead(actor);
    const page = Math.max(1, opts.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));
    const [rows, total] = await this.repo.listProfiles({
      search: opts.search,
      status: opts.status,
      department: opts.department,
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    const items = await Promise.all(
      rows.map(async (row) => {
        const pipeline = await this.buildPipelineSummary(row.id);
        return { ...this.serializeProfile(row), pipeline };
      }),
    );

    return { items, total, page, pageSize };
  }

  /** Public: returns only active/configured profiles (id + title). No auth. */
  async listPublished() {
    const [rows] = await this.repo.listProfiles({
      status: 'active',
      limit: 200,
      offset: 0,
    });
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
      })),
    };
  }

  async get(actor: JwtUserPayload, id: string) {
    await this.assertRead(actor);
    const row = await this.repo.requireById(id);
    const [stages, competencies, questions] = await Promise.all([
      this.repo.listStages(id),
      this.repo.listCompetencies(id),
      this.repo.listQuestions(id),
    ]);
    return {
      profile: this.serializeProfile(row),
      stages: stages.map((s) => this.serializeStage(s)),
      competencies: competencies.map((c) => this.serializeCompetency(c)),
      questions: questions.map((q) => this.serializeQuestion(q)),
    };
  }

  async inviteLeadToInterview(
    actor: JwtUserPayload,
    profileId: string,
    body: {
      lead_id: string;
      first_name: string;
      last_name?: string;
      email: string;
      phone?: string;
      resume_url?: string;
      experience_years?: number;
      skills?: string[];
      projects_summary?: string;
      experience_summary?: string;
      education_summary?: string;
    },
  ) {
    await this.assertWrite(actor);
    const profile = await this.repo.requireById(profileId);
    if (profile.status !== JobProfileStatus.ACTIVE) {
      throw new BadRequestException('Job profile must be active to invite candidates');
    }
    if (!body.first_name?.trim() || !body.email?.trim()) {
      throw new BadRequestException('Candidate name and email are required');
    }

    const email = body.email.trim().toLowerCase();
    let candidate = await this.candidates.findOne({
      where: { email, inactive: 0 },
    });
    const skills =
      body.skills?.length ? body.skills : profile.requiredSkills ?? [];

    if (!candidate) {
      candidate = await this.candidates.save(
        this.candidates.create({
          firstName: body.first_name.trim(),
          lastName: body.last_name?.trim() ?? null,
          email,
          phone: body.phone?.trim() ?? null,
          experienceYears:
            body.experience_years != null
              ? String(body.experience_years)
              : null,
          skills,
          projectsSummary: body.projects_summary?.trim() ?? null,
          experienceSummary: body.experience_summary?.trim() ?? null,
          educationSummary: body.education_summary?.trim() ?? null,
          resumeUrl: body.resume_url?.trim() ?? null,
          status: 'ACTIVE',
        }),
      );
    } else {
      candidate.firstName = body.first_name.trim();
      if (body.last_name !== undefined) {
        candidate.lastName = body.last_name?.trim() ?? null;
      }
      if (body.phone) candidate.phone = body.phone.trim();
      if (body.resume_url) candidate.resumeUrl = body.resume_url.trim();
      if (body.experience_years != null) {
        candidate.experienceYears = String(body.experience_years);
      }
      if (body.projects_summary !== undefined) candidate.projectsSummary = body.projects_summary?.trim() ?? null;
      if (body.experience_summary !== undefined) candidate.experienceSummary = body.experience_summary?.trim() ?? null;
      if (body.education_summary !== undefined) candidate.educationSummary = body.education_summary?.trim() ?? null;
      if (skills.length) candidate.skills = skills;
      await this.candidates.save(candidate);
    }

    const sourceStr = `lead:${body.lead_id.trim()}`;
    const existingApp = await this.repo.findApplicationByProfileAndCandidate(
      profile.id,
      candidate.id,
      sourceStr,
    );
    if (existingApp?.candidateToken) {
      return {
        application_token: existingApp.candidateToken,
        interview_url: `/autonomous-interview/${existingApp.candidateToken}`,
        candidate_id: candidate.id,
        reused: true,
      };
    }

    const stages = await this.repo.listStages(profile.id);
    const firstStage = stages[0];
    const token = generateInterviewToken();
    const config = profile.autonomousInterviewConfig ?? {};

    await this.interviewRepo.createSeed({
      candidateToken: token,
      jobProfileId: profile.id,
      isPreview: 0,
      currentPhase: AutonomousInterviewPhase.INTRO_VERBAL,
      techStack:
        (config.tech_stack as string) ?? profile.requiredSkills?.[0] ?? 'General',
      resumeSkills: candidate.skills ?? profile.requiredSkills ?? [],
    } as Partial<CandidateAutonomousInterviewMysql>);

    const savedApp = await this.repo.saveApplication({
      jobProfileId: profile.id,
      candidateId: candidate.id,
      status: JobApplicationStatus.IN_PROGRESS,
      currentStageId: firstStage?.id ?? null,
      candidateToken: token,
      source: `lead:${body.lead_id.trim()}`,
      scoredVersionId: String(profile.version),
      stageEnteredAt: new Date(),
    });
    await this.roundSnapshots.freezeAssignedPipeline(String(savedApp.id));

    return {
      application_token: token,
      interview_url: `/autonomous-interview/${token}`,
      candidate_id: candidate.id,
      reused: false,
    };
  }

  async create(
    actor: JwtUserPayload,
    body: { title: string; department?: string },
  ) {
    await this.assertWrite(actor);
    const title = body.title?.trim();
    if (!title) throw new BadRequestException('title is required');

    const baseSlug = slugifyTitle(title);
    let slug = `${baseSlug}-${Date.now().toString(36)}`;
    if (await this.repo.findBySlug(slug)) {
      slug = `${baseSlug}-${Date.now().toString(36)}`;
    }

    const profile = await this.repo.saveProfile({
      slug,
      title,
      department: body.department?.trim() ?? null,
      ownerUserId: actor.sub,
      status: JobProfileStatus.DRAFT,
      openingsCount: 1,
      locationMode: JobLocationMode.HYBRID,
      currency: 'INR',
      autonomousInterviewConfig: {
        tech_stack: title.split(' ')[0] ?? 'General',
        intro_min_turns: 8,
        intro_max_turns: 15,
      },
    });

    await this.repo.saveStages(
      DEFAULT_STAGES.map((s) => ({ ...s, jobProfileId: profile.id, inactive: 0 })),
    );

    return this.get(actor, profile.id);
  }

  async updateBasics(actor: JwtUserPayload, id: string, body: Record<string, unknown>) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(id);
    const patch: Partial<JobProfileMysql> = {};
    if (typeof body.title === 'string') {
      patch.title = body.title.trim();
    }
    if (typeof body.department === 'string') patch.department = body.department;
    if (typeof body.seniority_level === 'string') patch.seniorityLevel = body.seniority_level;
    if (typeof body.employment_type === 'string') patch.employmentType = body.employment_type;
    if (typeof body.openings_count === 'number') patch.openingsCount = body.openings_count;
    if (typeof body.location_mode === 'string') {
      patch.locationMode = body.location_mode as JobLocationMode;
    }
    if (typeof body.location_text === 'string') patch.locationText = body.location_text;
    if (typeof body.language_required === 'string') patch.languageRequired = body.language_required;
    if (typeof body.owner_user_id === 'string') patch.ownerUserId = body.owner_user_id;
    if (typeof body.hiring_manager_user_id === 'string') {
      patch.hiringManagerUserId = body.hiring_manager_user_id;
    }
    if (typeof body.compensation_band_min === 'number') {
      patch.compensationBandMin = String(body.compensation_band_min);
    }
    if (typeof body.compensation_band_max === 'number') {
      patch.compensationBandMax = String(body.compensation_band_max);
    }
    if (typeof body.currency === 'string') patch.currency = body.currency;
    if (typeof body.candidate_facing_intro === 'string') {
      patch.candidateFacingIntro = body.candidate_facing_intro;
    }
    await this.repo.patchProfile(id, patch);
    return this.get(actor, id);
  }

  async updateJd(actor: JwtUserPayload, id: string, body: Record<string, unknown>) {
    await this.assertWrite(actor);
    await this.repo.requireById(id);
    const patch: Partial<JobProfileMysql> = {};
    if (Array.isArray(body.responsibilities)) {
      patch.responsibilities = body.responsibilities.filter((x) => typeof x === 'string');
    }
    if (Array.isArray(body.required_skills)) {
      patch.requiredSkills = body.required_skills.filter((x) => typeof x === 'string');
    }
    if (Array.isArray(body.nice_to_have_skills)) {
      patch.niceToHaveSkills = body.nice_to_have_skills.filter((x) => typeof x === 'string');
    }
    if (body.experience_min != null) patch.experienceMin = String(body.experience_min);
    if (body.experience_max != null) patch.experienceMax = String(body.experience_max);
    await this.repo.patchProfile(id, patch);
    return this.get(actor, id);
  }

  async updateStages(
    actor: JwtUserPayload,
    id: string,
    stages: Array<Record<string, unknown>>,
  ) {
    await this.assertWrite(actor);
    await this.repo.requireById(id);
    const seenKeys = new Set<string>();
    const payload = stages.map((s, i) => {
      let key = String(s.stage_key ?? `stage_${i}`);
      if (seenKeys.has(key)) {
        key = `${key}_dup_${Date.now()}_${i}`;
      }
      seenKeys.add(key);
      return {
        stageKey: key,
        name: String(s.name ?? `Stage ${i + 1}`),
        description: typeof s.description === 'string' ? s.description : null,
        mode: s.mode === 'human_led' ? JobStageMode.HUMAN_LED : JobStageMode.AI_LED,
        mandatory: s.mandatory === false ? 0 : 1,
        stageType: (s.stage_type as JobStageType) ?? JobStageType.CUSTOM,
        skipRules: (s.skip_rules as Record<string, unknown>) ?? null,
        roundConfig: (s.round_config as Record<string, unknown>) ?? null,
      };
    });

    const takeHomeCount = payload.filter((stage) => stage.stageType === JobStageType.TAKE_HOME).length;
    if (takeHomeCount > 1) {
      throw new BadRequestException('Only one take-home assessment stage is allowed per job profile');
    }

    const screeningError = validateAiScreeningStages(
      payload.map((stage, i) => ({
        stageType: stage.stageType,
        sortOrder: i,
        roundConfig:
          stage.stageType === JobStageType.AI_SCREENING
            ? normalizeAiScreeningRoundConfig(stage.roundConfig)
            : stage.roundConfig,
      })),
    );
    if (screeningError) {
      throw new BadRequestException(screeningError);
    }

    const projectInterviewCount = payload.filter(
      (stage) => stage.stageType === JobStageType.PROJECT_INTERVIEW,
    ).length;
    if (projectInterviewCount > 1) {
      throw new BadRequestException('Only one Build & Defend round is allowed per job profile');
    }

    // Normalize AI Screening / Build & Defend round_config before persist
    for (const stage of payload) {
      if (stage.stageType === JobStageType.AI_SCREENING) {
        stage.roundConfig = normalizeAiScreeningRoundConfig(stage.roundConfig) as unknown as Record<
          string,
          unknown
        >;
      } else if (stage.stageType === JobStageType.PROJECT_INTERVIEW) {
        stage.roundConfig = {
          ...(stage.roundConfig ?? {}),
          ...normalizeProjectInterviewRoundConfig(stage.roundConfig),
        } as unknown as Record<string, unknown>;
      }
    }

    // Validate Take-Home Verification eligibility
    for (let i = 0; i < payload.length; i++) {
      const stage = payload[i];
      if (stage.stageType === JobStageType.AI_VERBAL && stage.roundConfig) {
        const budgetError = verbalBudgetSaveError(stage.roundConfig, 0, { requireCoverage: false });
        if (budgetError) {
          throw new BadRequestException(budgetError);
        }
        const rc = stage.roundConfig as any;
        if (rc.include_take_home_verification || (rc.rubrics && rc.rubrics.some((r: any) => r.type === 'take_home_verification'))) {
          // check if previous stage is take_home
          if (i === 0 || payload[i - 1].stageType !== JobStageType.TAKE_HOME) {
            throw new BadRequestException('Take-Home Assessment Verification rubric can only be used if the immediately preceding stage is a Take-Home Assessment.');
          }
        }
      }
    }

    await this.repo.replaceStages(id, payload);
    const saved = await this.repo.listStages(id);
    return saved.map((s) => this.serializeStage(s));
  }

  async reorderStages(actor: JwtUserPayload, id: string, stageIds: string[]) {
    await this.assertWrite(actor);
    const stages = await this.repo.listStages(id);
    const byId = new Map(stages.map((s) => [s.id, s]));
    for (let i = 0; i < stageIds.length; i += 1) {
      const stage = byId.get(stageIds[i]!);
      if (stage) {
        await this.repo.updateStageOrder(stage.id, i);
      }
    }
    return this.repo.listStages(id).then((l) => l.map((s) => this.serializeStage(s)));
  }

  async updateCompetencies(
    actor: JwtUserPayload,
    id: string,
    rows: Array<Record<string, unknown>>,
  ) {
    await this.assertWrite(actor);
    await this.repo.requireById(id);

    const uniqueRows: Array<Record<string, any>> = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const name = String(r.name ?? '').trim();
      const category = r.category === 'soft' ? 'soft' : 'hard';
      const stageId = r.stage_id ? String(r.stage_id) : 'global';
      const key = `${name.toLowerCase()}|${category}|${stageId}`;
      if (!seen.has(key)) {
        seen.add(key);
        uniqueRows.push(r);
      }
    }

    const stages = await this.repo.listStages(id);
    for (const stage of stages) {
      if (stage.stageType !== JobStageType.AI_VERBAL) continue;
      const rubricCount = uniqueRows.filter((row) => String(row.stage_id ?? '') === String(stage.id)).length;
      const budgetError = verbalBudgetSaveError(stage.roundConfig, rubricCount);
      if (budgetError) {
        throw new BadRequestException(budgetError);
      }
    }

    const saved = await this.repo.replaceCompetencies(
      id,
      uniqueRows.map((r, i) => ({
        name: String(r.name ?? `Competency ${i + 1}`),
        category:
          r.category === 'soft' ? CompetencyCategory.SOFT : CompetencyCategory.HARD,
        targetScore: r.target_score != null ? String(r.target_score) : '8.0',
        weightPct: r.weight_pct != null ? String(r.weight_pct) : '0',
        stageId: r.stage_id ? String(r.stage_id) : null,
        sortOrder: i,
        questionPlan: this.questionPlanForSave(r.question_plan, String(r.name ?? `Competency ${i + 1}`)),
      })),
    );
    return saved.map((c) => this.serializeCompetency(c));
  }

  async updateQuestions(
    actor: JwtUserPayload,
    id: string,
    rows: Array<Record<string, unknown>>,
  ) {
    await this.assertWrite(actor);
    await this.repo.requireById(id);
    const saved = await this.repo.replaceQuestions(
      id,
      rows.map((r, i) => ({
        stageId: r.stage_id != null ? String(r.stage_id) : null,
        kind: (r.kind as JobQuestionKind) ?? JobQuestionKind.MANUAL,
        prompt: String(r.prompt ?? ''),
        metadata: (r.metadata as Record<string, unknown>) ?? null,
        sortOrder: i,
      })),
    );
    return saved.map((q) => this.serializeQuestion(q));
  }

  async clone(actor: JwtUserPayload, id: string) {
    await this.assertWrite(actor);
    const { profile, stages, competencies, questions } = await this.get(actor, id);
    const created = await this.create(actor, {
      title: `${profile.title} (copy)`,
      department: profile.department ?? undefined,
    });
    await this.updateBasics(actor, created.profile.id, profile);
    await this.updateJd(actor, created.profile.id, profile);
    await this.updateStages(actor, created.profile.id, stages);
    await this.updateCompetencies(actor, created.profile.id, competencies);
    await this.updateQuestions(actor, created.profile.id, questions);
    return this.get(actor, created.profile.id);
  }

  async setStatus(actor: JwtUserPayload, id: string, status: JobProfileStatus) {
    await this.assertWrite(actor);
    const patch: Partial<JobProfileMysql> = { status };
    if (status === JobProfileStatus.ACTIVE) {
      patch.publishedAt = new Date();
    }
    await this.repo.patchProfile(id, patch);
    return this.get(actor, id);
  }

  async publish(actor: JwtUserPayload, id: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(id);
    const compliance = (row.complianceConfig ?? {}) as { approval_required?: boolean };
    if (compliance.approval_required) {
      throw new BadRequestException(
        'This profile requires approval before going live. Use submit-for-approval.',
      );
    }
    const stages = await this.repo.listStages(id);
    if (!stages.length) throw new BadRequestException('At least one stage is required');
    const projectInterviewError = validateProjectInterviewStages(stages);
    if (projectInterviewError) throw new BadRequestException(projectInterviewError);
    const competencies = await this.repo.listCompetencies(id);
    if (!competencies.length) {
      throw new BadRequestException('At least one competency is required');
    }
    for (const stage of stages) {
      if (stage.stageType !== JobStageType.AI_VERBAL) continue;
      const rubricCount = competencies.filter((row) => String(row.stageId ?? '') === String(stage.id)).length;
      const budgetError = verbalBudgetSaveError(stage.roundConfig, rubricCount);
      if (budgetError) {
        throw new BadRequestException(budgetError);
      }
    }

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

    const config = {
      ...(row.autonomousInterviewConfig ?? {}),
      tech_stack:
        (row.autonomousInterviewConfig?.tech_stack as string) ??
        row.requiredSkills?.[0] ??
        'General',
      job_profile_id: id,
    };

    await this.repo.patchProfile(id, {
      status: JobProfileStatus.ACTIVE,
      publishedAt: new Date(),
      assessmentTemplateId: templateId,
      autonomousInterviewConfig: config,
      version: row.version + 1,
    });

    return this.get(actor, id);
  }

  async archive(actor: JwtUserPayload, id: string) {
    return this.setStatus(actor, id, JobProfileStatus.ARCHIVED);
  }

  async reopen(actor: JwtUserPayload, id: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(id);
    if (row.status !== JobProfileStatus.CLOSED && row.status !== JobProfileStatus.ARCHIVED) {
      throw new BadRequestException('Only closed or archived profiles can be reopened');
    }
    return this.setStatus(actor, id, JobProfileStatus.ACTIVE);
  }

  async delete(actor: JwtUserPayload, id: string) {
    await this.assertWrite(actor);
    await this.repo.patchProfile(id, { inactive: 1 });
    return { ok: true };
  }

  async getPipeline(actor: JwtUserPayload, id: string) {
    await this.assertRead(actor);
    return this.buildPipelineSummary(id);
  }

  async getAnalytics(actor: JwtUserPayload, id: string, days?: number) {
    await this.assertRead(actor);
    const profile = await this.repo.requireById(id);
    const stages = await this.repo.listStages(id);
    const allApps = await this.repo.listApplications(id);
    const competencies = await this.repo.listCompetencies(id);

    const cutoff = days ? new Date(Date.now() - days * 86400000) : null;
    const apps = cutoff ? allApps.filter((a) => a.appliedAt && a.appliedAt >= cutoff) : allApps;

    const byStage = await this.repo.countApplicationsByStage(id);
    const stageMap = new Map(byStage.map((r) => [r.stageId, Number(r.count)]));

    const funnel = stages.map((s) => {
      const stageCount = cutoff
        ? apps.filter((a) => a.currentStageId === s.id).length
        : stageMap.get(s.id) ?? 0;
      return {
        stage_id: s.id,
        name: s.name,
        count: stageCount,
      };
    });

    const totalApps = apps.length;
    const hired = apps.filter((a) => a.status === JobApplicationStatus.HIRED).length;
    const rejected = apps.filter((a) => a.status === JobApplicationStatus.REJECTED).length;
    const rubricComplete = competencies.length > 0;
    const healthScore = Math.min(
      100,
      Math.round(
        (profile.status === JobProfileStatus.ACTIVE ? 30 : 10) +
          (rubricComplete ? 25 : 0) +
          (stages.length >= 2 ? 20 : 5) +
          (totalApps > 0 ? 25 : 0),
      ),
    );

    return {
      health_score: healthScore,
      alignment_score: rubricComplete ? 88 : 45,
      fairness_index: 92,
      funnel,
      totals: {
        applications: totalApps,
        hired,
        rejected,
        in_progress: apps.filter((a) => a.status === JobApplicationStatus.IN_PROGRESS).length,
      },
      insights: [
        {
          type: 'info',
          title: 'Profile readiness',
          message: rubricComplete
            ? 'Rubric and stages are configured.'
            : 'Add competencies before going live for stronger scoring.',
        },
      ],
    };
  }

  async createPreviewSession(actor: JwtUserPayload, id: string, stageId?: string) {
    await this.assertWrite(actor);
    const profile = await this.repo.requireById(id);
    const token = generateInterviewToken();
    const config = profile.autonomousInterviewConfig ?? {};
    const techStack =
      (config.tech_stack as string) ?? profile.requiredSkills?.[0] ?? 'General';

    // Figure out the correct phase to start based on requested stage or first interview stage
    const stages = await this.repo.listStages(id);
    const targetStage = stageId
      ? stages.find((s) => String(s.id) === String(stageId))
      : firstInterviewStage(stages) ?? stages[0];
    let startPhase = targetStage
      ? resolveInitialInterviewPhase([targetStage])
      : AutonomousInterviewPhase.INTRO_VERBAL;

    await this.interviewRepo.createSeed({
      candidateToken: token,
      jobProfileId: id,
      isPreview: 1,
      currentPhase: startPhase,
      techStack,
      resumeSkills: profile.requiredSkills ?? [],
      proctorSummary: targetStage
        ? {
            stageId: String(targetStage.id),
            stageType: targetStage.stageType,
            isBehavioral: targetStage.stageType === 'hr_verbal',
          }
        : undefined,
    } as Partial<CandidateAutonomousInterviewMysql>);

    return {
      candidate_token: token,
      interview_url: `/autonomous-interview/${token}`,
      is_preview: true,
    };
  }

  async getPublicProfile(slug: string) {
    const row = await this.repo.requireBySlug(slug);
    if (row.status !== JobProfileStatus.ACTIVE && row.status !== JobProfileStatus.PAUSED) {
      throw new NotFoundException('This role is not accepting applications');
    }
    return {
      slug: row.slug,
      title: row.title,
      department: row.department,
      seniority_level: row.seniorityLevel,
      employment_type: row.employmentType,
      location_mode: row.locationMode,
      location_text: row.locationText,
      language_required: row.languageRequired,
      responsibilities: row.responsibilities ?? [],
      required_skills: row.requiredSkills ?? [],
      nice_to_have_skills: row.niceToHaveSkills ?? [],
      candidate_facing_intro: row.candidateFacingIntro,
    };
  }

  async publicApply(
    slug: string,
    body: {
      first_name: string;
      last_name?: string;
      email: string;
      phone?: string;
      experience_years?: number;
      skills?: string[];
    },
  ) {
    const profile = await this.repo.requireBySlug(slug);
    if (profile.status !== JobProfileStatus.ACTIVE) {
      throw new BadRequestException('This role is not accepting applications');
    }
    if (!body.first_name?.trim() || !body.email?.trim()) {
      throw new BadRequestException('Name and email are required');
    }

    let candidate = await this.candidates.findOne({
      where: { email: body.email.trim().toLowerCase(), inactive: 0 },
    });
    if (!candidate) {
      candidate = await this.candidates.save(
        this.candidates.create({
          firstName: body.first_name.trim(),
          lastName: body.last_name?.trim() ?? null,
          email: body.email.trim().toLowerCase(),
          phone: body.phone ?? null,
          experienceYears:
            body.experience_years != null ? String(body.experience_years) : null,
          skills: body.skills ?? profile.requiredSkills ?? [],
          status: 'ACTIVE',
        }),
      );
    }

    const stages = await this.repo.listStages(profile.id);
    const firstStage = stages[0];
    const token = generateInterviewToken();
    const config = profile.autonomousInterviewConfig ?? {};

    await this.interviewRepo.createSeed({
      candidateToken: token,
      jobProfileId: profile.id,
      isPreview: 0,
      currentPhase: AutonomousInterviewPhase.INTRO_VERBAL,
      techStack:
        (config.tech_stack as string) ?? profile.requiredSkills?.[0] ?? 'General',
      resumeSkills: candidate.skills ?? profile.requiredSkills ?? [],
    } as Partial<CandidateAutonomousInterviewMysql>);

    const savedApp = await this.repo.saveApplication({
      jobProfileId: profile.id,
      candidateId: candidate.id,
      status: JobApplicationStatus.IN_PROGRESS,
      currentStageId: firstStage?.id ?? null,
      candidateToken: token,
      source: 'public_apply',
      scoredVersionId: String(profile.version),
      stageEnteredAt: new Date(),
    });
    await this.roundSnapshots.freezeAssignedPipeline(String(savedApp.id));

    let takeHomeUrl: string | undefined;
    if (firstStage?.stageType === JobStageType.TAKE_HOME && firstStage.id) {
      const submission = await this.takeHomeOrchestrator.assignForApplication(
        savedApp.id,
        firstStage.id,
      );
      if (submission) {
        takeHomeUrl = `/assessments/candidate/take-home/${submission.submissionToken}`;
      }
    }

    return {
      application_token: token,
      interview_url: `/autonomous-interview/${token}`,
      take_home_url: takeHomeUrl,
      candidate_id: candidate.id,
    };
  }

  async exportCsv(actor: JwtUserPayload) {
    await this.assertRead(actor);
    const [rows] = await this.repo.listProfiles({ limit: 5000, offset: 0 });
    const header =
      'id,slug,title,department,status,openings,seniority,employment_type,published_at';
    const lines = rows.map((r) =>
      [
        r.id,
        r.slug,
        JSON.stringify(r.title),
        JSON.stringify(r.department ?? ''),
        r.status,
        r.openingsCount,
        JSON.stringify(r.seniorityLevel ?? ''),
        JSON.stringify(r.employmentType ?? ''),
        r.publishedAt?.toISOString() ?? '',
      ].join(','),
    );
    return { csv: [header, ...lines].join('\n') };
  }

  private async buildPipelineSummary(jobProfileId: string) {
    const stages = await this.repo.listStages(jobProfileId);
    const counts = await this.repo.countApplicationsByStage(jobProfileId);
    const countMap = new Map(counts.map((c) => [c.stageId, Number(c.count)]));
    const segments = stages.map((s) => ({
      stage_id: s.id,
      label: s.name,
      count: countMap.get(s.id) ?? 0,
    }));
    const total = segments.reduce((s, seg) => s + seg.count, 0);
    return { segments, total };
  }

  private serializeStage(s: JobProfileStageMysql) {
    return {
      id: s.id,
      stage_key: s.stageKey,
      name: s.name,
      description: s.description,
      sort_order: s.sortOrder,
      mode: s.mode,
      mandatory: s.mandatory === 1,
      stage_type: s.stageType,
      skip_rules: s.skipRules,
      round_config: s.roundConfig,
    };
  }

  private questionPlanForSave(raw: unknown, rubricName: string): Record<string, unknown> | null {
    if (raw == null) return null;
    try {
      return normalizeRubricQuestionPlan(raw) as unknown as Record<string, unknown>;
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'Invalid question plan.';
      throw new BadRequestException(`${rubricName}: ${detail}`);
    }
  }

  private serializeCompetency(c: {
    id: string;
    name: string;
    category: string;
    targetScore: string | null;
    weightPct: string;
    stageId: string | null;
    sortOrder: number;
    questionPlan?: Record<string, unknown> | null;
  }) {
    return {
      id: c.id,
      name: c.name,
      category: c.category === CompetencyCategory.SOFT ? 'soft' : 'hard',
      target_score: parseFloat(c.targetScore ?? '8'),
      weight_pct: parseFloat(c.weightPct ?? '0'),
      stage_id: c.stageId,
      sort_order: c.sortOrder,
      question_plan: c.questionPlan ?? null,
    };
  }

  private serializeQuestion(q: {
    id: string;
    stageId: string | null;
    kind: string;
    prompt: string;
    sortOrder: number;
    metadata: Record<string, unknown> | null;
  }) {
    return {
      id: q.id,
      stage_id: q.stageId,
      kind: q.kind,
      prompt: q.prompt,
      sort_order: q.sortOrder,
      metadata: q.metadata,
    };
  }
}




