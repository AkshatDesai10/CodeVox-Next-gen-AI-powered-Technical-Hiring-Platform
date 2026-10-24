import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { AssessmentExecutionRepository } from '../assessment-execution.repository';
import { resolveSubmissionSourceCode } from '../utils/php-assessment-adapter';
import {
  defaultDockerRuntimeConfig,
  runDockerCommand,
  volumeMount,
} from '../execution/docker-runtime.util';
import type { PlagiarismJobPayload } from './plagiarism.constants';

type DolosLanguage = {
  dolosLang: string;
  extension: string;
};

function resolveDolosLanguage(language: string): DolosLanguage {
  const lang = language.trim().toUpperCase();
  if (lang === 'PHP') return { dolosLang: 'php', extension: 'php' };
  if (lang === 'PYTHON' || lang === 'PY') return { dolosLang: 'python', extension: 'py' };
  if (lang === 'NODE' || lang === 'JAVASCRIPT' || lang === 'JS') {
    return { dolosLang: 'javascript', extension: 'js' };
  }
  return { dolosLang: 'python', extension: 'txt' };
}

function plagiarismFlagThreshold(): number {
  const raw = Number(process.env.PLAGIARISM_FLAG_THRESHOLD ?? 0.8);
  return Number.isFinite(raw) ? raw : 0.8;
}

function plagiarismFailOpen(): boolean {
  const raw = (process.env.PLAGIARISM_FAIL_OPEN ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0';
}

@Injectable()
export class PlagiarismDetectorService {
  private readonly log = new Logger(PlagiarismDetectorService.name);

  constructor(private readonly repo: AssessmentExecutionRepository) {}

  async runPlagiarismCheck(params: PlagiarismJobPayload): Promise<number> {
    const normalizedCode = resolveSubmissionSourceCode(params.sourceCode).trim();
    if (!normalizedCode) return 0;

    const { dolosLang, extension } = resolveDolosLanguage(params.language);
    const scanId = randomUUID();
    const scratchDir = resolve(
      join(process.cwd(), 'tmp', 'scans', String(params.candidateId), String(params.questionId), scanId),
    );

    try {
      await mkdir(scratchDir, { recursive: true });

      const currentFileName = `current_main.${extension}`;
      await writeFile(join(scratchDir, currentFileName), normalizedCode, 'utf8');

      const history = await this.repo.getHistoricalSubmissionsForQuestion(
        params.questionId,
        params.candidateId,
      );
      const writtenHistory: string[] = [];
      for (const row of history) {
        const peerCode = resolveSubmissionSourceCode(row.sourceCode).trim();
        if (!peerCode) continue;
        const safeId = String(row.candidateId).replace(/[^\w-]/g, '_');
        const historyName = `history_${safeId}.${extension}`;
        if (writtenHistory.includes(historyName)) continue;
        await writeFile(join(scratchDir, historyName), peerCode, 'utf8');
        writtenHistory.push(historyName);
      }

      if (!writtenHistory.length) return 0;

      const inputFiles = [currentFileName, ...writtenHistory];
      const dockerImage =
        process.env.DOLOS_DOCKER_IMAGE?.trim() || 'ghcr.io/dodona-edu/dolos-cli:2.7.0';
      const config = defaultDockerRuntimeConfig();
      const timeoutMs = Number(process.env.PLAGIARISM_DOCKER_TIMEOUT_MS ?? 120000);
      const mount = volumeMount(scratchDir, 'rw');

      const args = [
        'run',
        '--rm',
        '--memory',
        '512m',
        '--cpus',
        '1.0',
        '-v',
        mount,
        '-w',
        '/workspace',
        dockerImage,
        'run',
        '-l',
        dolosLang,
        '-f',
        'csv',
        '-o',
        '/workspace/dolos-report',
        ...inputFiles.map((name) => `/workspace/${name}`),
      ];

      const result = await runDockerCommand(config, args, undefined, { timeoutMs });
      if (!result.success) {
        this.log.warn(
          `Dolos failed for question ${params.questionId}: ${result.stderr || result.stdout}`,
        );
        return plagiarismFailOpen() ? 0 : 0;
      }

      return this.readMaxSimilarityForCurrent(scratchDir, currentFileName);
    } finally {
      await rm(scratchDir, { recursive: true, force: true }).catch((err) => {
        this.log.warn(`Failed to remove plagiarism scratch dir ${scratchDir}: ${String(err)}`);
      });
    }
  }

  private async readMaxSimilarityForCurrent(scratchDir: string, currentFileName: string): Promise<number> {
    const pairsPath = join(scratchDir, 'dolos-report', 'pairs.csv');
    let csvText = '';
    try {
      csvText = await readFile(pairsPath, 'utf8');
    } catch {
      this.log.warn(`Dolos pairs.csv not found at ${pairsPath}`);
      return 0;
    }
    return parseMaxSimilarityFromPairsCsv(csvText, currentFileName);
  }

  async persistPlagiarismResult(params: PlagiarismJobPayload, score: number): Promise<void> {
    const threshold = plagiarismFlagThreshold();
    await this.repo.updateSubmissionPlagiarism({
      candidateAssessmentId: params.candidateAssessmentId,
      questionId: params.questionId,
      plagiarismScore: score,
      plagiarismFlagged: score > threshold,
      plagiarismCheckedAt: new Date(),
    });
  }
}

function parseMaxSimilarityFromPairsCsv(csv: string, currentFileName: string): number {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return 0;

  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const leftIdx = resolvePairsCsvPathColumnIndex(header, 'left');
  const rightIdx = resolvePairsCsvPathColumnIndex(header, 'right');
  const simIdx = header.findIndex((h) => h === 'similarity' || h.includes('similarity'));
  if (simIdx === -1 || leftIdx === -1 || rightIdx === -1) return 0;

  let max = 0;
  const currentToken = currentFileName.toLowerCase();
  for (let i = 1; i < lines.length; i += 1) {
    const cells = splitCsvLine(lines[i]);
    const left = (cells[leftIdx] ?? '').toLowerCase();
    const right = (cells[rightIdx] ?? '').toLowerCase();
    if (!left.includes(currentToken) && !right.includes(currentToken)) continue;
    const similarity = Number(cells[simIdx]);
    if (Number.isFinite(similarity) && similarity > max) {
      max = similarity;
    }
  }
  return max;
}

function resolvePairsCsvPathColumnIndex(header: string[], side: 'left' | 'right'): number {
  const pathIdx = header.findIndex((h) => h.includes(side) && h.includes('path'));
  if (pathIdx !== -1) return pathIdx;
  const fileIdx = header.findIndex((h) => h.includes(side) && h.includes('file') && !h.includes('id'));
  if (fileIdx !== -1) return fileIdx;
  return header.findIndex((h) => h === side);
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ',' && !inQuotes) {
      cells.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  cells.push(current);
  return cells;
}
