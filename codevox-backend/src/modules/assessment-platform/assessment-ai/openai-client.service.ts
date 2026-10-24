import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { createHash } from 'crypto';
import OpenAI from 'openai';
import { parseJsonObject } from './ai-json.util';
import {
  emptyLlmUsage,
  usageFromOpenAi,
  type ChatJsonDetailedResult,
  type LlmTokenUsage,
} from './llm-usage';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type LlmProvider = 'azure' | 'cerebras';
export type { ChatJsonDetailedResult, LlmTokenUsage };

@Injectable()
export class OpenAiClientService {
  private readonly logger = new Logger(OpenAiClientService.name);
  private azureClient: OpenAI | null = null;
  private cerebrasClient: Cerebras | null = null;

  constructor(private readonly config: ConfigService) {}

  /** Active provider from LLM_PROVIDER (azure | cerebras). Defaults to azure. */
  provider(): LlmProvider | 'none' {
    const choice = (this.config.get<string>('LLM_PROVIDER') ?? 'azure').trim().toLowerCase();
    if (choice === 'cerebras') {
      return this.cerebrasApiKey() ? 'cerebras' : 'none';
    }
    if (choice === 'azure' || choice === 'openai') {
      return this.azureApiKey() ? 'azure' : 'none';
    }
    this.logger.warn(`Unknown LLM_PROVIDER "${choice}" — falling back to azure`);
    return this.azureApiKey() ? 'azure' : 'none';
  }

  isConfigured(): boolean {
    return this.provider() !== 'none';
  }

  activeModel(): string {
    if (this.provider() === 'cerebras') {
      return this.config.get<string>('CEREBRAS_MODEL')?.trim() || 'gemma-4-31b';
    }
    return this.config.get<string>('OPENAI_MODEL')?.trim() || 'gemini-3.6-flash';
  }

  /** True when OPENAI_BASE_URL points at Gemini's OpenAI-compatible endpoint. */
  private isGeminiEndpoint(): boolean {
    return /generativelanguage\.googleapis\.com/i.test(this.azureBaseUrl());
  }

  private azureMaxTokens(): number {
    if (this.isGeminiEndpoint()) {
      const raw = this.config.get<string>('OPENAI_MAX_TOKENS')?.trim();
      const parsed = raw ? Number(raw) : 16_384;
      if (!Number.isFinite(parsed) || parsed <= 0) return 16_384;
      return Math.min(Math.floor(parsed), 65_536);
    }
    return 3000;
  }

  private azureApiKey(): string {
    return (this.config.get<string>('OPENAI_API_KEY') ?? '').trim();
  }

  private cerebrasApiKey(): string {
    return (
      this.config.get<string>('CEREBRAS_API_KEY') ??
      this.config.get<string>('CEREBRA_API_KEY') ??
      ''
    ).trim();
  }

  private azureBaseUrl(): string {
    return (
      this.config.get<string>('OPENAI_BASE_URL')?.trim() ||
      'https://models.inference.ai.azure.com'
    ).replace(/\/$/, '');
  }

  private getAzureClient(): OpenAI {
    if (!this.azureClient) {
      this.azureClient = new OpenAI({
        apiKey: this.azureApiKey(),
        baseURL: this.azureBaseUrl(),
        timeout: this.isGeminiEndpoint() ? 360_000 : 60_000,
        maxRetries: this.isGeminiEndpoint() ? 3 : 4,
      });
    }
    return this.azureClient;
  }

  private getCerebrasClient(): Cerebras {
    if (!this.cerebrasClient) {
      this.cerebrasClient = new Cerebras({
        apiKey: this.cerebrasApiKey(),
      });
    }
    return this.cerebrasClient;
  }

  promptHash(messages: ChatMessage[]) {
    return createHash('sha256').update(JSON.stringify(messages)).digest('hex').slice(0, 16);
  }

  async chatJson<T>(messages: ChatMessage[], options?: { temperature?: number }): Promise<T> {
    const detailed = await this.chatJsonDetailed<T>(messages, options);
    return detailed.data;
  }

  /**
   * Same as chatJson but also returns provider token usage for cost/observability logging.
   * On provider failure, returns the deterministic fallback with null usage (same as chatJson).
   */
  async chatJsonDetailed<T>(
    messages: ChatMessage[],
    options?: { temperature?: number },
  ): Promise<ChatJsonDetailedResult<T>> {
    const active = this.provider();
    const model = this.activeModel();
    if (active === 'none') {
      this.logger.warn('No LLM provider configured — using deterministic fallback JSON');
      return {
        data: this.fallbackFromMessages(messages) as T,
        usage: emptyLlmUsage(),
        model,
      };
    }

    const temperature = options?.temperature ?? 0.4;
    const started = Date.now();
    try {
      const raw =
        active === 'cerebras'
          ? await this.chatJsonViaCerebras(messages, temperature)
          : await this.chatJsonViaAzure(messages, temperature);
      this.logger.log(
        `LLM ${active} chatJson ok in ${Date.now() - started}ms model=${model} prompt_tokens=${raw.usage.promptTokens ?? 'n/a'} completion_tokens=${raw.usage.completionTokens ?? 'n/a'}`,
      );
      return {
        data: parseJsonObject(raw.content) as T,
        usage: raw.usage,
        model,
      };
    } catch (error) {
      const err = error as { status?: number; message?: string };
      this.logger.warn(
        `LLM ${active} chatJson failed in ${Date.now() - started}ms status=${err.status ?? 'n/a'}: ${err.message ?? error}`,
      );
      return {
        data: this.fallbackFromMessages(messages) as T,
        usage: emptyLlmUsage(),
        model,
      };
    }
  }

  private async chatJsonViaAzure(
    messages: ChatMessage[],
    temperature = 0.4,
  ): Promise<{ content: string; usage: LlmTokenUsage }> {
    try {
      const gemini = this.isGeminiEndpoint();
      const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
        model: this.activeModel(),
        messages,
        max_tokens: this.azureMaxTokens(),
        response_format: { type: 'json_object' },
        // Gemini 3.x deprecates temperature/top_p/top_k — omit them on that endpoint.
        ...(gemini ? {} : { temperature }),
      };
      if (gemini) {
        (body as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & {
          reasoning_effort?: 'low' | 'medium' | 'high';
        }).reasoning_effort = 'low';
      }
      const response = await this.getAzureClient().chat.completions.create(body);
      const content = response.choices[0]?.message?.content;
      if (!content) throw new Error('Azure OpenAI returned empty content');
      return { content, usage: usageFromOpenAi(response.usage) };
    } catch (e: any) {
      this.logger.error('Azure OpenAI Error Detail: ' + JSON.stringify(e));
      if (e.response) this.logger.error('Azure Response: ' + JSON.stringify(e.response));
      throw e;
    }
  }

  private async chatJsonViaCerebras(
    messages: ChatMessage[],
    temperature = 0.4,
  ): Promise<{ content: string; usage: LlmTokenUsage }> {
    const response = await this.getCerebrasClient().chat.completions.create({
      messages,
      model: this.activeModel(),
      stream: false,
      max_completion_tokens: 8192,
      temperature,
      top_p: 0.95,
      response_format: { type: 'json_object' },
    });
    const completion = response as {
      choices?: Array<{ message?: { content?: string | null } }>;
      usage?: {
        prompt_tokens?: number | null;
        completion_tokens?: number | null;
      };
    };
    const content = completion.choices?.[0]?.message?.content;
    if (!content) throw new Error('Cerebras returned empty content');
    return { content, usage: usageFromOpenAi(completion.usage) };
  }

  private fallbackFromMessages(messages: ChatMessage[]): Record<string, unknown> {
    const user = messages.find((m) => m.role === 'user')?.content ?? '';

    // Job description draft (must run before generic coding fallback)
    if (/Draft a structured JD for:/i.test(user)) {
      const titleMatch = user.match(/Draft a structured JD for:\s*(.+?)\.\s*Department:/i);
      const role = (titleMatch?.[1] ?? 'this role').trim() || 'this role';
      const deptMatch = user.match(/Department:\s*(.+?)\.\s*Brief:/i);
      const dept = (deptMatch?.[1] ?? 'General').trim() || 'General';
      return {
        responsibilities: [
          `Deliver high-quality work for ${role} priorities in ${dept}`,
          'Collaborate with cross-functional partners to ship outcomes on time',
          'Own end-to-end execution, documentation, and continuous improvement',
          'Mentor peers and contribute to team standards and best practices',
        ],
        required_skills: [
          'Strong communication',
          'Problem solving',
          'Domain fundamentals for the role',
          'Ownership and delivery focus',
        ],
        nice_to_have_skills: [
          'Stakeholder management',
          'Prior experience in a similar role',
          'Familiarity with agile ways of working',
        ],
        experience_min: 2,
        experience_max: 5,
        fallback: true,
      };
    }

    // Magic Job Creator — paste-JD parse
    if (/Parse this job description into structured fields:/i.test(user)) {
      const jdBody = user.replace(/^[\s\S]*?Parse this job description into structured fields:\s*/i, '');
      const firstLine =
        jdBody
          .split(/\r?\n/)
          .map((l) => l.trim())
          .find((l) => l.length > 0)
          ?.replace(/^#+\s*/, '')
          .slice(0, 120) || 'Untitled role';
      return {
        __isFallback: true,
        fallback: true,
        title: firstLine,
        department: 'Engineering',
        seniority_level: 'mid',
        employment_type: 'full_time',
        openings_count: 1,
        location_mode: 'hybrid',
        location_text: '',
        compensation_band_min: null,
        compensation_band_max: null,
        currency: 'INR',
        candidate_facing_intro: jdBody.slice(0, 800),
        responsibilities: [],
        required_skills: [],
        nice_to_have_skills: [],
        experience_min: 2,
        experience_max: 5,
        recommended_pipeline: 'coding_plus_voice',
      };
    }

    const batchMatch = user.match(/Generate exactly (\d+) unique spoken interview/i);
    if (batchMatch) {
      const count = Math.min(Math.max(parseInt(batchMatch[1] ?? '3', 10), 1), 8);
      const prompts = [
        'What motivated you to apply for this role, and what are you hoping to accomplish here?',
        'Tell me about a time you had to work through a disagreement with a teammate.',
        'How do you prioritize when you have multiple deadlines at once?',
        'Describe a situation where you received tough feedback and what you did next.',
        'What kind of team culture helps you do your best work?',
        'Where do you see your career heading over the next few years?',
        'How do you handle ambiguity when requirements are not fully clear?',
        'What are your compensation expectations and notice period?',
      ];
      return {
        fallback: true,
        __isFallback: true,
        questions: Array.from({ length: count }, (_, i) => ({
          title: `Interview question ${i + 1}`,
          problemStatement: prompts[i % prompts.length],
          requirements: [],
          expectedSkills: ['communication', 'collaboration'],
          evaluationCriteria: ['Clarity', 'Specific examples', 'Role fit'],
          environmentTemplate: {},
          questionType: 'INTERVIEW',
          language: 'TEXT',
          difficulty: 'EASY',
          marks: 10,
        })),
      };
    }

    if (
      user.includes('INTERVIEW') ||
      /spoken interview|NON-TECHNICAL ROUND|HR round|behavioral/i.test(user)
    ) {
      return {
        __isFallback: true,
        title: 'Culture and collaboration',
        problemStatement:
          'Tell me about a time you had to align with stakeholders who disagreed with your approach.',
        requirements: [],
        expectedSkills: ['communication', 'collaboration'],
        evaluationCriteria: ['STAR structure', 'Self-awareness', 'Outcome focus'],
        environmentTemplate: {},
        questionType: 'INTERVIEW',
        language: 'TEXT',
        difficulty: 'EASY',
        marks: 10,
      };
    }

    if (user.includes('evaluate') || user.includes('Evaluate')) {
      return {
        __isFallback: true,
        score: 12,
        maxScore: 20,
        strengths: ['Clear structure'],
        weaknesses: ['Could improve edge cases'],
        recommendations: ['Add tests for boundary inputs'],
        summary: 'Fallback AI evaluation (LLM unavailable)',
      };
    }

    if (
      /Generate a complete coding assessment/i.test(user) ||
      /Generate a complete SQL\/database assessment/i.test(user) ||
      /RETURN FORMAT — strict JSON only/i.test(user)
    ) {
      return { __isFallback: true };
    }

    const isPhpOrSql = /php|mysql|pdo|sql|database|mariadb/i.test(user);
    if (isPhpOrSql) {
      return {
        __isFallback: true,
        title: 'AI Generated: Fix SQL injection in user lookup',
        problemStatement:
          'A PHP endpoint reads ?id= from the query string and fetches a user row. Fix the SQL injection vulnerability while keeping the same response format.',
        requirements: ['Use parameterized queries', 'Return JSON array of rows', 'Handle invalid id gracefully'],
        expectedSkills: ['PHP', 'MySQL', 'Security'],
        evaluationCriteria: ['Correctness', 'Security fix', 'Output format'],
        environmentTemplate: {
          runtime: 'PHP',
          dockerTemplate: 'assessment-php',
          services: ['mysql'],
          schemaSql:
            "CREATE TABLE users (id INT PRIMARY KEY, name VARCHAR(100));\nINSERT INTO users (id, name) VALUES (1, 'Alice'), (2, 'Bob');",
          dbName: 'testdb',
          dbHost: '127.0.0.1',
          dbUser: 'root',
          dbPassword: '',
        },
        questionType: 'CODING',
        language: 'PHP',
        difficulty: 'MEDIUM',
        marks: 20,
        starterCode: `<?php
$pdo = new PDO('mysql:host=localhost;dbname=testdb', 'root', '');
$id = $_GET['id'];
$query = "SELECT * FROM users WHERE id = $id";
$result = $pdo->query($query);
echo json_encode($result ? $result->fetchAll(PDO::FETCH_ASSOC) : []);
`,
        testCases: [
          { input: '?id=1', expectedOutput: '[{"id":1,"name":"Alice"}]', isHidden: false },
          { input: '?id=2', expectedOutput: '[{"id":2,"name":"Bob"}]', isHidden: false },
          { input: '?id=1 OR 1=1', expectedOutput: '[]', isHidden: true },
        ],
      };
    }

    return {
      __isFallback: true,
      title: 'AI Generated: Practical Debugging Task',
      problemStatement:
        'A production API shows intermittent 500 errors under load. Trace the root cause and propose a fix.',
      requirements: ['Identify likely bottleneck', 'Propose code or infra fix', 'Note monitoring improvements'],
      expectedSkills: ['Debugging', 'Backend'],
      evaluationCriteria: ['Correctness', 'Clarity', 'Production awareness'],
      environmentTemplate: {
        runtime: 'PYTHON',
        dockerTemplate: 'python-cli',
        services: [],
      },
      questionType: 'CODING',
      language: 'PYTHON',
      difficulty: 'MEDIUM',
      marks: 20,
    };
  }
}

