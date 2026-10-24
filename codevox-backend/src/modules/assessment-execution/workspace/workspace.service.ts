import { Injectable, NotFoundException } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { WorkspaceContainerService } from './workspace-container.service';
import type { WorkspaceFileMap, WorkspaceProvisionResult } from './workspace.types';
import {
  buildFileTreeFromMap,
  deleteWorkspaceFileFromDisk,
  normalizeVfsPath,
  readWorkspaceFilesFromDisk,
  writeWorkspaceFileToDisk,
} from './workspace-vfs.util';

@Injectable()
export class WorkspaceService {
  constructor(private readonly containers: WorkspaceContainerService) {}

  async provision(
    candidateAssessmentId: string,
    language: string,
    initialFiles?: Record<string, string>,
    entryFile?: string,
  ): Promise<WorkspaceProvisionResult> {
    const session = await this.containers.provision(
      candidateAssessmentId,
      language,
      initialFiles,
      entryFile,
    );
    const fileMap = await readWorkspaceFilesFromDisk(session.workDir);
    return {
      candidateAssessmentId,
      status: 'ready',
      containerName: session.containerName,
      entryFile: session.entryFile,
      files: buildFileTreeFromMap(fileMap),
    };
  }

  async getStatus(candidateAssessmentId: string) {
    const session = this.containers.getSession(candidateAssessmentId);
    if (!session) {
      return { candidateAssessmentId, status: 'not_provisioned' as const };
    }
    const alive = await this.containers.isAlive(session);
    const files = await readWorkspaceFilesFromDisk(session.workDir);
    return {
      candidateAssessmentId,
      status: alive ? ('ready' as const) : ('stopped' as const),
      containerName: session.containerName,
      entryFile: session.entryFile,
      language: session.language,
      files: buildFileTreeFromMap(files),
    };
  }

  async listFiles(candidateAssessmentId: string) {
    const session = this.requireSession(candidateAssessmentId);
    const files = await readWorkspaceFilesFromDisk(session.workDir);
    return {
      files: buildFileTreeFromMap(files),
      fileMap: files,
      entryFile: session.entryFile,
    };
  }

  async readFile(candidateAssessmentId: string, path: string): Promise<string> {
    const session = this.requireSession(candidateAssessmentId);
    const normalized = normalizeVfsPath(path);
    return readFile(join(session.workDir, normalized), 'utf8');
  }

  async writeFile(candidateAssessmentId: string, path: string, content: string) {
    const session = this.requireSession(candidateAssessmentId);
    const normalized = normalizeVfsPath(path);
    await this.containers.writeFile(session, normalized, content);
    return { path: normalized, ok: true };
  }

  async deleteFile(candidateAssessmentId: string, path: string) {
    const session = this.requireSession(candidateAssessmentId);
    const normalized = normalizeVfsPath(path);
    await deleteWorkspaceFileFromDisk(session.workDir, normalized);
    session.lastActiveAt = Date.now();
    return { path: normalized, ok: true };
  }

  async syncFiles(candidateAssessmentId: string, files: WorkspaceFileMap) {
    const session = this.requireSession(candidateAssessmentId);
    const normalized: WorkspaceFileMap = {};
    for (const [path, content] of Object.entries(files)) {
      normalized[normalizeVfsPath(path)] = content;
    }
    await this.containers.syncFiles(session, normalized);
    return { ok: true, count: Object.keys(normalized).length };
  }

  async runInWorkspace(
    candidateAssessmentId: string,
    command: string[],
    stdin?: string,
  ) {
    const session = this.requireSession(candidateAssessmentId);
    const result = await this.containers.exec(session, command, stdin);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      executionTime: result.executionTime,
      success: result.success,
      timedOut: result.timedOut,
    };
  }

  getContainerName(candidateAssessmentId: string): string | null {
    return this.containers.getSession(candidateAssessmentId)?.containerName ?? null;
  }

  requireSession(candidateAssessmentId: string) {
    const session = this.containers.getSession(candidateAssessmentId);
    if (!session) {
      throw new NotFoundException('Workspace not provisioned for this attempt');
    }
    return session;
  }

  async teardown(candidateAssessmentId: string) {
    await this.containers.teardown(candidateAssessmentId);
    return { ok: true };
  }
}
