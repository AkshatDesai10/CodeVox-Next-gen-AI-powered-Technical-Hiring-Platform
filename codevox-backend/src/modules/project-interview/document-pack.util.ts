import { deflateRawSync, inflateRawSync } from 'zlib';
import { extractReportText } from '../ai-detection/text-extraction.util';
import type { ProjectChoice, ProjectGradingRubric } from '../job-profiles/project-interview-round.types';
import type { RepoSnapshot } from './repo-snapshot.fetcher';

export type DocumentSubpartStatus = 'present' | 'partial' | 'missing' | 'unseen';

export type DocumentSubpartEvaluation = {
  name: string;
  marks: number;
  awarded: number;
  status: DocumentSubpartStatus;
  file: string;
  quote: string;
  gap: string;
};

export type DocumentTaskEvaluation = {
  task_id: string;
  score: number;
  max_marks: number;
  feedback: string;
  subparts?: DocumentSubpartEvaluation[];
};

const SKIP_DIR_PARTS = new Set([
  'node_modules',
  'venv',
  '.venv',
  'dist',
  '.git',
  '__pycache__',
  'build',
  'coverage',
]);

const SKIP_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.exe',
  '.dll',
  '.so',
  '.bin',
  '.mp4',
  '.mp3',
  '.wav',
  '.zip',
  '.pt',
  '.pdf',
]);

const TEXT_EXTENSIONS = new Set([
  '.sql',
  '.md',
  '.txt',
  '.csv',
  '.json',
  '.py',
  '.js',
  '.ts',
  '.tsx',
  '.jsx',
  '.java',
  '.php',
  '.go',
  '.rb',
  '.html',
  '.css',
  '.xml',
  '.yml',
  '.yaml',
]);

const FILE_CHAR_CAP = 20_000;
const BUNDLE_CHAR_CAP = 80_000;

export function readZipEntries(buffer: Buffer): Array<{ name: string; data: Buffer }> {
  if (buffer.length < 22) throw new Error('Not a zip file');
  let eocd = -1;
  const min = Math.max(0, buffer.length - 22 - 65535);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a zip file');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: Array<{ name: string; data: Buffer }> = [];

  for (let n = 0; n < count && offset + 46 <= buffer.length; n++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLen).toString('utf8').replace(/\\/g, '/');
    offset += 46 + nameLen + extraLen + commentLen;

    if (!name || name.endsWith('/') || name.split('/').includes('..')) continue;
    if (localOffset + 30 > buffer.length) continue;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) continue;

    const localNameLen = buffer.readUInt16LE(localOffset + 26);
    const localExtraLen = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataEnd > buffer.length) continue;

    const compressed = buffer.slice(dataStart, dataEnd);
    let data: Buffer;
    if (method === 0) data = compressed;
    else if (method === 8) {
      try {
        data = inflateRawSync(compressed);
      } catch {
        continue;
      }
    } else {
      continue;
    }
    entries.push({ name, data });
  }

  return entries;
}

function shouldSkipZipPath(name: string): boolean {
  const parts = name.split('/').filter(Boolean);
  if (parts.some((part) => SKIP_DIR_PARTS.has(part))) return true;
  const base = parts[parts.length - 1] ?? name;
  const dot = base.lastIndexOf('.');
  const ext = dot >= 0 ? base.slice(dot).toLowerCase() : '';
  return SKIP_EXTENSIONS.has(ext);
}

function textExtension(name: string): string {
  const base = name.split('/').pop() ?? name;
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * True when a multi-task paper gave every task its entire printed total.
 * A single-task paper may legitimately earn its full printed marks.
 */
export function everyTaskAtPrintedTotal(tasks: DocumentTaskEvaluation[]): boolean {
  if (tasks.length < 2) return false;
  return tasks.every((task) => task.max_marks > 0 && task.score >= task.max_marks);
}

export function submissionScorePct(tasks: DocumentTaskEvaluation[]): number {
  const possible = tasks.reduce((sum, task) => sum + task.max_marks, 0);
  if (possible <= 0) return 0;
  const earned = tasks.reduce((sum, task) => sum + task.score, 0);
  const rawPct = Math.max(0, Math.min(100, Math.round((earned / possible) * 100)));
  // Without sandbox execution, cap 99-100 scores at 94
  return rawPct >= 95 ? 94 : rawPct;
}

export function normalizeTaskEvaluations(raw: unknown): DocumentTaskEvaluation[] {
  if (!Array.isArray(raw)) return [];
  const out: DocumentTaskEvaluation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const taskId = typeof row.task_id === 'string' ? row.task_id.trim() : '';
    const maxMarks = Number(row.max_marks);
    const score = Number(row.score);
    if (!taskId || !Number.isFinite(maxMarks) || maxMarks < 0) continue;
    const max = Math.round(maxMarks);
    const earned = Number.isFinite(score) ? Math.round(score) : 0;
    out.push({
      task_id: taskId.slice(0, 80),
      max_marks: max,
      score: Math.max(0, Math.min(max, earned)),
      feedback: typeof row.feedback === 'string' ? row.feedback.trim().slice(0, 2000) : '',
    });
  }
  return out;
}

const SUBPART_STATUSES = new Set<DocumentSubpartStatus>(['present', 'partial', 'missing', 'unseen']);

/**
 * Rubric stored on the project wins. Older projects that only have a must-have
 * checklist become one task per requirement, with that requirement's weight as the marks.
 * Nothing is read off the assessment PDF at grade time.
 */
export function resolveGradingRubric(
  project: Pick<ProjectChoice, 'grading_rubric' | 'must_have_requirements'>,
): ProjectGradingRubric | null {
  if (project.grading_rubric?.tasks?.length) return project.grading_rubric;
  const tasks = project.must_have_requirements
    .filter((req) => req.text.trim() && req.weight > 0)
    .map((req) => ({
      id: req.id,
      name: req.text.trim().slice(0, 160),
      subparts: [{ name: req.text.trim().slice(0, 160), marks: req.weight }],
    }));
  return tasks.length ? { tasks } : null;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isReadmePath(filePath: string): boolean {
  return /(^|\/)readme(\.(md|txt|rst))?$/i.test(filePath.replace(/\\/g, '/'));
}

function snapshotFileBodies(snapshot: RepoSnapshot): Array<{ path: string; body: string }> {
  const rows: Array<{ path: string; body: string }> = [];
  const push = (filePath: string, body: string | null | undefined) => {
    if (!filePath || !body?.trim()) return;
    rows.push({ path: filePath.replace(/\\/g, '/'), body });
  };
  for (const [filePath, body] of Object.entries(snapshot.key_source_files)) push(filePath, body);
  for (const [filePath, body] of Object.entries(snapshot.manifests)) push(filePath, body);
  for (const [filePath, body] of Object.entries(snapshot.config_files)) push(filePath, body);
  if (snapshot.decisions_md) push('DECISIONS.md', snapshot.decisions_md);
  return rows;
}

function findSnapshotFile(
  files: Array<{ path: string; body: string }>,
  wanted: string,
): { path: string; body: string } | null {
  const target = wanted.replace(/\\/g, '/').replace(/^\.\//, '').trim().toLowerCase();
  if (!target) return null;
  return (
    files.find((file) => file.path.toLowerCase() === target) ??
    files.find((file) => {
      const path = file.path.toLowerCase();
      return path.endsWith(`/${target}`) || target.endsWith(`/${path}`);
    }) ??
    null
  );
}

/** A quote counts only when it is copied from the file text the grader was shown. */
export function quoteAppearsInFile(fileBody: string, quote: string): boolean {
  const clipped = quote.trim().slice(0, 200);
  if (clipped.length < 20) return false;
  if (fileBody.includes(clipped)) return true;
  const collapsed = collapseWhitespace(clipped);
  return collapsed.length >= 20 && collapseWhitespace(fileBody).includes(collapsed);
}

function asStatus(value: unknown): DocumentSubpartStatus {
  return typeof value === 'string' && SUBPART_STATUSES.has(value as DocumentSubpartStatus)
    ? (value as DocumentSubpartStatus)
    : 'unseen';
}

function modelSubparts(raw: unknown): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return [];
  const row = raw as Record<string, unknown>;
  const subparts = Array.isArray(row.subparts) ? row.subparts : [];
  return subparts.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object');
}

/**
 * Rebuild every task from the rubric. Model marks are ignored.
 * Unseen rows and quotes that are not in the snapshot score 0.
 */
export function applyRubricEvidence(
  rubric: ProjectGradingRubric,
  rawTasks: unknown,
  snapshot: RepoSnapshot,
): DocumentTaskEvaluation[] {
  const rows = Array.isArray(rawTasks) ? rawTasks : [];
  const files = snapshotFileBodies(snapshot);
  return rubric.tasks.map((task) => {
    const modelTask = rows.find((item) => {
      if (!item || typeof item !== 'object') return false;
      const id = (item as Record<string, unknown>).task_id;
      return typeof id === 'string' && id.trim().toLowerCase() === task.id.toLowerCase();
    });
    const returned = modelSubparts(modelTask);
    const subparts = task.subparts.map((part) => {
      const model = returned.find((row) => {
        const name = typeof row.name === 'string' ? row.name.trim().toLowerCase() : '';
        return name === part.name.trim().toLowerCase();
      });
      return scoreSubpart(part, model, files);
    });
    const maxMarks = subparts.reduce((sum, part) => sum + part.marks, 0);
    const score = subparts.reduce((sum, part) => sum + part.awarded, 0);
    return {
      task_id: task.id,
      max_marks: maxMarks,
      score,
      feedback: subparts
        .map((part) => `${part.name} (${part.status} ${part.awarded}/${part.marks}): ${part.gap}`)
        .join(' ')
        .slice(0, 2000),
      subparts,
    };
  });
}

function scoreSubpart(
  part: { name: string; marks: number },
  model: Record<string, unknown> | undefined,
  files: Array<{ path: string; body: string }>,
): DocumentSubpartEvaluation {
  const marks = part.marks;
  if (!model) {
    return {
      name: part.name,
      marks,
      awarded: 0,
      status: 'unseen',
      file: '',
      quote: '',
      gap: 'Grader did not return this sub-part.',
    };
  }

  const file = typeof model.file === 'string' ? model.file.trim().slice(0, 240) : '';
  const quote = typeof model.quote === 'string' ? model.quote.trim().slice(0, 200) : '';
  let gap = typeof model.gap === 'string' ? model.gap.trim().slice(0, 300) : '';
  let status = asStatus(model.status);
  const requested = Number(model.awarded);
  let awarded = Number.isFinite(requested) ? Math.max(0, Math.min(marks, Math.round(requested))) : 0;

  if (status === 'unseen' || status === 'missing') {
    awarded = 0;
    if (!gap) {
      gap =
        status === 'unseen'
          ? 'Behavior was not in the files sent to the grader.'
          : 'The required behavior is missing from the submission.';
    }
  } else if (!file || isReadmePath(file)) {
    awarded = 0;
    status = 'unseen';
    if (!gap) gap = 'Evidence was not taken from a candidate source file.';
  } else {
    const found = findSnapshotFile(files, file);
    if (!found || !quoteAppearsInFile(found.body, quote)) {
      awarded = 0;
      status = 'unseen';
      if (!gap) gap = 'Quoted text was not found in the submitted file.';
    } else {
      if (!gap) gap = 'Verified in submitted file.';
      awarded = Math.max(0, Math.min(marks, awarded));
      const ratio = marks > 0 ? awarded / marks : 0;
      status = ratio >= 0.9 ? 'present' : ratio > 0 ? 'partial' : 'missing';
    }
  }

  return { name: part.name, marks, awarded, status, file, quote, gap };
}

/** True when the model actually returned sub-part rows, so a schema miss can be retried. */
export function modelReturnedSubparts(rawTasks: unknown): boolean {
  if (!Array.isArray(rawTasks)) return false;
  return rawTasks.some((task) => modelSubparts(task).length > 0);
}

/** Text from a cloned GitHub snapshot, for a technical candidate who submitted a repository. */
export function bundleSnapshotForGrading(snapshot: RepoSnapshot): string {
  const parts: string[] = [];
  let used = 0;
  const push = (name: string, body: string) => {
    if (!body.trim() || used >= BUNDLE_CHAR_CAP) return;
    const clipped = body.slice(0, BUNDLE_CHAR_CAP - used);
    parts.push(`----- ${name} -----\n${clipped}`);
    used += clipped.length;
  };
  push('README', snapshot.readme);
  if (snapshot.decisions_md) push('DECISIONS.md', snapshot.decisions_md);
  for (const [name, body] of Object.entries(snapshot.key_source_files)) push(name, body);
  for (const [name, body] of Object.entries(snapshot.manifests)) push(name, body);
  if (snapshot.file_tree.length) push('FILE_TREE', snapshot.file_tree.join('\n'));
  return parts.join('\n\n');
}

/** Text the grader is allowed to read. Images and dependency folders are dropped. */
export async function bundleZipForGrading(buffer: Buffer): Promise<{
  bundle: string;
  fileTree: string[];
  snapshot: RepoSnapshot;
}> {
  const entries = readZipEntries(buffer);
  const fileTree: string[] = [];
  const parts: string[] = [];
  let used = 0;
  const keySource: Record<string, string> = {};
  let readme = '';

  for (const entry of entries) {
    if (shouldSkipZipPath(entry.name)) continue;
    fileTree.push(entry.name);
    const ext = textExtension(entry.name);
    let text = '';
    if (ext === '.docx') {
      try {
        text = await extractReportText({
          buffer: entry.data,
          originalname: entry.name.split('/').pop() ?? 'answers.docx',
          mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        } as Express.Multer.File);
      } catch {
        continue;
      }
    } else if (TEXT_EXTENSIONS.has(ext)) {
      text = entry.data.toString('utf8');
    } else {
      continue;
    }
    const clipped = text.replace(/\u0000/g, '').slice(0, FILE_CHAR_CAP);
    if (!clipped.trim()) continue;
    if (/(^|\/)readme\.md$/i.test(entry.name) && !readme) readme = clipped.slice(0, 4000);
    if (Object.keys(keySource).length < 12) keySource[entry.name] = clipped.slice(0, 2000);
    if (used >= BUNDLE_CHAR_CAP) continue;
    const room = BUNDLE_CHAR_CAP - used;
    const body = clipped.slice(0, room);
    parts.push(`----- ${entry.name} -----\n${body}`);
    used += body.length;
  }

  const snapshot: RepoSnapshot = {
    repo_url: 'zip-upload',
    branch: null,
    readme,
    decisions_md: null,
    manifests: {},
    config_files: {},
    key_source_files: keySource,
    file_tree: fileTree.slice(0, 200),
    file_count: fileTree.length,
    has_tests: fileTree.some((name) => /(^|\/)(test|tests|__tests__)\//i.test(name) || /\.(test|spec)\./i.test(name)),
    truncated: used >= BUNDLE_CHAR_CAP || fileTree.length > 200,
  };

  return {
    bundle: parts.join('\n\n'),
    fileTree: snapshot.file_tree,
    snapshot,
  };
}

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k += 1) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return ~c >>> 0;
}

function zipU32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function zipU16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}

/** Uncompressed or deflated zip. Names must already be safe relative paths. */
export function buildDownloadZip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const raw = deflateRawSync(file.data);
    const method = raw.length < file.data.length ? 8 : 0;
    const payload = method === 8 ? raw : file.data;
    const crc = crc32(file.data);
    const local = Buffer.concat([
      zipU32(0x04034b50),
      zipU16(20),
      zipU16(0),
      zipU16(method),
      zipU16(0),
      zipU16(0),
      zipU32(crc),
      zipU32(payload.length),
      zipU32(file.data.length),
      zipU16(name.length),
      zipU16(0),
      name,
      payload,
    ]);
    const central = Buffer.concat([
      zipU32(0x02014b50),
      zipU16(20),
      zipU16(20),
      zipU16(0),
      zipU16(method),
      zipU16(0),
      zipU16(0),
      zipU32(crc),
      zipU32(payload.length),
      zipU32(file.data.length),
      zipU16(name.length),
      zipU16(0),
      zipU16(0),
      zipU16(0),
      zipU16(0),
      zipU32(0),
      zipU32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.concat([
    zipU32(0x06054b50),
    zipU16(0),
    zipU16(0),
    zipU16(files.length),
    zipU16(files.length),
    zipU32(centralDir.length),
    zipU32(offset),
    zipU16(0),
  ]);
  return Buffer.concat([...locals, centralDir, eocd]);
}
