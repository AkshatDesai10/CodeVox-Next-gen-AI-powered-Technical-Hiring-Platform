import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { OpenAiClientService } from '../assessment-platform/assessment-ai/openai-client.service';

type CandidateResume = {
  skills: string[];
  experienceYears: number | null;
  experienceSummary: string;
  projectsSummary: string;
};

type ProblemCandidate = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  difficulty: string;
  kind: 'sql' | 'coding';
  score: number;
};

function parseJsonList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }
  }
  return [];
}

function clampCount(n: number, allowZero = false): number {
  if (!Number.isFinite(n)) return allowZero ? 0 : 3;
  const min = allowZero ? 0 : 1;
  return Math.min(8, Math.max(min, Math.trunc(n)));
}

function isSqlProblem(row: {
  workspace_type?: string | null;
  title?: string | null;
  topic_tags?: unknown;
}): boolean {
  const ws = String(row.workspace_type ?? '').toLowerCase();
  if (ws === 'sql' || ws === 'database') return true;
  const tags = parseJsonList(row.topic_tags).join(' ').toLowerCase();
  const title = String(row.title ?? '').toLowerCase();
  return title.includes('sql') || title.includes('database') || /\bsql\b/.test(tags);
}

function difficultyFromExperience(years: number | null): 'easy' | 'medium' | 'hard' {
  if (years == null) return 'medium';
  if (years < 2) return 'easy';
  if (years < 5) return 'medium';
  return 'hard';
}

function truncate(text: string, max = 180): string {
  const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (plain.length <= max) return plain;
  return `${plain.slice(0, max)}…`;
}

@Injectable()
export class CodingRoundProblemPickerService {
  private readonly logger = new Logger(CodingRoundProblemPickerService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly openai: OpenAiClientService,
  ) {}

  async pickProblemIds(input: {
    jobProfileId: string;
    stageId: string;
    candidateId: string;
    codingCount: number;
    sqlCount: number;
  }): Promise<string[]> {
    const codingCount = clampCount(input.codingCount, true);
    const sqlCount = clampCount(input.sqlCount, true);
    if (codingCount + sqlCount <= 0) return [];

    const resume = await this.loadResume(input.candidateId, input.jobProfileId);
    const competencies = await this.loadCompetencyNames(input.jobProfileId, input.stageId);
    const bank = await this.loadPublishedProblems();
    if (!bank.length) return [];

    const preferredDifficulty = difficultyFromExperience(resume.experienceYears);
    const scored = bank.map((row) =>
      this.scoreProblem(row, resume.skills, competencies, preferredDifficulty),
    );
    const codingPool = scored
      .filter((p) => p.kind === 'coding')
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
    const sqlPool = scored
      .filter((p) => p.kind === 'sql')
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);

    const codingIds = await this.pickFromPool(
      codingPool,
      resume,
      competencies,
      preferredDifficulty,
      codingCount,
      'coding',
    );
    const sqlIds = await this.pickFromPool(
      sqlPool,
      resume,
      competencies,
      preferredDifficulty,
      sqlCount,
      'sql',
    );
    return [...codingIds, ...sqlIds];
  }

  private async loadResume(candidateId: string, jobProfileId: string): Promise<CandidateResume> {
    const [candidate] = await this.dataSource.query(
      `SELECT skills, experience_years, experience_summary, projects_summary
       FROM candidates WHERE id = ? AND inactive = 0 LIMIT 1`,
      [candidateId],
    );
    const skills = parseJsonList(candidate?.skills);
    const yearsRaw = candidate?.experience_years;
    const experienceYears =
      yearsRaw != null && yearsRaw !== '' && Number.isFinite(Number(yearsRaw))
        ? Number(yearsRaw)
        : null;

    if (skills.length) {
      return {
        skills,
        experienceYears,
        experienceSummary: String(candidate?.experience_summary ?? '').trim(),
        projectsSummary: String(candidate?.projects_summary ?? '').trim(),
      };
    }

    const [profile] = await this.dataSource.query(
      `SELECT required_skills FROM job_profiles WHERE id = ? AND inactive = 0 LIMIT 1`,
      [jobProfileId],
    );
    return {
      skills: parseJsonList(profile?.required_skills),
      experienceYears,
      experienceSummary: String(candidate?.experience_summary ?? '').trim(),
      projectsSummary: String(candidate?.projects_summary ?? '').trim(),
    };
  }

  private async loadCompetencyNames(jobProfileId: string, stageId: string): Promise<string[]> {
    const rows = (await this.dataSource.query(
      `SELECT name, stage_id FROM job_profile_competencies
       WHERE job_profile_id = ? AND inactive = 0
         AND (stage_id = ? OR stage_id IS NULL OR stage_id = '')
       ORDER BY sort_order ASC`,
      [jobProfileId, stageId],
    )) as Array<{ name?: string; stage_id?: string | null }>;
    const stageRows = rows.filter((r) => r.stage_id);
    return (stageRows.length ? stageRows : rows)
      .map((r) => String(r.name ?? '').trim())
      .filter(Boolean);
  }

  private async loadPublishedProblems(): Promise<
    Array<{
      id: string;
      title: string;
      statement_md: string;
      topic_tags: unknown;
      difficulty: string | null;
      workspace_type: string | null;
    }>
  > {
    const rows = await this.dataSource.query(
      `SELECT id, title, statement_md, topic_tags, difficulty, workspace_type
       FROM problem_bank_problems
       WHERE inactive = 0 AND status = 'published'
       ORDER BY created_at DESC
       LIMIT 120`,
    );
    return rows as Array<{
      id: string;
      title: string;
      statement_md: string;
      topic_tags: unknown;
      difficulty: string | null;
      workspace_type: string | null;
    }>;
  }

  private scoreProblem(
    row: {
      id: string;
      title: string;
      statement_md: string;
      topic_tags: unknown;
      difficulty: string | null;
      workspace_type?: string | null;
    },
    skills: string[],
    competencies: string[],
    preferredDifficulty: string,
  ): ProblemCandidate {
    const tags = parseJsonList(row.topic_tags);
    const text = `${row.title ?? ''} ${row.statement_md ?? ''}`.toLowerCase();
    const blob = `${tags.join(' ')} ${text}`.toLowerCase();
    let score = 0;
    for (const name of competencies) {
      const n = name.toLowerCase();
      if (n && blob.includes(n)) score += 3;
    }
    for (const skill of skills) {
      const s = skill.toLowerCase();
      if (s && blob.includes(s)) score += 2;
    }
    const difficulty = String(row.difficulty ?? 'medium').toLowerCase();
    if (difficulty === preferredDifficulty) score += 3;
    else if (
      (preferredDifficulty === 'easy' && difficulty === 'medium') ||
      (preferredDifficulty === 'hard' && difficulty === 'medium')
    ) {
      score += 1;
    }

    return {
      id: String(row.id),
      title: String(row.title ?? 'Untitled'),
      summary: truncate(String(row.statement_md ?? '')),
      tags,
      difficulty,
      kind: isSqlProblem(row) ? 'sql' : 'coding',
      score,
    };
  }

  private async pickFromPool(
    pool: ProblemCandidate[],
    resume: CandidateResume,
    competencies: string[],
    preferredDifficulty: string,
    count: number,
    kind: 'coding' | 'sql',
  ): Promise<string[]> {
    if (count <= 0 || !pool.length) return [];
    const fallbackIds = pool.slice(0, count).map((p) => p.id);
    if (!this.openai.isConfigured()) return fallbackIds;

    try {
      const picked = await this.pickWithAi(
        pool,
        resume,
        competencies,
        preferredDifficulty,
        count,
        kind,
      );
      const valid = new Set(pool.map((p) => p.id));
      const ids = (picked ?? []).map(String).filter((id) => valid.has(id));
      if (!ids.length) return fallbackIds;
      const filled = [...ids];
      for (const id of fallbackIds) {
        if (filled.length >= count) break;
        if (!filled.includes(id)) filled.push(id);
      }
      return filled.slice(0, count);
    } catch (err) {
      this.logger.warn(`AI ${kind} problem pick failed, using scored fallback: ${String(err)}`);
      return fallbackIds;
    }
  }

  private async pickWithAi(
    candidates: ProblemCandidate[],
    resume: CandidateResume,
    competencies: string[],
    preferredDifficulty: string,
    count: number,
    kind: 'coding' | 'sql',
  ): Promise<string[]> {
    const kindLabel = kind === 'sql' ? 'SQL / database' : 'coding';
    const result = await this.openai.chatJson<{ problem_ids?: string[] }>([
      {
        role: 'system',
        content: `You pick ${kindLabel} assessment problems from an existing Problem Bank for one candidate.
Return JSON: { "problem_ids": string[] }
Rules:
- Only use IDs from the provided candidate list.
- Pick only ${kindLabel} problems.
- Match the candidate resume (skills, experience, projects) and the round competency rubric.
- Prefer difficulty close to "${preferredDifficulty}".
- Do not exceed ${count} problem_ids.
- Prefer a spread of topics when possible.`,
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            kind,
            candidate: {
              skills: resume.skills.slice(0, 16),
              experience_years: resume.experienceYears,
              experience_summary: truncate(resume.experienceSummary, 400),
              projects_summary: truncate(resume.projectsSummary, 400),
            },
            rubric_competencies: competencies,
            count,
            problem_candidates: candidates.map((p) => ({
              id: p.id,
              title: p.title,
              tags: p.tags,
              difficulty: p.difficulty,
              kind: p.kind,
              summary: p.summary,
              score: p.score,
            })),
          },
          null,
          0,
        ),
      },
    ]);
    return Array.isArray(result?.problem_ids) ? result.problem_ids : [];
  }
}
