import { Injectable, Logger } from '@nestjs/common';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  defaultDockerRuntimeConfig,
  isContainerRunning,
  runDockerCommand,
  volumeMount,
} from '../execution/docker-runtime.util';
import {
  resolveNodeDockerImage,
  resolvePhpDockerImage,
  resolvePythonDockerImage,
} from '../execution/docker-images.util';
import type { WorkspaceSession } from './workspace.types';
import {
  defaultEntryForLanguage,
  defaultStarterForLanguage,
  syncFileMapToDisk,
  writeWorkspaceFileToDisk,
} from './workspace-vfs.util';

@Injectable()
export class WorkspaceContainerService {
  private readonly logger = new Logger(WorkspaceContainerService.name);
  private readonly config = defaultDockerRuntimeConfig();
  private readonly sessions = new Map<string, WorkspaceSession>();

  getSession(candidateAssessmentId: string): WorkspaceSession | null {
    return this.sessions.get(candidateAssessmentId) ?? null;
  }

  resolveImage(language: string): string {
    const lang = language.trim().toUpperCase();
    if (lang === 'PHP') return resolvePhpDockerImage();
    if (lang === 'PYTHON') return resolvePythonDockerImage();
    if (lang === 'NODE') return resolveNodeDockerImage();
    return resolvePhpDockerImage();
  }

  async provision(
    candidateAssessmentId: string,
    language: string,
    initialFiles?: Record<string, string>,
    entryFile?: string,
  ): Promise<WorkspaceSession> {
    const existing = this.sessions.get(candidateAssessmentId);
    if (existing && (await isContainerRunning(this.config, existing.containerName))) {
      existing.lastActiveAt = Date.now();
      return existing;
    }
    if (existing) {
      await this.teardown(candidateAssessmentId);
    }

    const workDir = await mkdtemp(join(tmpdir(), `assessment-ws-${candidateAssessmentId}-`));
    const entry = entryFile ?? defaultEntryForLanguage(language);
    const files = { ...initialFiles };
    if (!files[entry]) {
      files[entry] = defaultStarterForLanguage(language);
    }
    await syncFileMapToDisk(workDir, files);

    const containerName = `assessment-ws-${candidateAssessmentId}-${Date.now()}`;
    const image = this.resolveImage(language);
    const memory = process.env.ASSESSMENT_DOCKER_WORKSPACE_MEMORY ?? '512m';

    const started = await runDockerCommand(this.config, [
      'run',
      '-d',
      '--name',
      containerName,
      '--memory',
      memory,
      '--cpus',
      this.config.cpus,
      '-w',
      '/workspace',
      '-v',
      volumeMount(workDir, 'rw'),
      image,
      'tail',
      '-f',
      '/dev/null',
    ]);

    if (!started.success) {
      await rm(workDir, { recursive: true, force: true });
      throw new Error(started.stderr || 'Failed to start workspace container');
    }

    const session: WorkspaceSession = {
      candidateAssessmentId,
      language,
      image,
      workDir,
      containerName,
      entryFile: entry,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
    };
    this.sessions.set(candidateAssessmentId, session);
    this.logger.log(`Workspace ready: ${containerName} (${language})`);
    return session;
  }

  async writeFile(session: WorkspaceSession, path: string, content: string): Promise<void> {
    await writeWorkspaceFileToDisk(session.workDir, path, content);
    session.lastActiveAt = Date.now();
  }

  async syncFiles(session: WorkspaceSession, files: Record<string, string>): Promise<void> {
    await syncFileMapToDisk(session.workDir, files);
    session.lastActiveAt = Date.now();
  }

  async exec(
    session: WorkspaceSession,
    command: string[],
    stdin?: string,
    timeoutMs?: number,
  ) {
    return runDockerCommand(
      this.config,
      ['exec', '-i', session.containerName, ...command],
      stdin,
      { timeoutMs: timeoutMs ?? Number(process.env.ASSESSMENT_DOCKER_WORKSPACE_EXEC_TIMEOUT_MS ?? 60000) },
    );
  }

  async isAlive(session: WorkspaceSession): Promise<boolean> {
    return isContainerRunning(this.config, session.containerName);
  }

  async teardown(candidateAssessmentId: string): Promise<void> {
    const session = this.sessions.get(candidateAssessmentId);
    if (!session) return;

    await runDockerCommand(this.config, ['rm', '-f', session.containerName]);
    await rm(session.workDir, { recursive: true, force: true }).catch(() => undefined);
    this.sessions.delete(candidateAssessmentId);
    this.logger.log(`Workspace torn down: ${session.containerName}`);
  }
}
