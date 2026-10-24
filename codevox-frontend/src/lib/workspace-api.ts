import { recruitmentApiBase } from '@/lib/recruitment-api-base';

const API_BASE = () => recruitmentApiBase();

export type WorkspaceFileNode = {
  path: string;
  name: string;
  type: 'file' | 'directory';
  children?: WorkspaceFileNode[];
};

type ApiEnvelope<T> = { success: boolean; message: string; data: T };

async function workspaceGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`);
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const json = (await res.json()) as ApiEnvelope<T>;
  return json.data;
}

async function workspacePost<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const json = (await res.json()) as ApiEnvelope<T>;
  return json.data;
}

async function workspacePut<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE()}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const json = (await res.json()) as ApiEnvelope<T>;
  return json.data;
}

export function workspaceWsUrl(): string {
  const base = API_BASE().replace(/^http/, 'ws');
  return `${base}/api/assessment/workspace/terminal`;
}

export function provisionWorkspace(
  candidateAssessmentId: string,
  payload: { language: string; entry_file?: string; files?: Record<string, string> },
) {
  return workspacePost<{
    candidateAssessmentId: string;
    status: string;
    entryFile: string;
    files: WorkspaceFileNode[];
  }>(`/api/assessment/workspace/${candidateAssessmentId}/provision`, payload);
}

export function getWorkspaceStatus(candidateAssessmentId: string) {
  return workspaceGet<{
    status: string;
    entryFile?: string;
    files?: WorkspaceFileNode[];
    fileMap?: Record<string, string>;
  }>(`/api/assessment/workspace/${candidateAssessmentId}`);
}

export function syncWorkspaceFiles(
  candidateAssessmentId: string,
  files: Record<string, string>,
) {
  return workspacePost<{ ok: boolean; count: number }>(
    `/api/assessment/workspace/${candidateAssessmentId}/files/sync`,
    { files },
  );
}

export function writeWorkspaceFile(
  candidateAssessmentId: string,
  path: string,
  content: string,
) {
  return workspacePut<{ ok: boolean }>(
    `/api/assessment/workspace/${candidateAssessmentId}/files`,
    { path, content },
  );
}

export function execInWorkspace(
  candidateAssessmentId: string,
  command: string[],
  stdin?: string,
) {
  return workspacePost<{
    stdout: string;
    stderr: string;
    success: boolean;
    executionTime: number;
  }>(`/api/assessment/workspace/${candidateAssessmentId}/exec`, { command, stdin });
}

export type VfsSnapshot = {
  __vfs: true;
  entryFile: string;
  files: Record<string, string>;
};

export function serializeVfsSnapshot(entryFile: string, files: Record<string, string>): string {
  return JSON.stringify({ __vfs: true, entryFile, files } satisfies VfsSnapshot);
}

export function parseVfsSnapshot(source: string): VfsSnapshot | null {
  const trimmed = source.trim();
  if (!trimmed.startsWith('{')) return null;
  try {
    const parsed = JSON.parse(trimmed) as Partial<VfsSnapshot>;
    if (parsed.__vfs && parsed.files && typeof parsed.files === 'object') {
      return {
        __vfs: true,
        entryFile: String(parsed.entryFile ?? 'Main.php'),
        files: parsed.files as Record<string, string>,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function hasMeaningfulSource(source: string | undefined | null): boolean {
  if (!source?.trim()) return false;
  const vfs = parseVfsSnapshot(source);
  if (vfs) {
    return Object.values(vfs.files).some((content) => content.trim().length > 0);
  }
  return true;
}

export function resolveWorkspaceFilesFromSource(
  source: string,
  language: string,
): { entryFile: string; files: Record<string, string> } {
  const entryDefault = defaultEntryForLanguage(language);
  const vfs = parseVfsSnapshot(source);
  if (vfs && hasMeaningfulSource(source)) {
    return { entryFile: vfs.entryFile, files: vfs.files };
  }
  const trimmed = source.trim();
  if (trimmed && !trimmed.startsWith('{')) {
    return { entryFile: entryDefault, files: { [entryDefault]: trimmed } };
  }
  return { entryFile: entryDefault, files: { [entryDefault]: '' } };
}

export function defaultEntryForLanguage(language: string): string {
  const lang = language.toUpperCase();
  if (lang === 'PHP') return 'Main.php';
  if (lang === 'PYTHON') return 'main.py';
  if (lang === 'NODE' || lang === 'JAVASCRIPT' || lang === 'JS') return 'main.js';
  if (lang === 'SQL') return 'query.sql';
  return 'main.txt';
}

export function monacoLanguageForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'php') return 'php';
  if (ext === 'py') return 'python';
  if (ext === 'js' || ext === 'mjs' || ext === 'ts') return 'javascript';
  if (ext === 'sql') return 'sql';
  if (ext === 'json') return 'json';
  if (ext === 'sh') return 'shell';
  if (ext === 'md') return 'markdown';
  return 'plaintext';
}

export function getEntrySourceFromSerialized(source: string): string {
  const vfs = parseVfsSnapshot(source);
  if (vfs) {
    return vfs.files[vfs.entryFile] ?? '';
  }
  return source;
}

export function shouldUseIdeWorkspace(language: string, questionType?: string): boolean {
  const t = (questionType ?? 'CODING').toUpperCase();
  if (t !== 'CODING') return false;
  const lang = language.toUpperCase();
  return lang === 'PHP' || lang === 'PYTHON' || lang === 'NODE' || lang === 'JAVASCRIPT';
}

export function flattenFileTree(nodes: WorkspaceFileNode[]): string[] {
  const paths: string[] = [];
  for (const node of nodes) {
    if (node.type === 'file') paths.push(node.path);
    if (node.children?.length) paths.push(...flattenFileTree(node.children));
  }
  return paths;
}
