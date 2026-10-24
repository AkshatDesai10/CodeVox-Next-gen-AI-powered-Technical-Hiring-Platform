import { mkdir, readdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { WorkspaceFileMap, WorkspaceFileNode } from './workspace.types';

export function normalizeVfsPath(raw: string): string {
  const cleaned = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned.includes('..')) {
    throw new Error('Invalid path');
  }
  return cleaned;
}

export function defaultEntryForLanguage(language: string): string {
  const lang = language.trim().toUpperCase();
  if (lang === 'PHP') return 'Main.php';
  if (lang === 'PYTHON') return 'main.py';
  if (lang === 'NODE' || lang === 'JAVASCRIPT' || lang === 'JS') return 'main.js';
  if (lang === 'SQL') return 'query.sql';
  return 'main.txt';
}

export function defaultStarterForLanguage(language: string): string {
  const lang = language.trim().toUpperCase();
  if (lang === 'PHP') {
    return "<?php\n// Edit files in the workspace and run from the terminal.\n";
  }
  if (lang === 'PYTHON') {
    return "# Edit files in the workspace and run from the terminal.\n";
  }
  if (lang === 'NODE') {
    return "// Edit files in the workspace and run from the terminal.\n";
  }
  return '';
}

export function buildFileTreeFromMap(files: WorkspaceFileMap): WorkspaceFileNode[] {
  const root: WorkspaceFileNode[] = [];
  const dirs = new Set<string>();

  const sortedPaths = Object.keys(files).sort();
  for (const filePath of sortedPaths) {
    const parts = filePath.split('/');
    let current = root;
    let prefix = '';

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      prefix = prefix ? `${prefix}/${part}` : part;
      const isFile = i === parts.length - 1;

      if (!isFile) {
        dirs.add(prefix);
        let dirNode = current.find((n) => n.path === prefix && n.type === 'directory');
        if (!dirNode) {
          dirNode = { path: prefix, name: part, type: 'directory', children: [] };
          current.push(dirNode);
        }
        current = dirNode.children ?? [];
        continue;
      }

      current.push({ path: filePath, name: part, type: 'file' });
    }
  }

  return root;
}

export async function readWorkspaceFilesFromDisk(workDir: string): Promise<WorkspaceFileMap> {
  const files: WorkspaceFileMap = {};

  async function walk(relativeDir: string) {
    const absDir = join(workDir, relativeDir);
    const entries = await readdir(absDir, { withFileTypes: true });
    for (const entry of entries) {
      const relPath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(relPath);
      } else if (entry.isFile()) {
        files[normalizeVfsPath(relPath)] = await readFile(join(workDir, relPath), 'utf8');
      }
    }
  }

  try {
    await walk('');
  } catch {
    return files;
  }
  return files;
}

export async function writeWorkspaceFileToDisk(
  workDir: string,
  filePath: string,
  content: string,
): Promise<void> {
  const normalized = normalizeVfsPath(filePath);
  const absPath = join(workDir, normalized);
  await mkdir(dirname(absPath), { recursive: true });
  await writeFile(absPath, content, 'utf8');
}

export async function deleteWorkspaceFileFromDisk(workDir: string, filePath: string): Promise<void> {
  const normalized = normalizeVfsPath(filePath);
  const absPath = join(workDir, normalized);
  await rm(absPath, { recursive: true, force: true });
}

export async function syncFileMapToDisk(workDir: string, files: WorkspaceFileMap): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await writeWorkspaceFileToDisk(workDir, path, content);
  }
}

export function listFilesOnDisk(workDir: string): Promise<WorkspaceFileNode[]> {
  return readWorkspaceFilesFromDisk(workDir).then(buildFileTreeFromMap);
}
