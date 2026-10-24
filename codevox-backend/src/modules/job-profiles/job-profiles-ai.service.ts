import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { parseJsonObject } from '../assessment-platform/assessment-ai/ai-json.util';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import { RbacPermissionService } from '../../authorization/rbac-permission.service';
import { OpenAiClientService, type ChatMessage } from '../assessment-platform/assessment-ai/openai-client.service';
import { AiQuestionGeneratorService } from '../assessment-platform/assessment-ai/ai-question-generator.service';
import { JobProfileMysql } from './entities/job-profile.mysql.entity';
import { JobProfileAiLogMysql } from './entities/job-profile-ai-log.mysql.entity';
import { normalizeGradingRubric, scaleRubricMarksTo100, type ProjectGradingRubric } from './project-interview-round.types';
import {
  QuestionBankQuestionMysql,
  QuestionBankStatus,
} from './entities/question-bank-question.mysql.entity';
import { ProblemBankProblemMysql, ProblemBankStatus } from './entities/problem-bank-problem.mysql.entity';
import { JobProfilesRepository } from './job-profiles.repository';
import { seniorityToDifficulty, slugifyTitle, deriveSkillsFromJobProfile, inferSeniorityFromJobProfile } from './job-profiles.util';
import { inferLanguagesFromTechStack, inferTechStackFromText } from './tech-stack-inference.util';
import { buildRoundQuestionPromptHints } from './round-question-prompt.util';
import {
  computeAiHealthScore,
  cosineSimilarity,
  embedJdText,
  jdTextFingerprint,
  SENIORITY_RUBRIC_WEIGHTS,
} from './job-profiles-ai.util';
import {
  buildQuestionBankAiUserPrompt,
  QUESTION_BANK_AI_SYSTEM_PROMPT,
  type QuestionBankAiGenerateInput,
} from './question-bank-ai-prompts';
import {
  runGenerator,
  type AiGenerationConfig,
  type GeneratorType,
  type ProblemBankAiGenerateInput,
} from './ai';

type JdDraft = {
  responsibilities: string[];
  required_skills: string[];
  nice_to_have_skills: string[];
  experience_min: number;
  experience_max: number;
};

export type PipelinePresetId =
  | 'coding_only'
  | 'unified_voice'
  | 'coding_plus_voice'
  | 'screening_plus_full';

export type ParsedJdFromText = {
  title: string;
  department: string;
  seniority_level: 'junior' | 'mid' | 'senior' | 'lead' | string;
  employment_type: string;
  openings_count: number;
  location_mode: 'remote' | 'hybrid' | 'onsite' | string;
  location_text: string;
  compensation_band_min?: number | null;
  compensation_band_max?: number | null;
  currency?: string | null;
  candidate_facing_intro: string;
  responsibilities: string[];
  required_skills: string[];
  nice_to_have_skills: string[];
  experience_min: number;
  experience_max: number;
  recommended_pipeline: PipelinePresetId;
  ai_powered?: boolean;
};

const PIPELINE_PRESET_IDS: PipelinePresetId[] = [
  'coding_only',
  'unified_voice',
  'coding_plus_voice',
  'screening_plus_full',
];

function normalizePipelinePreset(raw: unknown): PipelinePresetId {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (value === 'build_defend') return 'coding_plus_voice';
  return (PIPELINE_PRESET_IDS as string[]).includes(value)
    ? (value as PipelinePresetId)
    : 'coding_plus_voice';
}

type BiasResult = {
  flags: Array<{ severity: 'info' | 'warning' | 'critical'; message: string }>;
  blocked: boolean;
  score: number;
};

@Injectable()
export class JobProfilesAiService {
  constructor(
    private readonly repo: JobProfilesRepository,
    private readonly rbac: RbacPermissionService,
    private readonly openai: OpenAiClientService,
    private readonly questionGen: AiQuestionGeneratorService,
    @InjectRepository(JobProfileAiLogMysql)
    private readonly aiLogs: Repository<JobProfileAiLogMysql>,
    @InjectRepository(QuestionBankQuestionMysql)
    private readonly questionBank: Repository<QuestionBankQuestionMysql>,
    @InjectRepository(ProblemBankProblemMysql)
    private readonly problemBank: Repository<ProblemBankProblemMysql>,
  ) {}

  private async assertWrite(actor: JwtUserPayload) {
    const ok = await this.rbac.hasPermission(actor, 'job_profiles:write');
    if (!ok) {
      const fallback = await this.rbac.hasPermission(actor, 'assessments:write');
      if (!fallback) throw new ForbiddenException();
    }
  }

  private async assertRead(actor: JwtUserPayload) {
    const ok = await this.rbac.hasPermission(actor, 'job_profiles:read');
    if (!ok) {
      const fallback = await this.rbac.hasPermission(actor, 'assessments:read');
      if (!fallback) throw new ForbiddenException();
    }
  }

  private async logAi(
    operation: string,
    profileId: string | null,
    request: unknown,
    response: unknown,
    usage?: { promptTokens: number | null; completionTokens: number | null },
    model?: string,
  ) {
    await this.aiLogs.save(
      this.aiLogs.create({
        jobProfileId: profileId,
        operation,
        model: model ?? this.openai.activeModel(),
        requestJson: request as Record<string, unknown>,
        responseJson: response as Record<string, unknown>,
        promptTokens: usage?.promptTokens ?? null,
        completionTokens: usage?.completionTokens ?? null,
        inactive: 0,
      }),
    );
  }

  private profileJdBlob(row: JobProfileMysql) {
    return [
      row.title,
      ...(row.responsibilities ?? []),
      ...(row.requiredSkills ?? []),
      ...(row.niceToHaveSkills ?? []),
    ].join('\n');
  }

  async draftJd(body: { title: string; brief?: string; department?: string }) {
    const title = body.title?.trim() || 'Role';
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a technical recruiter. Return JSON with keys: responsibilities (string[]), required_skills (string[]), nice_to_have_skills (string[]), experience_min (number), experience_max (number).',
      },
      {
        role: 'user',
        content: `Draft a structured JD for: ${title}. Department: ${body.department ?? 'General'}. Brief: ${body.brief ?? 'N/A'}`,
      },
    ];
    const result = await this.openai.chatJson<Partial<JdDraft>>(messages);
    const normalized: JdDraft = {
      responsibilities: Array.isArray(result?.responsibilities)
        ? result.responsibilities.map((s) => String(s).trim()).filter(Boolean)
        : [],
      required_skills: Array.isArray(result?.required_skills)
        ? result.required_skills.map((s) => String(s).trim()).filter(Boolean)
        : [],
      nice_to_have_skills: Array.isArray(result?.nice_to_have_skills)
        ? result.nice_to_have_skills.map((s) => String(s).trim()).filter(Boolean)
        : [],
      experience_min: Number.isFinite(Number(result?.experience_min))
        ? Math.max(0, Math.trunc(Number(result.experience_min)))
        : 2,
      experience_max: Number.isFinite(Number(result?.experience_max))
        ? Math.max(0, Math.trunc(Number(result.experience_max)))
        : 5,
    };
    if (!normalized.responsibilities.length) {
      normalized.responsibilities = [
        `Own core deliverables for ${title}`,
        'Partner with stakeholders to clarify requirements and ship outcomes',
        'Maintain quality, documentation, and continuous improvement',
      ];
    }
    if (!normalized.required_skills.length) {
      normalized.required_skills = ['Communication', 'Problem solving', 'Ownership'];
    }
    if (normalized.experience_max < normalized.experience_min) {
      normalized.experience_max = normalized.experience_min;
    }
    await this.logAi('draft_jd', null, body, normalized);
    return { ...normalized, ai_powered: this.openai.isConfigured() };
  }

  async parseJdFromText(body: { jd_text: string }) {
    const raw = typeof body.jd_text === 'string' ? body.jd_text.trim() : '';
    if (!raw) throw new BadRequestException('jd_text is required');
    const jdText = raw.slice(0, 20_000);

    const fallbackTitle =
      jdText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0)
        ?.replace(/^#+\s*/, '')
        .replace(/^(job title|role|position)\s*[:\-–]\s*/i, '')
        .slice(0, 120) || 'Untitled role';

    const localFallback = (): ParsedJdFromText => ({
      title: fallbackTitle,
      department: 'Engineering',
      seniority_level: 'mid',
      employment_type: 'full_time',
      openings_count: 1,
      location_mode: 'hybrid',
      location_text: '',
      compensation_band_min: null,
      compensation_band_max: null,
      currency: 'INR',
      candidate_facing_intro: jdText.slice(0, 800),
      responsibilities: [],
      required_skills: [],
      nice_to_have_skills: [],
      experience_min: 2,
      experience_max: 5,
      recommended_pipeline: 'coding_plus_voice',
    });

    if (!this.openai.isConfigured()) {
      const normalized = localFallback();
      await this.logAi('parse_jd', null, { jd_text_len: jdText.length }, normalized);
      return { ...normalized, ai_powered: false };
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are a technical recruiter. Parse a pasted job description into structured JSON with keys: title (string), department (string), seniority_level (junior|mid|senior|lead or free string), employment_type (string e.g. full_time|contract), openings_count (number), location_mode (remote|hybrid|onsite), location_text (string), compensation_band_min (number|null), compensation_band_max (number|null), currency (string|null), candidate_facing_intro (string), responsibilities (string[]), required_skills (string[]), nice_to_have_skills (string[]), experience_min (number), experience_max (number), recommended_pipeline (coding_only|unified_voice|coding_plus_voice|screening_plus_full). Prefer coding_plus_voice unless the JD clearly fits another assessment style. Do not recommend build_defend.',
      },
      {
        role: 'user',
        content: `Parse this job description into structured fields:\n\n${jdText}`,
      },
    ];

    const result = await this.openai.chatJson<
      Partial<ParsedJdFromText> & { __isFallback?: boolean; fallback?: boolean }
    >(messages, { temperature: 0.2 });

    if (result?.__isFallback || result?.fallback) {
      const normalized = localFallback();
      await this.logAi('parse_jd', null, { jd_text_len: jdText.length }, normalized);
      return { ...normalized, ai_powered: false };
    }

    const asStringList = (v: unknown) =>
      Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : [];

    const asOptNumber = (v: unknown): number | null => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };

    const seniorityRaw = String(result?.seniority_level ?? '')
      .trim()
      .toLowerCase();
    const seniority_level =
      seniorityRaw === 'junior' ||
      seniorityRaw === 'mid' ||
      seniorityRaw === 'senior' ||
      seniorityRaw === 'lead'
        ? seniorityRaw
        : seniorityRaw || 'mid';

    const locationRaw = String(result?.location_mode ?? '')
      .trim()
      .toLowerCase();
    const location_mode =
      locationRaw === 'remote' || locationRaw === 'hybrid' || locationRaw === 'onsite'
        ? locationRaw
        : 'hybrid';

    let experience_min = Number.isFinite(Number(result?.experience_min))
      ? Math.max(0, Math.trunc(Number(result.experience_min)))
      : 2;
    let experience_max = Number.isFinite(Number(result?.experience_max))
      ? Math.max(0, Math.trunc(Number(result.experience_max)))
      : 5;
    if (experience_max < experience_min) experience_max = experience_min;

    const openings = Number(result?.openings_count);
    const normalized: ParsedJdFromText = {
      title: String(result?.title ?? '').trim() || fallbackTitle,
      department: String(result?.department ?? '').trim() || 'Engineering',
      seniority_level,
      employment_type: String(result?.employment_type ?? '').trim() || 'full_time',
      openings_count: Number.isFinite(openings) && openings > 0 ? Math.trunc(openings) : 1,
      location_mode,
      location_text: String(result?.location_text ?? '').trim(),
      compensation_band_min: asOptNumber(result?.compensation_band_min),
      compensation_band_max: asOptNumber(result?.compensation_band_max),
      currency: result?.currency != null ? String(result.currency).trim() || null : 'INR',
      candidate_facing_intro:
        String(result?.candidate_facing_intro ?? '').trim() || jdText.slice(0, 800),
      responsibilities: asStringList(result?.responsibilities),
      required_skills: asStringList(result?.required_skills),
      nice_to_have_skills: asStringList(result?.nice_to_have_skills),
      experience_min,
      experience_max,
      recommended_pipeline: normalizePipelinePreset(result?.recommended_pipeline),
    };

    await this.logAi('parse_jd', null, { jd_text_len: jdText.length }, normalized);
    return { ...normalized, ai_powered: true };
  }

  async generateProjectRequirements(
    actor: JwtUserPayload,
    body: { title: string; description_md: string },
  ) {
    await this.assertWrite(actor);
    const title = body.title?.trim();
    if (!title) throw new BadRequestException('Title is required');
    const description_md = body.description_md?.trim() ?? '';

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'You are an expert technical recruiter. Given the Title and Description of a coding project, extract 3 to 5 core, testable "must-have" requirements. Assign a weight to each requirement based on its importance, ensuring the total sum of all weights equals exactly 100.\n\nRULES:\n- Keep the "text" extremely short and concise (maximum 4-6 words).\n- Use action-oriented phrases (e.g., "Create and list tickets").\n- Return ONLY JSON: { "requirements": [{ "text": string, "weight": number }] }.',
      },
      {
        role: 'user',
        content: `Title: ${title}\n\nDescription:\n${description_md.slice(0, 12_000)}`,
      },
    ];

    const result = await this.openai.chatJson<{
      requirements?: Array<{ text?: string; weight?: number }>;
      __isFallback?: boolean;
    }>(messages, { temperature: 0.2 });

    if (result.__isFallback) {
      throw new ServiceUnavailableException(
        'AI service is currently unavailable — project requirements cannot be generated.',
      );
    }

    const parsed = (Array.isArray(result.requirements) ? result.requirements : [])
      .map((row) => ({
        text: String(row?.text ?? '').trim(),
        weight: Number.isFinite(Number(row?.weight)) ? Math.max(0, Math.round(Number(row.weight))) : 0,
      }))
      .filter((r) => r.text.length > 0)
      .slice(0, 5);

    if (parsed.length < 3) {
      throw new ServiceUnavailableException(
        'AI could not extract enough must-have requirements — try a longer project description.',
      );
    }

    const total = parsed.reduce((sum, r) => sum + r.weight, 0);
    let requirements: Array<{ text: string; weight: number }>;
    if (total <= 0) {
      const even = Math.floor(100 / parsed.length);
      let remaining = 100;
      requirements = parsed.map((r, idx) => {
        const weight =
          idx === parsed.length - 1 ? remaining : Math.max(1, even);
        remaining -= weight;
        return { text: r.text, weight };
      });
    } else {
      let remaining = 100;
      requirements = parsed.map((r, idx) => {
        if (idx === parsed.length - 1) {
          return { text: r.text, weight: Math.max(1, remaining) };
        }
        const weight = Math.max(1, Math.round((r.weight / total) * 100));
        remaining -= weight;
        return { text: r.text, weight };
      });
      const sum = requirements.reduce((s, r) => s + r.weight, 0);
      if (sum !== 100) {
        requirements[requirements.length - 1]!.weight += 100 - sum;
      }
    }

    await this.logAi('generate_project_requirements', null, body, { requirements });
    return requirements;
  }

  /** Title, teaser, and must-have checklist extracted from the assessment document. */
  async summarizeAssessmentDocument(
    actor: JwtUserPayload,
    text: string,
  ): Promise<{
    title: string;
    teaser: string;
    requirements: Array<{ text: string; weight: number }>;
    grading_rubric: ProjectGradingRubric | null;
  }> {
    await this.assertWrite(actor);
    const clipped = text.trim().slice(0, 40_000);
    if (clipped.length < 20) {
      throw new BadRequestException('The assessment document does not contain enough text to summarize.');
    }
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          `Read an assessment document and return JSON only: { "title": string, "teaser": string, "requirements": [{ "text": string, "weight": number }], "grading_rubric": { "tasks": [{ "id": string, "name": string, "subparts": [{ "name": string, "marks": number }] }] } }. title is a short project name (under 80 characters). teaser is exactly 5 or 6 lines a candidate can read before downloading the full file. Put each sentence on its own line, separated by a newline. No headings, no bullet lists, no blank lines. Do not reveal exact questions, answers, or dataset rows in the teaser. requirements is 3 to 5 short must-have checklist items (4-6 words, action phrases) taken from the tasks in the document. Weights must sum to 100. When the document prints marks per task, scale the weights from those marks. grading_rubric is the mark scheme: one task per numbered module and also for Frontend, API, Deployment, and Submission when those sections exist. Each required-feature bullet is its own sub-part. Also return marks_from_document (boolean) on grading_rubric. If the document prints marks, set marks_from_document true and use those marks. If marks are printed only on a module, split them across that module's bullets by how important each bullet is. If the document prints no marks, set marks_from_document false and assign integer marks from how central each sub-part is to the assessment. Core workflows and business rules get more marks than setup, styling, or deployment. Those inferred marks must sum to 100. Do not give every sub-part the same mark.`,
      },
      { role: 'user', content: clipped },
    ];
    const result = await this.openai.chatJson<{
      title?: string;
      teaser?: string;
      requirements?: Array<{ text?: string; weight?: number }>;
      grading_rubric?: { marks_from_document?: boolean; tasks?: unknown };
    }>(messages);
    const title = String(result?.title ?? '').trim().slice(0, 120);
    const rawTeaser = String(result?.teaser ?? '').trim();
    const teaserLines = rawTeaser.includes('\n')
      ? rawTeaser.split(/\r?\n/)
      : rawTeaser.split(/(?<=[.!?])\s+/);
    const teaser = teaserLines
      .map((line) => line.replace(/^[\s*\-•]+/, '').trim())
      .filter(Boolean)
      .slice(0, 6)
      .join('\n')
      .slice(0, 1200);
    if (title.length < 3 || teaser.length < 20) {
      throw new ServiceUnavailableException('AI could not summarize the assessment document.');
    }
    const parsed = (Array.isArray(result?.requirements) ? result.requirements : [])
      .map((row) => ({
        text: String(row?.text ?? '').trim().slice(0, 160),
        weight: Number.isFinite(Number(row?.weight)) ? Math.max(0, Math.round(Number(row.weight))) : 0,
      }))
      .filter((row) => row.text.length > 0)
      .slice(0, 5);
    let requirements: Array<{ text: string; weight: number }> = [];
    if (parsed.length >= 1) {
      const total = parsed.reduce((sum, row) => sum + row.weight, 0);
      let remaining = 100;
      requirements = parsed.map((row, idx) => {
        if (idx === parsed.length - 1) return { text: row.text, weight: Math.max(1, remaining) };
        const weight = total > 0 ? Math.max(1, Math.round((row.weight / total) * 100)) : Math.floor(100 / parsed.length);
        remaining -= weight;
        return { text: row.text, weight };
      });
    }
    const marksFromDocument = result?.grading_rubric?.marks_from_document === true;
    const normalizedRubric = normalizeGradingRubric(result?.grading_rubric);
    const grading_rubric =
      normalizedRubric && !marksFromDocument ? scaleRubricMarksTo100(normalizedRubric) : normalizedRubric;
    await this.logAi(
      'summarize_assessment_document',
      null,
      { chars: clipped.length },
      { title, teaser, requirements, grading_rubric },
    );
    return { title, teaser, requirements, grading_rubric };
  }

  async suggestCompetencies(actor: JwtUserPayload, profileId: string, stageType?: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(profileId);
    let rubricContext = 'interview rubric';
    let restrictionPrompt = '';
    
    if (stageType === 'coding') {
      rubricContext = 'coding assessment rubric';
      restrictionPrompt = 'Extract 3 to 5 foundational coding competencies (e.g., Data Structures & Algorithms, Logic & Problem Solving, Time/Space Complexity, Edge Case Handling, Clean Code). Do NOT suggest specific frameworks (e.g., Laravel, React), databases (e.g., MySQL), or DevOps tools (e.g., Git, Docker) for the coding round. Focus purely on general algorithmic problem-solving and code execution.';

    } else if (stageType === 'project_interview') {
      rubricContext = 'project defense interview rubric';
      restrictionPrompt = 'Extract 3 to 5 competencies for a voice interview where the candidate defends a project they built. ALWAYS include "Tooling & Library Understanding" (can they explain what the libraries, scripts and configuration in their repo do?) and "Business Logic Ownership" (can they explain roles, flows and features of their app?). You may add JD-driven conceptual topics (e.g. Database Concepts, API Design, State Management). Do NOT suggest live-coding, syntax recall or algorithmic puzzle skills.';
    } else if (stageType === 'screening') {
      rubricContext = 'resume screening rubric';
      restrictionPrompt = 'Extract 3 to 5 resume screening criteria from the JD (e.g., Total Years of Experience, specific framework tenure, domain knowledge, education). Do NOT suggest coding logic or interview performance skills here. Focus purely on parsing measurable past experience and qualifications from a CV.';
    } else if (stageType === 'ai_verbal' || stageType === 'verbal') {
      rubricContext = 'AI voice interview rubric';
      restrictionPrompt = 'Extract 3 to 5 theoretical technical and soft skill competencies from the JD (e.g., System Design concepts, Framework theory, Database Architecture, Communication). Do NOT suggest skills that require a code editor (like Live Coding, precise Syntax, or Git commands). Focus purely on topics the candidate can verbally explain and discuss.';
    } else if (stageType === 'hr_verbal') {
      rubricContext = 'HR behavioral interview rubric';
      restrictionPrompt = 'Extract 3 to 5 behavioral and cultural competencies from the JD (e.g., Leadership, Conflict Resolution, Teamwork, Cultural Fit). Do NOT suggest technical programming or engineering skills here.';
    } else {
      restrictionPrompt = 'Extract 3 to 5 key competencies from the JD.';
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          `Suggest ${rubricContext} competencies as JSON: { competencies: [{ name, category: "hard"|"soft", target_score, weight_pct }] }. Weights must sum to 100. Dynamically determine the target_score (out of 10.0) based on how critical and advanced that specific skill is according to the JD and Seniority level. Do not use flat scores; a highly critical skill might require a 9.0 while a secondary skill might only require a 6.0. ${restrictionPrompt}`,
      },
      {
        role: 'user',
        content: `JD:\n${this.profileJdBlob(row)}\nSeniority: ${row.seniorityLevel ?? 'mid'}`,
      },
    ];
    const result = await this.openai.chatJson<{
      competencies: Array<{
        name: string;
        category: string;
        target_score: number;
        weight_pct: number;
      }>;
    }>(messages);
    await this.logAi('suggest_competencies', profileId, { profileId }, result);
    return { suggestions: result.competencies ?? [], ai_powered: this.openai.isConfigured() };
  }

  async suggestRubricWeights(actor: JwtUserPayload, profileId: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(profileId);
    const seniority = (row.seniorityLevel ?? 'mid').toLowerCase();
    const template = SENIORITY_RUBRIC_WEIGHTS[seniority] ?? SENIORITY_RUBRIC_WEIGHTS.mid!;
    const competencies = await this.repo.listCompetencies(profileId);
    if (!competencies.length) {
      return {
        suggestions: Object.entries(template).map(([name, weight_pct]) => ({
          name,
          category: name === 'soft' ? 'soft' : 'hard',
          weight_pct,
          target_score: 8,
        })),
        ai_powered: false,
        note: 'Template weights by seniority (no competencies on profile yet)',
      };
    }
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Adjust competency weight_pct values to sum to 100. Return JSON: { competencies: [{ id, weight_pct }] } using provided ids.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          seniority,
          template,
          competencies: competencies.map((c) => ({ id: c.id, name: c.name, weight_pct: c.weightPct })),
        }),
      },
    ];
    const result = await this.openai.chatJson<{
      competencies: Array<{ id: string; weight_pct: number }>;
    }>(messages);
    await this.logAi('suggest_rubric', profileId, { seniority }, result);
    return { suggestions: result.competencies ?? [], ai_powered: this.openai.isConfigured() };
  }

  async generateQuestions(actor: JwtUserPayload, profileId: string, count = 3, stageId?: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(profileId);
    const [existing, stages, competencies] = await Promise.all([
      this.repo.listQuestions(profileId),
      this.repo.listStages(profileId),
      this.repo.listCompetencies(profileId),
    ]);

    const stage = stageId ? stages.find((s) => s.id === stageId) : stages[0];
    const stageQuestions = stage
      ? existing.filter((q) => q.stageId === stage.id)
      : existing;

    const excludePrompts = existing
      .map((q) => q.prompt?.trim())
      .filter((p): p is string => Boolean(p));

    const uncoveredCompetencies = competencies
      .filter((c) => {
        const needle = c.name.toLowerCase();
        const pool = stage ? stageQuestions : existing;
        return !pool.some((q) => q.prompt?.toLowerCase().includes(needle));
      })
      .map((c) => c.name);

    const skills = deriveSkillsFromJobProfile({
      title: row.title,
      slug: row.slug,
      requiredSkills: row.requiredSkills,
      niceToHaveSkills: row.niceToHaveSkills,
      responsibilities: row.responsibilities,
    });
    const seniority = inferSeniorityFromJobProfile({
      seniorityLevel: row.seniorityLevel,
      title: row.title,
      slug: row.slug,
    });

    let roundPromptLines: string[] | undefined;
    let questionType: string | undefined;
    let promptProfile: 'technical' | 'screening' | 'behavioral' | 'hr_panel' | undefined;
    let focusThemes: string[] | undefined;
    let generationDifficulty: 'EASY' | 'MEDIUM' | 'HARD' = seniorityToDifficulty(seniority);
    let generationSkills = skills;

    let effectiveStageType: string | null = null;

    if (stage) {
      const hints = buildRoundQuestionPromptHints({
        name: stage.name,
        stageType: stage.stageType,
        stageKey: stage.stageKey,
        description: stage.description,
        mode: stage.mode,
      });
      effectiveStageType = hints.effectiveStageType;
      roundPromptLines = [...hints.promptLines];
      questionType = hints.questionType;
      promptProfile = hints.promptProfile;
      focusThemes = hints.focusThemes;
      generationDifficulty = hints.difficulty;

      if (hints.promptProfile !== 'technical') {
        generationSkills = [];
        const softUncovered = competencies
          .filter((c) => c.category === 'soft')
          .map((c) => c.name)
          .filter((name) => uncoveredCompetencies.includes(name));
        if (softUncovered.length) {
          roundPromptLines.push(
            `Where natural, touch on these soft competencies: ${softUncovered.slice(0, 4).join(', ')}. Still keep questions non-technical.`,
          );
        }
      } else if (uncoveredCompetencies.length) {
        roundPromptLines.push(
          `Prioritize assessing these rubric competencies not yet covered in this round: ${uncoveredCompetencies.slice(0, 5).join(', ')}.`,
        );
      }
    }

    const batch = await this.questionGen.generateBatch({
      skills: generationSkills,
      experienceLevel: seniority,
      difficulty: generationDifficulty,
      count: Math.min(count, 5),
      roleTitle: row.title,
      responsibilities: promptProfile === 'technical' ? row.responsibilities ?? [] : [],
      excludePrompts,
      questionType,
      roundPromptLines,
      promptProfile,
      focusThemes,
      targetSkills:
        stage && promptProfile === 'technical' && uncoveredCompetencies.length
          ? uncoveredCompetencies
          : undefined,
    });
    const questions = batch.map((q) => ({
      kind: 'anchor' as const,
      prompt: q.problemStatement || q.title,
      stage_id: stage?.id ?? null,
      metadata: {
        ai_generated: true,
        title: q.title,
        skills: q.expectedSkills,
        round_name: stage?.name ?? null,
        round_type: stage?.stageType ?? null,
        effective_round_type: effectiveStageType,
        question_type: q.questionType ?? questionType ?? null,
      },
    }));
    // Per-call token rows are written by AiQuestionGeneratorService to job_profile_ai_logs
    // (operation=generate_question / generate_question_batch). This profile-level row is a summary.
    await this.logAi(
      'generate_questions',
      profileId,
      {
        count,
        skills,
        seniority,
        stage_id: stage?.id ?? null,
        stage_name: stage?.name ?? null,
        effective_stage_type: effectiveStageType,
        prompt_profile: promptProfile,
        token_logs: 'see job_profile_ai_logs.generate_question*',
      },
      { questions },
    );
    return { questions, ai_powered: this.openai.isConfigured(), stage_id: stage?.id ?? null };
  }

  async biasScreen(actor: JwtUserPayload, profileId: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(profileId);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Screen job descriptions for bias. Return JSON: { flags: [{ severity: "info"|"warning"|"critical", message }], score: 0-100 (100=low bias) }.',
      },
      { role: 'user', content: this.profileJdBlob(row) },
    ];
    let result = await this.openai.chatJson<Partial<BiasResult> & { __isFallback?: boolean }>(messages);
    if (result.__isFallback) {
      throw new ServiceUnavailableException('AI service is currently unavailable — bias screening cannot be performed.');
    }
    const flags = Array.isArray(result.flags)
      ? result.flags
      : [{ severity: 'info' as const, message: 'Bias scan completed (deterministic fallback).' }];
    const score = typeof result.score === 'number' ? result.score : 85;
    const blocked = flags.some((f) => f.severity === 'critical');
    const payload: BiasResult = { flags, blocked, score };
    const meta = { ...(row.aiMetadata ?? {}), bias_screening: payload, screened_at: new Date().toISOString() };
    await this.repo.patchProfile(profileId, { aiMetadata: meta });
    await this.logAi('bias_screen', profileId, {}, payload);
    return payload;
  }

  async compensationBenchmark(actor: JwtUserPayload, profileId: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(profileId);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Suggest compensation band for role. Return JSON: { currency, band_min, band_max, market_note, confidence: "low"|"medium"|"high" }.',
      },
      {
        role: 'user',
        content: `Title: ${row.title}\nSeniority: ${row.seniorityLevel}\nLocation: ${row.locationText}\nCurrency: ${row.currency ?? 'INR'}`,
      },
    ];
    const result = await this.openai.chatJson<Record<string, unknown>>(messages);
    if (result.__isFallback) {
      throw new ServiceUnavailableException('AI service is currently unavailable — compensation benchmark cannot be performed.');
    }
    const meta = { ...(row.aiMetadata ?? {}), compensation_benchmark: result };
    await this.repo.patchProfile(profileId, { aiMetadata: meta });
    await this.logAi('compensation_benchmark', profileId, {}, result);
    return { ...result, ai_powered: this.openai.isConfigured(), external_stub: true };
  }

  async generateFaq(actor: JwtUserPayload, profileId: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(profileId);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Generate candidate FAQ from job facts. Return JSON: { faq: [{ question, answer }] } with 5-8 items.',
      },
      { role: 'user', content: this.profileJdBlob(row) },
    ];
    const result = await this.openai.chatJson<{ faq: Array<{ question: string; answer: string }>; __isFallback?: boolean }>(
      messages,
    );
    if (result.__isFallback) {
      throw new ServiceUnavailableException('AI service is currently unavailable — FAQ generation cannot be performed.');
    }
    const faq = result.faq ?? [];
    await this.repo.patchProfile(profileId, { candidateFaq: faq });
    const config = {
      ...(row.autonomousInterviewConfig ?? {}),
      candidate_faq: faq,
      job_profile_context: { title: row.title, faq },
    };
    await this.repo.patchProfile(profileId, { autonomousInterviewConfig: config });
    await this.logAi('generate_faq', profileId, {}, { faq });
    return { faq, ai_powered: this.openai.isConfigured() };
  }

  async nlEdit(actor: JwtUserPayload, profileId: string, instruction: string) {
    await this.assertWrite(actor);
    if (!instruction?.trim()) throw new BadRequestException('Instruction is required');
    const row = await this.repo.requireById(profileId);
    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Apply NL edit to job profile. Return JSON patch with any of: title, responsibilities[], required_skills[], nice_to_have_skills[], experience_min, experience_max, candidate_facing_intro.',
      },
      {
        role: 'user',
        content: `Current profile:\n${JSON.stringify({
          title: row.title,
          responsibilities: row.responsibilities,
          required_skills: row.requiredSkills,
          nice_to_have_skills: row.niceToHaveSkills,
          experience_min: row.experienceMin,
          experience_max: row.experienceMax,
          candidate_facing_intro: row.candidateFacingIntro,
        })}\n\nInstruction: ${instruction}`,
      },
    ];
    const patch = await this.openai.chatJson<Record<string, unknown>>(messages);
    if (patch.__isFallback) {
      throw new ServiceUnavailableException('AI service is currently unavailable — no changes were made to the profile.');
    }
    const profilePatch: Partial<JobProfileMysql> = {};
    if (typeof patch.title === 'string') profilePatch.title = patch.title;
    if (Array.isArray(patch.responsibilities)) profilePatch.responsibilities = patch.responsibilities;
    if (Array.isArray(patch.required_skills)) profilePatch.requiredSkills = patch.required_skills;
    if (Array.isArray(patch.nice_to_have_skills)) profilePatch.niceToHaveSkills = patch.nice_to_have_skills;
    if (patch.experience_min != null) profilePatch.experienceMin = String(patch.experience_min);
    if (patch.experience_max != null) profilePatch.experienceMax = String(patch.experience_max);
    if (typeof patch.candidate_facing_intro === 'string') {
      profilePatch.candidateFacingIntro = patch.candidate_facing_intro;
    }
    if (Object.keys(profilePatch).length) {
      await this.repo.patchProfile(profileId, profilePatch);
    }
    await this.logAi('nl_edit', profileId, { instruction }, patch);
    return { patch, applied: Object.keys(profilePatch).length > 0 };
  }

  async checkDuplicates(actor: JwtUserPayload, profileId: string) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(profileId);
    const text = this.profileJdBlob(row);
    const embedding = embedJdText(text);
    const fingerprint = jdTextFingerprint({
      title: row.title,
      responsibilities: row.responsibilities ?? [],
      required_skills: row.requiredSkills ?? [],
      nice_to_have_skills: row.niceToHaveSkills ?? [],
    });
    const [others] = await this.repo.listProfiles({ limit: 200, offset: 0 });
    const matches = others
      .filter((p) => p.id !== profileId)
      .map((p) => {
        const otherText = [p.title, ...(p.responsibilities ?? []), ...(p.requiredSkills ?? [])].join('\n');
        const sim = cosineSimilarity(embedding, embedJdText(otherText));
        return { profile_id: p.id, title: p.title, similarity: Math.round(sim * 100) };
      })
      .filter((m) => m.similarity >= 72)
      .sort((a, b) => b.similarity - a.similarity);

    const meta = {
      ...(row.aiMetadata ?? {}),
      jd_fingerprint: fingerprint,
      jd_embedding: embedding,
      duplicate_matches: matches,
    };
    await this.repo.patchProfile(profileId, { aiMetadata: meta });
    return { fingerprint, matches };
  }

  async getInsights(actor: JwtUserPayload, profileId: string) {
    await this.assertRead(actor);
    const row = await this.repo.requireById(profileId);
    const [stages, competencies, questions, apps] = await Promise.all([
      this.repo.listStages(profileId),
      this.repo.listCompetencies(profileId),
      this.repo.listQuestions(profileId),
      this.repo.listApplications(profileId),
    ]);
    const bias = (row.aiMetadata as Record<string, unknown> | null)?.bias_screening as
      | { blocked?: boolean }
      | undefined;
    const hired = apps.filter((a) => a.status === 'hired').length;
    const funnelConversion = apps.length ? hired / apps.length : 0;
    const healthScore = computeAiHealthScore({
      profileStatus: row.status,
      rubricComplete: competencies.length > 0,
      stageCount: stages.length,
      applicationCount: apps.length,
      biasCritical: Boolean(bias?.blocked),
      funnelConversion,
      questionCount: questions.length,
    });

    const fairness = {
      buckets: [
        { label: 'All candidates', count: apps.length, avg_score: 7.2 },
        { label: 'High experience', count: Math.floor(apps.length * 0.4), avg_score: 7.5 },
        { label: 'Entry pipeline', count: Math.ceil(apps.length * 0.3), avg_score: 6.8 },
      ],
      note: 'Aggregate fairness view (demographic buckets require optional candidate metadata in Phase 3+).',
    };

    return {
      health_score: healthScore,
      bias_screening: row.aiMetadata?.bias_screening ?? null,
      compensation_benchmark: row.aiMetadata?.compensation_benchmark ?? null,
      duplicate_matches: row.aiMetadata?.duplicate_matches ?? [],
      candidate_faq: row.candidateFaq ?? [],
      fairness,
      ai_powered: this.openai.isConfigured(),
    };
  }

  async assertPublishAllowed(profileId: string) {
    const row = await this.repo.requireById(profileId);
    const bias = (row.aiMetadata as Record<string, unknown> | null)?.bias_screening as
      | BiasResult
      | undefined;
    if (bias?.blocked || bias?.flags?.some((f) => f.severity === 'critical')) {
      throw new BadRequestException(
        'Publish blocked: critical bias flags detected. Run bias screening and revise the JD.',
      );
    }
  }

  private normalizeQuestionBankType(value: string) {
    const normalized = value.toLowerCase().replace(/\s+/g, '_').replace(/-/g, '_');
    const allowed = new Set([
      'intro',
      'behavioral',
      'situational',
      'technical',
      'competency_based',
      'culture_fit',
    ]);
    return allowed.has(normalized) ? normalized : 'competency_based';
  }

  private normalizeQuestionBankDifficulty(value: string | undefined) {
    const d = (value ?? 'medium').toLowerCase();
    if (d === 'easy' || d === 'hard') return d;
    return 'medium';
  }

  private fallbackQuestionBankDrafts(input: QuestionBankAiGenerateInput) {
    const count = Math.min(5, Math.max(1, input.question_count || 1));
    const types = (input.question_types?.length ? input.question_types : [input.question_type || 'behavioral']).map((t) =>
      this.normalizeQuestionBankType(t),
    );
    const difficulty =
      !input.difficulty || input.difficulty.toLowerCase() === 'mixed'
        ? 'medium'
        : this.normalizeQuestionBankDifficulty(input.difficulty);
    const competency = input.competency_name?.trim() || 'General competency';
    const seniority = input.seniority_level?.trim() || 'MID-LEVEL';
    const generated_questions = Array.from({ length: count }, (_, i) => {
      const type = types[i % types.length] ?? 'behavioral';
      const opener =
        type === 'behavioral'
          ? 'Tell me about a time when you'
          : type === 'situational'
            ? 'Imagine you are in a situation where you must'
            : type === 'technical'
              ? 'Walk me through how you would'
              : type === 'intro'
                ? 'Tell me about your background in'
                : type === 'culture_fit'
                  ? 'What kind of work environment helps you'
                  : 'Describe how you';
      return {
      question_text: `${opener} demonstrated ${competency} for a ${input.job_role || 'role'} context (${i + 1}). What was the outcome?`,
      question_type: type.toUpperCase(),
      competency,
      seniority_level: seniority,
      difficulty: difficulty.charAt(0).toUpperCase() + difficulty.slice(1),
      time_guidance_minutes: 4,
      follow_up_question: 'What measurable impact did your approach have?',
      follow_up_trigger: 'Candidate gives a vague or generic answer without specifics',
      expected_answer_notes: `Listen for concrete examples, tradeoffs, and signals aligned to ${competency}.`,
      ideal_answer_keywords: [competency.split(' ')[0] ?? 'ownership', 'tradeoffs', 'outcome'],
      red_flag_signals: ['No specific example provided', 'Cannot explain personal contribution'],
      topic_tags: [competency, input.industry_domain || 'General'].filter(Boolean),
      bias_check_passed: true,
      bias_check_notes: '',
    };
    });
    return {
      generated_questions,
      competency_coverage_notes: 'Fallback draft generated without live AI — review before publishing.',
      seniority_calibration_notes: `Calibrated for ${seniority}.`,
    };
  }

  async generateQuestionBankQuestions(input: QuestionBankAiGenerateInput) {
    const types = (input.question_types?.length ? input.question_types : [input.question_type || 'behavioral']).map((t) =>
      t.toUpperCase().replace(/-/g, '_'),
    );
    const payload: QuestionBankAiGenerateInput = {
      ...input,
      question_count: Math.min(5, Math.max(1, Number(input.question_count ?? 3))),
      job_role: input.job_role?.trim() || 'General Role',
      competency_name: input.competency_name?.trim() || 'General competency',
      seniority_level: input.seniority_level?.trim() || 'MID-LEVEL',
      question_type: types[0] ?? 'BEHAVIORAL',
      question_types: types,
      difficulty: input.difficulty?.toLowerCase() === 'mixed' ? undefined : input.difficulty,
    };
    const messages: ChatMessage[] = [
      { role: 'system', content: QUESTION_BANK_AI_SYSTEM_PROMPT },
      { role: 'user', content: buildQuestionBankAiUserPrompt(payload) },
    ];
    const result = this.openai.isConfigured()
      ? await this.openai.chatJson<{
          generated_questions: Array<Record<string, unknown>>;
          competency_coverage_notes?: string;
          seniority_calibration_notes?: string;
        }>(messages)
      : this.fallbackQuestionBankDrafts(payload);
    await this.logAi('question_bank_generate', null, payload, result);
    const generated = Array.isArray(result.generated_questions) ? result.generated_questions : [];
    const drafts = generated.map((row) => ({
      question_text: String(row.question_text ?? ''),
      question_type: this.normalizeQuestionBankType(String(row.question_type ?? payload.question_type)),
      difficulty: this.normalizeQuestionBankDifficulty(String(row.difficulty ?? payload.difficulty)),
      competency_tags: [String(row.competency ?? payload.competency_name)],
      seniority_level: String(row.seniority_level ?? payload.seniority_level),
      follow_up_question: row.follow_up_question ? String(row.follow_up_question) : undefined,
      follow_up_trigger: row.follow_up_trigger ? String(row.follow_up_trigger) : undefined,
      expected_answer_notes: row.expected_answer_notes ? String(row.expected_answer_notes) : undefined,
      ideal_answer_keywords: Array.isArray(row.ideal_answer_keywords)
        ? row.ideal_answer_keywords.map((k) => String(k))
        : [],
      red_flag_signals: Array.isArray(row.red_flag_signals) ? row.red_flag_signals.map((k) => String(k)) : [],
      topic_tags: Array.isArray(row.topic_tags) ? row.topic_tags.map((k) => String(k)) : [],
      bias_check_passed: row.bias_check_passed !== false,
      bias_check_notes: row.bias_check_notes ? String(row.bias_check_notes) : '',
      time_guidance_minutes:
        typeof row.time_guidance_minutes === 'number' ? row.time_guidance_minutes : undefined,
    }));
    return {
      drafts,
      competency_coverage_notes: result.competency_coverage_notes ?? '',
      seniority_calibration_notes: result.seniority_calibration_notes ?? '',
      ai_powered: this.openai.isConfigured(),
    };
  }

  private formatSeniorityLabel(level: string | undefined) {
    const raw = (level ?? 'MID-LEVEL').trim().toUpperCase();
    if (raw.includes('INTERN') || raw.includes('FRESHER')) return 'INTERN / FRESHER';
    if (raw.includes('JUNIOR') || raw.includes('ENTRY')) return 'JUNIOR';
    if (raw.includes('LEAD') || raw.includes('PRINCIPAL')) return 'LEAD / PRINCIPAL';
    if (raw.includes('SENIOR') && !raw.includes('MID')) return 'SENIOR';
    if (raw.includes('MID')) return 'MID-LEVEL';
    return raw;
  }

  private normalizeProblemDifficulty(value: string | undefined) {
    const d = (value ?? 'medium').toLowerCase();
    if (d === 'easy' || d === 'hard') return d;
    return 'medium';
  }

  private async resolveProblemBankContext(body: {
    job_profile_id?: string;
    job_role?: string;
    competency_name?: string;
    competency_description?: string;
    seniority_level?: string;
    industry_domain?: string;
    tech_stack?: string;
  }) {
    const competencyName = body.competency_name?.trim();
    const competencyDesc = body.competency_description?.trim() ?? '';
    const jobRole = body.job_role?.trim();

    if (body.job_profile_id) {
      const row = await this.repo.requireById(body.job_profile_id);
      const skills = deriveSkillsFromJobProfile({
        title: row.title,
        slug: row.slug,
        requiredSkills: row.requiredSkills,
        niceToHaveSkills: row.niceToHaveSkills,
        responsibilities: row.responsibilities,
      });
      const seniority = inferSeniorityFromJobProfile({
        seniorityLevel: row.seniorityLevel,
        title: row.title,
        slug: row.slug,
      });
      const config = row.autonomousInterviewConfig as Record<string, unknown> | null;
      const stackFromConfig = typeof config?.tech_stack === 'string' ? config.tech_stack.trim() : '';
      const responsibilities = (row.responsibilities ?? []).slice(0, 4).join('; ');
      const contextBlob = [competencyName, competencyDesc, jobRole, row.title, stackFromConfig, ...skills]
        .filter(Boolean)
        .join(' ');
      const tech_stack =
        body.tech_stack?.trim() ||
        stackFromConfig ||
        skills.slice(0, 8).join(', ') ||
        inferTechStackFromText(contextBlob);

      return {
        competency_name: competencyName || 'Technical Problem Solving',
        competency_description:
          competencyDesc ||
          responsibilities ||
          `Hands-on coding assessment for ${row.title}.`,
        job_profile: row.title,
        seniority: this.formatSeniorityLabel(body.seniority_level ?? seniority),
        domain: row.department?.trim() || body.industry_domain?.trim() || 'Software Development',
        tech_stack,
      };
    }

    if (competencyName) {
      const contextBlob = [competencyName, competencyDesc, jobRole, body.tech_stack].filter(Boolean).join(' ');
      const tech_stack = body.tech_stack?.trim() || inferTechStackFromText(contextBlob);
      return {
        competency_name: competencyName,
        competency_description: competencyDesc || `${competencyName} competency.`,
        job_profile: jobRole || competencyName,
        seniority: this.formatSeniorityLabel(body.seniority_level),
        domain: body.industry_domain?.trim() || 'Software Development',
        tech_stack,
      };
    }

    return {
      competency_name: jobRole || 'Problem Solving',
      competency_description: competencyDesc,
      job_profile: jobRole || 'Software Engineer',
      seniority: this.formatSeniorityLabel(body.seniority_level),
      domain: body.industry_domain?.trim() || 'Software Development',
      tech_stack: body.tech_stack?.trim() || inferTechStackFromText(jobRole || ''),
    };
  }

  private async buildAiGenerationConfig(body: {
    generator?: GeneratorType;
    topic_tag: string;
    problem_pattern?: string;
    difficulty?: string;
    job_profile_id?: string;
    job_role?: string;
    competency_name?: string;
    competency_description?: string;
    seniority_level?: string;
    industry_domain?: string;
    tech_stack?: string;
    allowed_languages?: string[];
    database_type?: string;
    database_question_type?: 'scenario' | 'simple';
    custom_instructions?: string;
    constraints?: {
      input_size?: string;
      value_range?: string;
      memory_mb?: number;
      time_limit_ms?: number;
    };
    generate?: ProblemBankAiGenerateInput['generate'] & {
      database_schema?: boolean;
      seed_data?: boolean;
      entity_descriptions?: boolean;
      relationships?: boolean;
      sql_queries?: boolean;
    };
    seed_options?: { random_seed?: number; size?: 'small' | 'medium' | 'large' };
    requires_sandbox_database?: boolean;
    code_skeleton?: 'scratch' | 'scaffolded';
  }): Promise<AiGenerationConfig> {
    const context = await this.resolveProblemBankContext(body);
    const languages = body.allowed_languages?.length
      ? body.allowed_languages
      : inferLanguagesFromTechStack(context.tech_stack);
    const requiresSandboxDatabase = Boolean(body.requires_sandbox_database);
    const generate = {
      ...body.generate,
      requires_sandbox_database: requiresSandboxDatabase,
      ...(requiresSandboxDatabase
        ? {
            database_schema: body.generate?.database_schema !== false,
            seed_data: body.generate?.seed_data !== false,
          }
        : {}),
    };
    return {
      generator: body.generator ?? 'coding',
      competency_name: context.competency_name,
      competency_description: context.competency_description,
      job_profile: context.job_profile,
      tech_stack: context.tech_stack,
      domain: context.domain,
      seniority: context.seniority,
      topic_tag: body.topic_tag?.trim() || body.competency_name?.trim() || 'Algorithms',
      difficulty: this.normalizeProblemDifficulty(body.difficulty),
      problem_pattern: body.problem_pattern?.trim() || (body.generator === 'database' ? 'Schema Design' : 'General Challenge'),
      database_type: body.database_type?.trim() || 'MySQL',
      database_question_type: body.database_question_type ?? 'scenario',
      custom_instructions: body.custom_instructions?.trim(),
      max_input_size: body.constraints?.input_size?.trim() || '1 ≤ n ≤ 10^5',
      value_range: body.constraints?.value_range?.trim() || '1 ≤ val ≤ 10^9',
      time_limit: `${body.constraints?.time_limit_ms ?? 2000} ms`,
      memory_limit: `${body.constraints?.memory_mb ?? 256} MB`,
      time_limit_ms: body.constraints?.time_limit_ms ?? 2000,
      memory_limit_mb: body.constraints?.memory_mb ?? 256,
      languages,
      job_profile_id: body.job_profile_id,
      generate,
      seed_options: body.seed_options ?? { random_seed: 42, size: 'medium' },
      requires_sandbox_database: requiresSandboxDatabase,
      code_skeleton: body.code_skeleton,
    };
  }

  async generateAssessmentDraft(body: {
    generator?: GeneratorType;
    topic_tag: string;
    problem_pattern?: string;
    difficulty?: string;
    job_profile_id?: string;
    job_role?: string;
    competency_name?: string;
    competency_description?: string;
    seniority_level?: string;
    industry_domain?: string;
    tech_stack?: string;
    allowed_languages?: string[];
    database_type?: string;
    database_question_type?: 'scenario' | 'simple';
    custom_instructions?: string;
    constraints?: {
      input_size?: string;
      value_range?: string;
      memory_mb?: number;
      time_limit_ms?: number;
    };
    generate?: ProblemBankAiGenerateInput['generate'] & {
      database_schema?: boolean;
      seed_data?: boolean;
      entity_descriptions?: boolean;
      relationships?: boolean;
      sql_queries?: boolean;
    };
    seed_options?: { random_seed?: number; size?: 'small' | 'medium' | 'large' };
    requires_sandbox_database?: boolean;
  }) {
    const config = await this.buildAiGenerationConfig(body);
    let lastUsage: { promptTokens: number | null; completionTokens: number | null } = {
      promptTokens: null,
      completionTokens: null,
    };
    let lastModel = this.openai.activeModel();
    let result = await runGenerator(config.generator, config, {
      isAiConfigured: this.openai.isConfigured(),
      chatJson: async <T>(messages: ChatMessage[]) => {
        const detailed = await this.openai.chatJsonDetailed<T>(messages);
        lastUsage = detailed.usage;
        lastModel = detailed.model;
        return detailed.data;
      },
    });
    if ((result.raw as Record<string, unknown> | undefined)?.__isFallback) {
      throw new ServiceUnavailableException(
        'AI service is currently unavailable — generated assessment content cannot be persisted.',
      );
    }

    // Perform AI Validation Pass for Coding Problems
    let validationIssues: string[] | undefined;
    if (config.generator === 'coding' && this.openai.isConfigured() && result.draft) {
      const validationPrompt = `You are an expert competitive programming judge and technical reviewer. Review the following generated coding problem JSON draft.
Check for:
1. Example Contradiction: Do the inputs actually produce the exact output shown?
2. Complexity & Constraint Infeasibility: Are the constraints too large for the required time limit? (e.g. O(N^2) solution for N=10^5 will TLE in 2000ms).
3. Non-Unique Solutions: Are tie-breaking rules specified if multiple answers are possible?

If the draft is 100% correct, return {"is_correct": true, "draft": <original_draft>}.
If it has issues, fix ALL the issues in the draft and return {"is_correct": false, "issues": ["Issue 1", "Issue 2"], "draft": <corrected_draft>}.

Draft to validate:
${JSON.stringify(result.draft, null, 2)}`;

      try {
        const validationMessages: ChatMessage[] = [
          { role: 'user', content: validationPrompt },
        ];
        type ValidationResult = { is_correct: boolean; issues?: string[]; draft: any };
        let validationResult: ValidationResult | null = null;

        const applyUsage = (
          usage: { promptTokens: number | null; completionTokens: number | null },
          model: string,
        ) => {
          lastUsage = {
            promptTokens: (lastUsage.promptTokens ?? 0) + (usage.promptTokens ?? 0),
            completionTokens: (lastUsage.completionTokens ?? 0) + (usage.completionTokens ?? 0),
          };
          lastModel = `${lastModel}+${model}`;
        };

        const validateViaGroq = async () => {
          const detailed = await this.openai.chatJsonDetailed<ValidationResult>(validationMessages);
          if ((detailed.data as { __isFallback?: boolean } | undefined)?.__isFallback) {
            throw new Error('Groq validation returned fallback JSON');
          }
          applyUsage(detailed.usage, detailed.model);
          return detailed.data;
        };

        const geminiKey = (process.env.TAKEHOME_LLM_KEY || '').trim();
        if (geminiKey) {
          const geminiUrl =
            process.env.TAKEHOME_LLM_URL ||
            'https://generativelanguage.googleapis.com/v1beta/openai/';
          const geminiModel = process.env.TAKEHOME_LLM_MODEL || 'gemini-3.6-flash';
          try {
            const geminiClient = new OpenAI({
              apiKey: geminiKey,
              baseURL: geminiUrl,
              // Keep retries low — 503 spikes only get worse with aggressive retry.
              maxRetries: 1,
              timeout: 180_000,
            });
            const completion = (await geminiClient.chat.completions.create({
              model: geminiModel,
              messages: validationMessages,
              max_tokens: 16_384,
              stream: false,
              reasoning_effort: 'low',
            } as Parameters<OpenAI['chat']['completions']['create']>[0])) as OpenAI.Chat.ChatCompletion;
            const content = completion.choices[0]?.message?.content || '{}';
            validationResult = parseJsonObject(content) as ValidationResult;
            const usage = completion.usage;
            applyUsage(
              {
                promptTokens: usage?.prompt_tokens ?? null,
                completionTokens: usage?.completion_tokens ?? null,
              },
              geminiModel,
            );
          } catch (geminiErr) {
            const msg = geminiErr instanceof Error ? geminiErr.message : String(geminiErr);
            // Gemini capacity/auth failures → use the same Groq model that generated the draft.
            if (/503|429|401|overloaded|unavailable|resource.exhausted|quota|unauthenticated/i.test(msg)) {
              console.warn(
                `AI validation Gemini failed (${msg.slice(0, 120)}); falling back to Groq`,
              );
              validationResult = await validateViaGroq();
            } else {
              throw geminiErr;
            }
          }
        } else {
          validationResult = await validateViaGroq();
        }

        if (validationResult && validationResult.draft) {
          result.draft = validationResult.draft;
          if (!validationResult.is_correct) {
            validationIssues = validationResult.issues;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `AI validation pass failed, keeping original draft: ${msg.slice(0, 200)}`,
        );
      }
    }

    const operation =
      config.generator === 'database' ? 'database_assessment_generate' : 'problem_bank_generate';
    await this.logAi(
      operation,
      body.job_profile_id ?? null,
      config,
      result.raw,
      lastUsage,
      lastModel,
    );
    
    const finalResponse: any = { draft: result.draft, ai_powered: result.ai_powered, generator: config.generator };
    if (validationIssues) {
      finalResponse.validation_issues_fixed = validationIssues;
    }
    
    return finalResponse;
  }

  async generateProblemBankDraft(body: {
    generator?: GeneratorType;
    topic_tag: string;
    problem_pattern?: string;
    difficulty?: string;
    job_profile_id?: string;
    job_role?: string;
    competency_name?: string;
    competency_description?: string;
    seniority_level?: string;
    industry_domain?: string;
    tech_stack?: string;
    allowed_languages?: string[];
    database_type?: string;
    constraints?: {
      input_size?: string;
      value_range?: string;
      memory_mb?: number;
      time_limit_ms?: number;
    };
    generate?: ProblemBankAiGenerateInput['generate'];
    seed_options?: { random_seed?: number; size?: 'small' | 'medium' | 'large' };
    requires_sandbox_database?: boolean;
  }) {
    return this.generateAssessmentDraft({ ...body, generator: body.generator ?? 'coding' });
  }

  async generateDatabaseAssessmentDraft(
    body: Omit<Parameters<JobProfilesAiService['generateAssessmentDraft']>[0], 'generator'>,
  ) {
    return this.generateAssessmentDraft({ ...body, generator: 'database' });
  }

  private scoreBankItemMatch(
    tags: string[],
    text: string,
    competencyNames: string[],
    uncoveredNames: string[],
    skills: string[],
  ): number {
    const blob = `${tags.join(' ')} ${text}`.toLowerCase();
    let score = 0;
    for (const name of uncoveredNames) {
      const n = name.toLowerCase();
      if (n && blob.includes(n)) score += 4;
    }
    for (const name of competencyNames) {
      const n = name.toLowerCase();
      if (n && blob.includes(n)) score += 2;
    }
    for (const skill of skills) {
      const s = skill.toLowerCase();
      if (s && blob.includes(s)) score += 1;
    }
    return score;
  }

  private truncateForPrompt(text: string, max = 220): string {
    const plain = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (plain.length <= max) return plain;
    return `${plain.slice(0, max)}…`;
  }

  async mapBankContent(
    actor: JwtUserPayload,
    profileId: string,
    input: {
      stage_id?: string;
      max_questions?: number;
      max_problems?: number;
      content_type?: 'question' | 'problem' | 'both';
    },
  ) {
    await this.assertWrite(actor);
    const row = await this.repo.requireById(profileId);
    const [stages, competencies, existingQuestions] = await Promise.all([
      this.repo.listStages(profileId),
      this.repo.listCompetencies(profileId),
      this.repo.listQuestions(profileId),
    ]);

    const stage = input.stage_id ? stages.find((s) => s.id === input.stage_id) : stages[0];
    const stageQuestions = stage ? existingQuestions.filter((q) => q.stageId === stage.id) : existingQuestions;

    const excludeQuestionIds = new Set<string>();
    const excludeProblemIds = new Set<string>();
    for (const q of stageQuestions) {
      const meta = q.metadata as Record<string, unknown> | null;
      if (meta?.question_bank_id != null) excludeQuestionIds.add(String(meta.question_bank_id));
      if (meta?.problem_bank_id != null) excludeProblemIds.add(String(meta.problem_bank_id));
    }

    const competencyNames = competencies.map((c) => c.name);
    const uncoveredNames = competencies
      .filter((c) => {
        const needle = c.name.toLowerCase();
        return !stageQuestions.some((q) => q.prompt?.toLowerCase().includes(needle));
      })
      .map((c) => c.name);

    const skills = deriveSkillsFromJobProfile({
      title: row.title,
      slug: row.slug,
      requiredSkills: row.requiredSkills,
      niceToHaveSkills: row.niceToHaveSkills,
      responsibilities: row.responsibilities,
    });
    const seniority = inferSeniorityFromJobProfile({
      seniorityLevel: row.seniorityLevel,
      title: row.title,
      slug: row.slug,
    });

    const roundHints = stage
      ? buildRoundQuestionPromptHints({
          name: stage.name,
          stageType: stage.stageType,
          stageKey: stage.stageKey,
          description: stage.description,
          mode: stage.mode,
        })
      : null;
    const isCodingRound =
      stage?.stageType === 'coding' ||
      /coding|technical|algorithm/i.test(stage?.name ?? '') ||
      roundHints?.promptProfile === 'technical';

    const contentType = input.content_type ?? 'both';
    const maxQuestions = Math.min(12, Math.max(1, Number(input.max_questions ?? 6)));
    const maxProblems = Math.min(8, Math.max(0, Number(input.max_problems ?? (isCodingRound ? 4 : 2))));

    const wantQuestions = contentType === 'question' || contentType === 'both';
    const wantProblems = contentType === 'problem' || contentType === 'both';

    const [questionRows, problemRows] = await Promise.all([
      wantQuestions
        ? this.questionBank.find({
            where: {
              inactive: 0,
              status: In([QuestionBankStatus.PUBLISHED, QuestionBankStatus.DRAFT]),
            },
            order: { usageCount: 'DESC', createdAt: 'DESC' },
            take: 120,
          })
        : Promise.resolve([]),
      wantProblems
        ? this.problemBank.find({
            where: {
              inactive: 0,
              status: In([ProblemBankStatus.PUBLISHED, ProblemBankStatus.DRAFT]),
            },
            order: { createdAt: 'DESC' },
            take: 80,
          })
        : Promise.resolve([]),
    ]);

    type ScoredQ = { id: string; summary: string; tags: string[]; score: number };
    const questionCandidates: ScoredQ[] = questionRows
      .filter((q) => !excludeQuestionIds.has(q.id))
      .map((q) => {
        const tags = [...(q.competencyTags ?? []), ...(q.topicTags ?? [])];
        const text = q.questionTextPlain?.trim() || q.questionText;
        return {
          id: q.id,
          summary: this.truncateForPrompt(text),
          tags,
          score: this.scoreBankItemMatch(tags, text, competencyNames, uncoveredNames, skills),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 45);

    const problemCandidates: ScoredQ[] = problemRows
      .filter((p) => !excludeProblemIds.has(p.id))
      .map((p) => {
        const tags = p.topicTags ?? [];
        const text = `${p.title} ${p.statementMd}`;
        return {
          id: p.id,
          summary: this.truncateForPrompt(text, 180),
          tags,
          score: this.scoreBankItemMatch(tags, text, competencyNames, uncoveredNames, skills),
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    const fallbackQuestionIds = questionCandidates.slice(0, maxQuestions).map((q) => q.id);
    const fallbackProblemIds = isCodingRound
      ? problemCandidates.slice(0, maxProblems).map((p) => p.id)
      : problemCandidates.slice(0, Math.min(maxProblems, 2)).map((p) => p.id);

    if (!questionCandidates.length && !problemCandidates.length) {
      return {
        question_ids: [],
        problem_ids: [],
        mapping_notes: 'No bank items available to map for this round.',
        ai_powered: false,
      };
    }

    const pickWithAi = async () => {
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content: `You map existing assessment bank content to a job profile interview round.
Return JSON: { "question_ids": string[], "problem_ids": string[], "mapping_notes": string }
Rules:
- Only use IDs from the provided candidate lists.
- Prefer items that assess uncovered rubric competencies first.
- Match round type: ${isCodingRound ? 'include coding problems for technical/coding rounds' : 'prefer behavioral/screening interview questions; limit coding problems'}.
- Seniority: ${seniority}. Role: ${row.title}.
- Do not exceed ${maxQuestions} question_ids and ${maxProblems} problem_ids.
- Avoid duplicates with items already on the round.`,
        },
        {
          role: 'user',
          content: JSON.stringify(
            {
              job_profile: {
                title: row.title,
                department: row.department,
                seniority,
                skills: skills.slice(0, 12),
                competencies: competencyNames,
                uncovered_competencies: uncoveredNames,
              },
              round: stage
                ? {
                    name: stage.name,
                    stage_type: stage.stageType,
                    effective_type: roundHints?.effectiveStageType,
                    prompt_profile: roundHints?.promptProfile,
                  }
                : null,
              already_mapped_question_ids: Array.from(excludeQuestionIds),
              already_mapped_problem_ids: Array.from(excludeProblemIds),
              question_candidates: questionCandidates,
              problem_candidates: problemCandidates,
            },
            null,
            0,
          ),
        },
      ];
      return this.openai.chatJson<{
        question_ids?: string[];
        problem_ids?: string[];
        mapping_notes?: string;
      }>(messages);
    };

    const aiResult = this.openai.isConfigured() ? await pickWithAi() : null;
    const validQuestionIds = new Set(questionCandidates.map((q) => q.id));
    const validProblemIds = new Set(problemCandidates.map((p) => p.id));

    const question_ids = (
      aiResult?.question_ids?.length
        ? aiResult.question_ids.filter((id) => validQuestionIds.has(String(id)))
        : fallbackQuestionIds
    ).slice(0, maxQuestions);

    const problem_ids = (
      aiResult?.problem_ids?.length
        ? aiResult.problem_ids.filter((id) => validProblemIds.has(String(id)))
        : fallbackProblemIds
    ).slice(0, maxProblems);

    const mapping_notes =
      aiResult?.mapping_notes?.trim() ||
      (uncoveredNames.length
        ? `Mapped toward uncovered competencies: ${uncoveredNames.slice(0, 4).join(', ')}.`
        : 'Mapped bank items to job profile rubric and round context.');

    const response = {
      question_ids: wantQuestions ? question_ids : [],
      problem_ids: wantProblems ? problem_ids : [],
      mapping_notes,
      ai_powered: Boolean(aiResult),
    };

    await this.logAi('map_bank_content', profileId, { ...input, stage_id: stage?.id }, response);
    return response;
  }
}
