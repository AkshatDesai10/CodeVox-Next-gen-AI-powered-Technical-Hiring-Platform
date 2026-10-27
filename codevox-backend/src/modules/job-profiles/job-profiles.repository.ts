import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { JobProfileMysql, JobProfileStatus } from './entities/job-profile.mysql.entity';
import { JobProfileStageMysql } from './entities/job-profile-stage.mysql.entity';
import { JobProfileCompetencyMysql } from './entities/job-profile-competency.mysql.entity';
import { JobProfileQuestionMysql } from './entities/job-profile-question.mysql.entity';
import { JobApplicationMysql } from './entities/job-application.mysql.entity';

@Injectable()
export class JobProfilesRepository {
  constructor(
    @InjectRepository(JobProfileMysql)
    private readonly profiles: Repository<JobProfileMysql>,
    @InjectRepository(JobProfileStageMysql)
    private readonly stages: Repository<JobProfileStageMysql>,
    @InjectRepository(JobProfileCompetencyMysql)
    private readonly competencies: Repository<JobProfileCompetencyMysql>,
    @InjectRepository(JobProfileQuestionMysql)
    private readonly questions: Repository<JobProfileQuestionMysql>,
    @InjectRepository(JobApplicationMysql)
    private readonly applications: Repository<JobApplicationMysql>,
  ) {}

  findById(id: string) {
    return this.profiles.findOne({ where: { id, inactive: 0 } });
  }

  findBySlug(slug: string) {
    return this.profiles.findOne({ where: { slug, inactive: 0 } });
  }

  async requireById(id: string) {
    const row = await this.findById(id);
    if (!row) throw new NotFoundException('Job profile not found');
    return row;
  }

  async requireBySlug(slug: string) {
    const row = await this.findBySlug(slug);
    if (!row) throw new NotFoundException('Job profile not found');
    return row;
  }

  saveProfile(row: Partial<JobProfileMysql>) {
    if (!row.id || row.id === '0') {
      const ts = Date.now().toString();
      const rand = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
      row.id = ts + rand;
    }
    return this.profiles.save(this.profiles.create(row));
  }

  async updateProfileRaw(id: string, patch: Partial<JobProfileMysql>) {
    await this.profiles.update({ id }, patch as Parameters<Repository<JobProfileMysql>['update']>[1]);
  }

  async patchProfile(id: string, patch: Partial<JobProfileMysql>) {
    await this.profiles.update({ id }, patch as Parameters<Repository<JobProfileMysql>['update']>[1]);
    return this.requireById(id);
  }

  listProfiles(opts: {
    search?: string;
    status?: string;
    department?: string;
    limit?: number;
    offset?: number;
  }) {
    const qb = this.profiles
      .createQueryBuilder('p')
      .where('p.inactive = 0')
      .orderBy('p.updated_at', 'DESC')
      .take(opts.limit ?? 50)
      .skip(opts.offset ?? 0);

    if (opts.status) {
      qb.andWhere('p.status = :status', { status: opts.status });
    }
    if (opts.department) {
      qb.andWhere('p.department = :department', { department: opts.department });
    }
    if (opts.search?.trim()) {
      const like = `%${opts.search.trim()}%`;
      qb.andWhere(
        new Brackets((w) => {
          w.where('p.title LIKE :like', { like })
            .orWhere('p.department LIKE :like', { like })
            .orWhere('p.slug LIKE :like', { like });
        }),
      );
    }
    return qb.getManyAndCount();
  }

  listStages(jobProfileId: string) {
    return this.stages.find({
      where: { jobProfileId, inactive: 0 },
      order: { sortOrder: 'ASC' },
    });
  }

  /**
   * Current rubric set: rows attached to an active round of this profile. Rows left on a
   * removed round are history. Profile-level rows (no round) predate per-round rubrics and
   * count only while no round has its own rubric.
   */
  async listCompetencies(jobProfileId: string) {
    const [rows, activeStages] = await Promise.all([
      this.competencies.find({
        where: { jobProfileId, inactive: 0 },
        order: { sortOrder: 'ASC' },
      }),
      this.listStages(jobProfileId),
    ]);
    const activeStageIds = new Set(activeStages.map((s) => String(s.id)));
    const linked = rows.filter((c) => c.stageId && activeStageIds.has(String(c.stageId)));
    if (linked.length) return linked;
    return rows.filter((c) => !c.stageId);
  }

  listQuestions(jobProfileId: string) {
    return this.questions.find({
      where: { jobProfileId, inactive: 0 },
      order: { sortOrder: 'ASC' },
    });
  }

  listApplications(jobProfileId: string) {
    return this.applications.find({
      where: { jobProfileId, inactive: 0 },
      order: { appliedAt: 'DESC' },
    });
  }

  saveStages(rows: Partial<JobProfileStageMysql>[]) {
    return this.stages.save(rows.map((r) => this.stages.create(r)));
  }

  async replaceStages(jobProfileId: string, rows: Partial<JobProfileStageMysql>[]) {
    const allExisting = await this.stages.find({
      where: { jobProfileId },
      order: { sortOrder: 'ASC' },
    });
    const byKey = new Map(allExisting.map((s) => [s.stageKey, s]));
    const incomingKeys = new Set(rows.map((r) => String(r.stageKey)));

    for (const existing of allExisting) {
      if (existing.inactive === 0 && !incomingKeys.has(existing.stageKey)) {
        await this.stages.update({ id: existing.id }, { inactive: 1 });
      }
    }

    const saved: JobProfileStageMysql[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i]!;
      const key = String(r.stageKey);
      const match = byKey.get(key);
      if (match && String(match.id) !== '0') {
        match.name = String(r.name ?? match.name);
        match.description =
          r.description !== undefined ? (r.description ?? null) : match.description;
        match.mode = r.mode ?? match.mode;
        match.mandatory = r.mandatory ?? match.mandatory;
        match.stageType = r.stageType ?? match.stageType;
        if (r.skipRules !== undefined) {
          match.skipRules = r.skipRules ?? null;
        }
        if (r.roundConfig !== undefined) {
          match.roundConfig = r.roundConfig ?? null;
        }
        match.sortOrder = i;
        match.inactive = 0;
        const updated = await this.stages.save(match);
        saved.push(updated);
      } else {
        const created = await this.stages.save(
          this.stages.create({ ...r, jobProfileId, sortOrder: i, inactive: 0 }),
        );
        saved.push(created);
        byKey.set(key, created);
        
        // If there was a match but its ID was '0', mark it as inactive to clean it up
        if (match) {
          await this.stages.update({ id: match.id, stageKey: match.stageKey }, { inactive: 1 });
        }
      }
    }
    return saved;
  }

  updateStageOrder(id: string, sortOrder: number) {
    return this.stages.update({ id }, { sortOrder });
  }

  async replaceCompetencies(jobProfileId: string, rows: Partial<JobProfileCompetencyMysql>[]) {
    return this.competencies.manager.transaction(async (em) => {
      await em.update(JobProfileCompetencyMysql, { jobProfileId }, { inactive: 1 });
      if (!rows.length) return [];
      return em.save(
        JobProfileCompetencyMysql,
        rows.map((r, i) =>
          em.create(JobProfileCompetencyMysql, { ...r, jobProfileId, sortOrder: i, inactive: 0 }),
        ),
      );
    });
  }

  async replaceQuestions(jobProfileId: string, rows: Partial<JobProfileQuestionMysql>[]) {
    await this.questions.update({ jobProfileId }, { inactive: 1 });
    if (!rows.length) return [];
    return this.questions.save(
      rows.map((r, i) =>
        this.questions.create({ ...r, jobProfileId, sortOrder: i, inactive: 0 }),
      ),
    );
  }

  saveApplication(row: Partial<JobApplicationMysql>) {
    return this.applications.save(this.applications.create(row));
  }

  findApplicationByToken(token: string) {
    return this.applications.findOne({ where: { candidateToken: token, inactive: 0 } });
  }

  findApplicationByProfileAndCandidate(jobProfileId: string, candidateId: string, source?: string) {
    return this.applications.findOne({
      where: { jobProfileId, candidateId, inactive: 0, ...(source ? { source } : {}) },
      order: { appliedAt: 'DESC' },
    });
  }

  countApplicationsByStage(jobProfileId: string) {
    return this.applications
      .createQueryBuilder('a')
      .select('a.current_stage_id', 'stageId')
      .addSelect('COUNT(*)', 'count')
      .where('a.job_profile_id = :jobProfileId', { jobProfileId })
      .andWhere('a.inactive = 0')
      .andWhere('a.status IN (:...statuses)', {
        statuses: ['applied', 'in_progress'],
      })
      .groupBy('a.current_stage_id')
      .getRawMany<{ stageId: string | null; count: string }>();
  }
}
