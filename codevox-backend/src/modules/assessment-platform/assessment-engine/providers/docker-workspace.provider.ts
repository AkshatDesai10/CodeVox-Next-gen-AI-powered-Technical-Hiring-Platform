import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AssessmentWorkspaceMysql,
  WorkspaceRecordStatus,
} from '../entities/assessment-workspace.mysql.entity';
import type {
  WorkspaceProvider,
  WorkspaceProvisionRequest,
  WorkspaceProvisionResult,
} from './workspace-provider.interface';
import { EnvironmentProvisionerRegistry } from '../../assessment-environment/environment.services';

@Injectable()
export class DockerWorkspaceProvider implements WorkspaceProvider {
  readonly id = 'docker';

  constructor(
    @InjectRepository(AssessmentWorkspaceMysql)
    private readonly workspaceRepo: Repository<AssessmentWorkspaceMysql>,
    private readonly envRegistry: EnvironmentProvisionerRegistry,
  ) {}

  supports(workspace: Record<string, unknown>): boolean {
    const runtime = String(workspace.runtime ?? '').toLowerCase();
    return runtime !== 'none' && workspace.workspace !== 'none';
  }

  async provision(req: WorkspaceProvisionRequest): Promise<WorkspaceProvisionResult> {
    const workspaceType = String(req.workspace.runtime ?? 'docker');
    const row = await this.workspaceRepo.save(
      this.workspaceRepo.create({
        sessionId: req.sessionId,
        workspaceType,
        workspaceConfigJson: req.workspace,
        status: WorkspaceRecordStatus.PROVISIONING,
      }),
    );

    try {
      const handle = await this.envRegistry.provisionForQuestion(
        req.sessionId,
        'engine',
        req.workspace,
      );
      await this.workspaceRepo.update(
        { id: row.id },
        {
          status: WorkspaceRecordStatus.READY,
          workspaceConfigJson: {
            ...req.workspace,
            provisionId: handle.provisionId,
            endpoints: handle.endpoints,
          },
        },
      );
      return {
        workspaceId: row.id,
        workspaceType,
        status: 'READY',
        config: req.workspace,
      };
    } catch {
      await this.workspaceRepo.update({ id: row.id }, { status: WorkspaceRecordStatus.FAILED });
      return {
        workspaceId: row.id,
        workspaceType,
        status: 'FAILED',
        config: req.workspace,
      };
    }
  }

  async teardown(workspaceId: string): Promise<void> {
    await this.workspaceRepo.update(
      { id: workspaceId },
      { status: WorkspaceRecordStatus.TEARDOWN },
    );
  }
}

@Injectable()
export class NoneWorkspaceProvider implements WorkspaceProvider {
  readonly id = 'none';

  constructor(
    @InjectRepository(AssessmentWorkspaceMysql)
    private readonly workspaceRepo: Repository<AssessmentWorkspaceMysql>,
  ) {}

  supports(workspace: Record<string, unknown>): boolean {
    return workspace.workspace === 'none' || workspace.runtime === 'none' || !workspace.runtime;
  }

  async provision(req: WorkspaceProvisionRequest): Promise<WorkspaceProvisionResult> {
    const row = await this.workspaceRepo.save(
      this.workspaceRepo.create({
        sessionId: req.sessionId,
        workspaceType: 'none',
        workspaceConfigJson: req.workspace,
        status: WorkspaceRecordStatus.READY,
      }),
    );
    return {
      workspaceId: row.id,
      workspaceType: 'none',
      status: 'READY',
      config: req.workspace,
    };
  }

  async teardown(workspaceId: string): Promise<void> {
    await this.workspaceRepo.update(
      { id: workspaceId },
      { status: WorkspaceRecordStatus.TEARDOWN },
    );
  }
}

@Injectable()
export class WorkspaceProviderRegistry {
  constructor(
    private readonly none: NoneWorkspaceProvider,
    private readonly docker: DockerWorkspaceProvider,
  ) {}

  resolve(workspace: Record<string, unknown>): WorkspaceProvider {
    if (this.none.supports(workspace)) return this.none;
    return this.docker;
  }
}
