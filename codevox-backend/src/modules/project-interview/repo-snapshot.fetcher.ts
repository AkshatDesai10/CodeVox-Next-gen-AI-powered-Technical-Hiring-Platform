import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join, relative } from 'path';

/** Bounded, source-light view of a candidate repo; the clone itself never outlives the fetch. */
export type RepoSnapshot = {
  repo_url: string;
  branch: string | null;
  readme: string;
  decisions_md: string | null;
  manifests: Record<string, string>;
  config_files: Record<string, string>;
  key_source_files: Record<string, string>;
  file_tree: string[];
  file_count: number;
  has_tests: boolean;
  truncated: boolean;
};

export interface RepoSnapshotFetcher {
  fetch(repoUrl: string, branch?: string | null): Promise<RepoSnapshot>;
  /** Optional fast public check before clone/submit. */
  assertPublicGithubRepo?(repoUrl: string): Promise<void>;
}

export const REPO_SNAPSHOT_FETCHER = Symbol('REPO_SNAPSHOT_FETCHER');

/** Thrown when the repo cannot be cloned; the candidate can fix the URL and resubmit. */
export class RepoFetchError extends Error {}

const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?(\.git)?\/?$/;
const BRANCH_RE = /^[A-Za-z0-9._\/-]{1,100}$/;

export function normalizeGithubRepoUrl(raw: string): string | null {
  const url = (raw ?? '').trim().replace(/\/+$/, '');
  if (!GITHUB_URL_RE.test(url)) return null;
  return url.replace(/\.git$/, '');
}

export function isSafeBranchName(raw: string | null | undefined): boolean {
  if (!raw) return true;
  const b = raw.trim();
  return BRANCH_RE.test(b) && !b.startsWith('-') && !b.includes('..');
}

/** owner/repo from a normalized https://github.com/owner/repo URL. */
export function parseGithubOwnerRepo(repoUrl: string): { owner: string; repo: string } | null {
  const url = normalizeGithubRepoUrl(repoUrl);
  if (!url) return null;
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)$/i.exec(url);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  'coverage',
  'target',
  'vendor',
  '.idea',
  '.vscode',
  '.gradle',
  'bin',
  'obj',
]);

const MANIFEST_NAMES = new Set([
  'package.json',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'composer.json',
  'go.mod',
  'pom.xml',
  'build.gradle',
  'Cargo.toml',
  'Gemfile',
]);

const CONFIG_FILE_RE =
  /^(\.env\.(example|sample|template)|vite\.config\.[cm]?[jt]s|next\.config\.[cm]?[jt]s|webpack\.config\.[jt]s|tsconfig\.json|docker-compose\.ya?ml|Dockerfile|\.babelrc|babel\.config\.[jt]s|tailwind\.config\.[cm]?[jt]s|angular\.json|nodemon\.json|Procfile|vercel\.json|netlify\.toml|settings\.py|application\.(properties|ya?ml)|firebase\.json|prisma\.schema|schema\.prisma)$/i;

const SOURCE_EXT_RE = /\.(m?[jt]sx?|py|java|go|rb|php|cs|kt|rs|vue|svelte|dart|sql|md|txt|csv)$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|spec)(\/|$)|\.(test|spec)\.[a-z]+$|(^|\/)test_[^/]+\.py$/i;

const MAX_TREE_ENTRIES = 600;
const MAX_FILE_BYTES = 200_000;
const MANIFEST_CHARS = 4000;
const CONFIG_CHARS = 2000;
const SOURCE_CHARS = 2500;
const MAX_SOURCE_FILES = 20;

function sourcePriority(rel: string): number {
  const lower = rel.toLowerCase();
  const name = basename(lower);
  const depth = rel.split('/').length;
  let score = 0;
  if (/\.(sql|md|txt|csv)$/.test(name)) score += 80;
  if (/^(index|main|app|server|api|routes?|urls|wsgi|asgi|manage)\.[a-z]+$/.test(name)) score += 50;
  if (/(^|\/)(routes?|controllers?|api|services?|models?|schemas?|middlewares?|config|store|context|hooks|views)\//.test(lower)) score += 30;
  if (/(axios|api|http|client|db|database|auth|config|store)\.[a-z]+$/.test(name)) score += 25;
  score -= depth * 3;
  return score;
}

/** Builds a snapshot from an already-checked-out directory (exposed for tests with a dummy repo). */
export async function buildRepoSnapshotFromDirectory(
  root: string,
  meta: { repoUrl: string; branch?: string | null },
): Promise<RepoSnapshot> {
  const tree: string[] = [];
  const files: string[] = [];
  let truncated = false;

  const walk = async (dir: string, depth: number) => {
    if (depth > 8) return;
    let entries: string[];
    try {
      entries = (await readdir(dir)).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (SKIP_DIRS.has(name)) continue;
      const full = join(dir, name);
      let info;
      try {
        info = await stat(full);
      } catch {
        continue;
      }
      const rel = relative(root, full).replace(/\\/g, '/');
      if (info.isDirectory()) {
        if (tree.length < MAX_TREE_ENTRIES) tree.push(`${rel}/`);
        else truncated = true;
        await walk(full, depth + 1);
      } else if (info.isFile()) {
        files.push(rel);
        if (tree.length < MAX_TREE_ENTRIES) tree.push(rel);
        else truncated = true;
      }
    }
  };
  await walk(root, 0);

  const read = async (rel: string, max: number): Promise<string | null> => {
    try {
      const full = join(root, rel);
      const info = await stat(full);
      if (info.size > MAX_FILE_BYTES) return null;
      const body = await readFile(full, 'utf8');
      return body.length > max ? `${body.slice(0, max)}\n…[truncated]` : body;
    } catch {
      return null;
    }
  };

  const readmeRel = files.find((f) => /^readme(\.(md|txt|rst))?$/i.test(f));
  const decisionsRel = files.find((f) => /^decisions\.md$/i.test(basename(f)) && f.split('/').length <= 2);

  const manifests: Record<string, string> = {};
  for (const rel of files.filter((f) => MANIFEST_NAMES.has(basename(f)) && f.split('/').length <= 3).slice(0, 8)) {
    const body = await read(rel, MANIFEST_CHARS);
    if (body != null) manifests[rel] = body;
  }

  const configFiles: Record<string, string> = {};
  for (const rel of files.filter((f) => CONFIG_FILE_RE.test(basename(f))).slice(0, 10)) {
    const body = await read(rel, CONFIG_CHARS);
    if (body != null) configFiles[rel] = body;
  }

  const sourceCandidates = files
    .filter((f) => SOURCE_EXT_RE.test(f) && !TEST_RE.test(f) && !CONFIG_FILE_RE.test(basename(f)))
    .map((f) => ({ f, p: sourcePriority(f) }))
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_SOURCE_FILES);
  const keySource: Record<string, string> = {};
  for (const { f } of sourceCandidates) {
    const body = await read(f, /\.(sql|md|txt|csv)$/i.test(f) ? 12_000 : SOURCE_CHARS);
    if (body != null) keySource[f] = body;
  }

  return {
    repo_url: meta.repoUrl,
    branch: meta.branch?.trim() || null,
    readme: readmeRel ? ((await read(readmeRel, 12_000)) ?? '') : '',
    decisions_md: decisionsRel ? await read(decisionsRel, 6000) : null,
    manifests,
    config_files: configFiles,
    key_source_files: keySource,
    file_tree: tree,
    file_count: files.length,
    has_tests: files.some((f) => TEST_RE.test(f)),
    truncated,
  };
}

@Injectable()
export class GitRepoSnapshotFetcher implements RepoSnapshotFetcher {
  private readonly logger = new Logger(GitRepoSnapshotFetcher.name);

  constructor(private readonly config: ConfigService) {}

  private githubToken(): string | undefined {
    return (
      this.config.get<string>('GITHUB_PROJECT_INTERVIEW_TOKEN')?.trim() ||
      this.config.get<string>('GITHUB_TAKEHOME_TOKEN')?.trim() ||
      undefined
    );
  }

  /**
   * Fast public-visibility check via GitHub REST API (PAT).
   * Rejects private repos even when the org PAT can still clone them.
   */
  async assertPublicGithubRepo(repoUrl: string): Promise<void> {
    const parsed = parseGithubOwnerRepo(repoUrl);
    if (!parsed) {
      throw new RepoFetchError('Enter a public repository URL like https://github.com/owner/repo');
    }
    const token = this.githubToken();
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'recruitment-project-interview',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
        { method: 'GET', headers, signal: controller.signal },
      );
      if (res.status === 404) {
        throw new RepoFetchError(
          'Repository not found. Please verify the URL.',
        );
      }
      if (res.status === 403) {
        const body = await res.text().catch(() => '');
        if (/rate limit/i.test(body)) {
          this.logger.warn(`GitHub API rate limited while checking ${repoUrl}`);
          // Soft-pass: still allow clone path; clone will fail clearly if inaccessible.
          return;
        }
        throw new RepoFetchError(
          'This repository is private or inaccessible. Please set visibility to Public in GitHub Settings → Danger Zone before submitting.',
        );
      }
      if (!res.ok) {
        throw new RepoFetchError(
          `Could not verify the repository (HTTP ${res.status}). Please try again.`,
        );
      }
      const data = (await res.json()) as { private?: boolean };
      if (data.private === true) {
        throw new RepoFetchError(
          "This repository is marked Private. Please change repository visibility to 'Public' in GitHub Settings → Danger Zone before submitting.",
        );
      }
    } catch (err) {
      if (err instanceof RepoFetchError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new RepoFetchError('Repository verification timed out. Please try again.');
      }
      this.logger.warn(
        `GitHub public check failed for ${repoUrl}: ${err instanceof Error ? err.message : err}`,
      );
      throw new RepoFetchError('Could not verify the repository. Please try again.');
    } finally {
      clearTimeout(timer);
    }
  }

  async fetch(repoUrl: string, branch?: string | null): Promise<RepoSnapshot> {
    const url = normalizeGithubRepoUrl(repoUrl);
    if (!url) throw new RepoFetchError('Only public https://github.com/<owner>/<repo> URLs are supported.');
    if (!isSafeBranchName(branch)) throw new RepoFetchError('Invalid branch name.');

    const dir = await mkdtemp(join(tmpdir(), 'project-defense-'));
    try {
      await this.shallowClone(url, join(dir, 'repo'), branch?.trim() || undefined);
      return await buildRepoSnapshotFromDirectory(join(dir, 'repo'), { repoUrl: url, branch });
    } finally {
      await rm(dir, { recursive: true, force: true }).catch((err) =>
        this.logger.warn(`Failed to remove temp clone ${dir}: ${err instanceof Error ? err.message : err}`),
      );
    }
  }

  private shallowClone(url: string, dest: string, branch?: string): Promise<void> {
    const token = this.githubToken();
    const cloneUrl = token ? url.replace(/^https:\/\//i, `https://${token}@`) : url;
    const args = ['-c', 'core.symlinks=false', 'clone', '--depth', '1', '--single-branch', '--no-tags'];
    if (branch) args.push('--branch', branch);
    args.push('--', cloneUrl, dest);

    return new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_LFS_SKIP_SMUDGE: '1' },
      });
      let stderr = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new RepoFetchError('Cloning the repository timed out.'));
      }, 45_000);
      child.stderr.on('data', (d) => (stderr += String(d)));
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(new Error(`git unavailable: ${err.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) return resolve();
        const msg = (token ? stderr.split(token).join('***') : stderr).trim();
        this.logger.warn(`git clone failed (${code}) for ${url}: ${msg.slice(0, 400)}`);
        reject(
          new RepoFetchError(
            /not found|could not read|authentication|repository .* does not exist/i.test(msg)
              ? "We couldn't access your code. Please make sure the repository is public and the code is pushed"
              : /remote branch .* not found/i.test(msg)
                ? `Branch "${branch}" was not found in the repository.`
                : "We couldn't access your code. Please make sure the repository is public and the code is pushed",
          ),
        );
      });
    });
  }
}
