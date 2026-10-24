import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EnvironmentTemplateMysql } from '../entities/environment-template.mysql.entity';
import { WorkspaceProvisionMysql } from '../entities/workspace-provision.mysql.entity';
import { WorkspaceProvisionStatus } from '../shared/enums';
import type { EnvironmentProvisioner, EnvironmentSpec, WorkspaceHandle } from '../shared/interfaces';

@Injectable()
export class EnvironmentTemplateService {
  constructor(
    @InjectRepository(EnvironmentTemplateMysql)
    private readonly templateRepo: Repository<EnvironmentTemplateMysql>,
  ) {}

  list() {
    return this.templateRepo.find({ where: { inactive: 0 }, order: { name: 'ASC' } });
  }

  findBySlug(slug: string) {
    return this.templateRepo.findOne({ where: { slug, inactive: 0 } });
  }

  async create(data: Partial<EnvironmentTemplateMysql>) {
    return this.templateRepo.save(this.templateRepo.create(data));
  }

  async update(id: string, data: Partial<EnvironmentTemplateMysql>) {
    const existing = await this.templateRepo.findOne({ where: { id } });
    if (!existing) return null;
    return this.templateRepo.save({ ...existing, ...data });
  }

  resolveConfig(
    environmentConfig?: Record<string, unknown> | null,
    template?: EnvironmentTemplateMysql | null,
  ): EnvironmentSpec {
    const base = (template?.configJson ?? {}) as EnvironmentSpec;
    const override = (environmentConfig ?? {}) as EnvironmentSpec;
    return {
      runtime: override.runtime ?? base.runtime ?? 'PYTHON',
      services: override.services ?? base.services ?? [],
      seedData: override.seedData ?? base.seedData,
      dockerTemplate: override.dockerTemplate ?? base.dockerTemplate,
      setupCommands: override.setupCommands ?? base.setupCommands,
    };
  }
}

@Injectable()
export class SingleContainerProvisioner implements EnvironmentProvisioner {
  async provision(spec: EnvironmentSpec, attemptId: string, questionId?: string): Promise<WorkspaceHandle> {
    return {
      provisionId: `single-${attemptId}-${questionId ?? 'global'}`,
      candidateAssessmentId: attemptId,
      questionId,
      endpoints: { runtime: spec.runtime },
    };
  }

  async teardown(_handle: WorkspaceHandle): Promise<void> {
    // single-container runs are ephemeral per execution
  }
}

@Injectable()
export class ComposeWorkspaceProvisioner implements EnvironmentProvisioner {
  constructor(
    @InjectRepository(WorkspaceProvisionMysql)
    private readonly provisionRepo: Repository<WorkspaceProvisionMysql>,
  ) {}

  async provision(spec: EnvironmentSpec, attemptId: string, questionId?: string): Promise<WorkspaceHandle> {
    const project = `assess-${attemptId}-${questionId ?? '0'}`.replace(/[^a-zA-Z0-9-]/g, '-');
    const row = await this.provisionRepo.save(
      this.provisionRepo.create({
        candidateAssessmentId: attemptId,
        questionId: questionId ?? null,
        templateSlug: spec.dockerTemplate ?? null,
        composeProject: project,
        status: WorkspaceProvisionStatus.READY,
        endpointsJson: {
          runtime: spec.runtime,
          mysql: spec.services?.includes('mysql') ? `mysql://${project}-mysql:3306` : '',
          redis: spec.services?.includes('redis') ? `redis://${project}-redis:6379` : '',
        },
        expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      }),
    );

    return {
      provisionId: row.id,
      candidateAssessmentId: attemptId,
      questionId,
      endpoints: row.endpointsJson ?? undefined,
    };
  }

  async teardown(handle: WorkspaceHandle): Promise<void> {
    await this.provisionRepo.update(
      { id: handle.provisionId },
      { status: WorkspaceProvisionStatus.TEARDOWN },
    );
  }
}

@Injectable()
export class EnvironmentProvisionerRegistry {
  constructor(
    private readonly single: SingleContainerProvisioner,
    private readonly compose: ComposeWorkspaceProvisioner,
    private readonly templates: EnvironmentTemplateService,
  ) {}

  async provisionForQuestion(
    attemptId: string,
    questionId: string,
    environmentConfig?: Record<string, unknown> | null,
  ) {
    const slug = String(environmentConfig?.dockerTemplate ?? '');
    const template = slug ? await this.templates.findBySlug(slug) : null;
    const spec = this.templates.resolveConfig(environmentConfig, template);
    const services = spec.services ?? [];
    const provisioner =
      services.length > 0 ? this.compose : this.single;
    return provisioner.provision(spec, attemptId, questionId);
  }

  async teardownAttempt(attemptId: string) {
    // best-effort; compose teardown hooks expanded in ops runbooks
    await this.single.teardown({
      provisionId: `single-${attemptId}`,
      candidateAssessmentId: attemptId,
    });
  }
}
