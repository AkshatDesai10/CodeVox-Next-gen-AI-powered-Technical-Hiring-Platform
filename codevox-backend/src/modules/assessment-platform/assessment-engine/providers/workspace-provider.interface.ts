import type { AssessmentDocument } from '../types/assessment-document.types';

export type WorkspaceProvisionRequest = {
  sessionId: string;
  workspace: Record<string, unknown>;
};

export type WorkspaceProvisionResult = {
  workspaceId: string;
  workspaceType: string;
  status: 'PROVISIONING' | 'READY' | 'FAILED' | 'TEARDOWN';
  config: Record<string, unknown>;
};

export interface WorkspaceProvider {
  readonly id: string;
  supports(workspace: Record<string, unknown>): boolean;
  provision(req: WorkspaceProvisionRequest): Promise<WorkspaceProvisionResult>;
  teardown(workspaceId: string): Promise<void>;
}

export const WORKSPACE_PROVIDERS = 'WORKSPACE_PROVIDERS';

export function resolveWorkspaceType(doc: AssessmentDocument): string {
  const ws = doc.workspace ?? {};
  if (ws.workspace === 'none' || ws.runtime === 'none') return 'none';
  const runtime = String(ws.runtime ?? 'none').toLowerCase();
  const services = Array.isArray(ws.services) ? ws.services : [];
  if (runtime === 'none' && !services.length) return 'none';
  if (services.length > 0) return 'docker_compose';
  if (['php', 'python', 'node', 'sql'].includes(runtime)) return 'docker_single';
  return 'docker_single';
}
