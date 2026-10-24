import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OpenAiClientService } from '../assessment-platform/assessment-ai/openai-client.service';
import { JobProfileAiLogMysql } from '../job-profiles/entities/job-profile-ai-log.mysql.entity';
import {
  configuredAiScreeningRequirements,
  normalizeAiScreeningRoundConfig,
} from '../job-profiles/ai-screening-round.types';
import { AI_SCREENING_ANALYZER_SYSTEM_PROMPT } from './screening-analyzer.prompt';

export type ScreeningAnalyzerStatus = 'PENDING' | 'COMPLETED' | 'FAILED';

export type ScreeningCheck = {
  status: 'PASS' | 'FLAG' | 'INSUFFICIENT_EVIDENCE' | 'NOT_APPLICABLE';
  category: string;
  /** Stable requirement id (replaces per-topic requirement mapping). */
  requirementId: string;
  /** @deprecated Kept for older report consumers; mirrors requirementId. */
  topicId?: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  requirement: string;
  question?: string;
  candidate_evidence: string | null;
  reason: string;
  confidence: number;
};

export type ScreeningVoiceAudit = {
  analyzerStatus: ScreeningAnalyzerStatus;
  conversationState: Record<string, unknown>;
  transcript: Array<Record<string, unknown>>;
  roundConfig?: Record<string, unknown>;
  jobProfileContext?: Record<string, unknown>;
  screeningResult: { checks: ScreeningCheck[] } | null;
  error: string | null;
  analyzedAt: string | null;
};

@Injectable()
export class ScreeningAnalyzerService {
  private readonly logger = new Logger(ScreeningAnalyzerService.name);

  constructor(
    private readonly openai: OpenAiClientService,
    @InjectRepository(JobProfileAiLogMysql)
    private readonly aiLogs: Repository<JobProfileAiLogMysql>,
  ) {}

  buildPendingAudit(input: {
    transcript: Array<Record<string, unknown>>;
    conversationState: Record<string, unknown>;
    roundConfig?: Record<string, unknown>;
    jobProfileContext?: Record<string, unknown>;
  }): ScreeningVoiceAudit {
    return {
      analyzerStatus: 'PENDING',
      conversationState: input.conversationState ?? {},
      transcript: input.transcript ?? [],
      roundConfig: input.roundConfig,
      jobProfileContext: input.jobProfileContext,
      screeningResult: null,
      error: null,
      analyzedAt: null,
    };
  }

  async analyze(audit: ScreeningVoiceAudit): Promise<ScreeningVoiceAudit> {
    const cfg = normalizeAiScreeningRoundConfig(audit.roundConfig);
    const requirements = configuredAiScreeningRequirements(cfg).map((r) => ({
      requirementId: r.id,
      question: r.question,
      requirement: r.expectedAnswer.trim(),
    }));

    if (!requirements.length) {
      return {
        ...audit,
        analyzerStatus: 'COMPLETED',
        screeningResult: { checks: [] },
        error: null,
        analyzedAt: new Date().toISOString(),
      };
    }

    try {
      // Post-interview only — live voice agent never calls this path.
      const messages = [
        {
          role: 'system' as const,
          content: AI_SCREENING_ANALYZER_SYSTEM_PROMPT,
        },
        {
          role: 'user' as const,
          content: JSON.stringify({
            instruction:
              'Evaluate each requirement: does the candidate answer SATISFY the configured condition? PASS only if yes, FLAG if no, INSUFFICIENT_EVIDENCE if unclear. Merely answering is not PASS.',
            transcript: audit.transcript,
            conversation_state: audit.conversationState,
            requirements,
            job_profile_context: audit.jobProfileContext ?? {},
          }),
        },
      ];
      const detailed = await this.openai.chatJsonDetailed<{ checks?: unknown }>(messages);
      const result = detailed.data;
      try {
        await this.aiLogs.save(
          this.aiLogs.create({
            operation: 'AI_SCREENING_ANALYSIS',
            model: detailed.model,
            promptHash: this.openai.promptHash(messages),
            requestJson: { messages },
            responseJson: result as Record<string, unknown>,
            promptTokens: detailed.usage.promptTokens,
            completionTokens: detailed.usage.completionTokens,
            inactive: 0,
          }),
        );
      } catch (logErr) {
        this.logger.warn(`Failed to persist AI_SCREENING_ANALYSIS log: ${String(logErr)}`);
      }

      const checks = this.normalizeChecks(result?.checks, requirements);
      return {
        ...audit,
        analyzerStatus: 'COMPLETED',
        screeningResult: { checks },
        error: null,
        analyzedAt: new Date().toISOString(),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Screening analyzer failed: ${message}`);
      return {
        ...audit,
        analyzerStatus: 'FAILED',
        screeningResult: null,
        error: message,
        analyzedAt: new Date().toISOString(),
      };
    }
  }

  private normalizeChecks(
    raw: unknown,
    requirements: Array<{ requirementId: string; question: string; requirement: string }>,
  ): ScreeningCheck[] {
    const allowed = new Set(requirements.map((r) => r.requirementId));
    const reqById = new Map(requirements.map((r) => [r.requirementId, r]));
    const out: ScreeningCheck[] = [];
    const items = Array.isArray(raw) ? raw : [];

    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const requirementId = String(
        row.requirementId ?? row.requirement_id ?? row.topicId ?? row.topic_id ?? '',
      );
      if (requirementId && !allowed.has(requirementId)) continue;
      const meta = reqById.get(requirementId);
      const requirement = String(row.requirement ?? meta?.requirement ?? '').trim();
      if (!requirement) continue;
      out.push({
        status: this.coerceStatus(row.status),
        category: String(row.category ?? 'GENERAL').toUpperCase().slice(0, 64),
        requirementId,
        topicId: requirementId,
        severity: this.coerceSeverity(row.severity),
        requirement,
        question: String(row.question ?? meta?.question ?? ''),
        candidate_evidence:
          row.candidate_evidence == null ? null : String(row.candidate_evidence),
        reason: String(row.reason ?? ''),
        confidence: this.coerceConfidence(row.confidence),
      });
    }

    const seen = new Set(out.map((c) => c.requirementId).filter(Boolean));
    for (const r of requirements) {
      if (seen.has(r.requirementId)) continue;
      out.push({
        status: 'INSUFFICIENT_EVIDENCE',
        category: 'GENERAL',
        requirementId: r.requirementId,
        topicId: r.requirementId,
        severity: 'LOW',
        requirement: r.requirement,
        question: r.question,
        candidate_evidence: null,
        reason: 'No analyzer row returned for this configured requirement.',
        confidence: 0.4,
      });
    }
    return out;
  }

  private coerceStatus(value: unknown): ScreeningCheck['status'] {
    const v = String(value ?? '').toUpperCase();
    if (
      v === 'PASS' ||
      v === 'FLAG' ||
      v === 'INSUFFICIENT_EVIDENCE' ||
      v === 'NOT_APPLICABLE'
    ) {
      return v;
    }
    return 'INSUFFICIENT_EVIDENCE';
  }

  private coerceSeverity(value: unknown): ScreeningCheck['severity'] {
    const v = String(value ?? '').toUpperCase();
    if (v === 'LOW' || v === 'MEDIUM' || v === 'HIGH') return v;
    return 'MEDIUM';
  }

  private coerceConfidence(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return 0.5;
    return Math.max(0, Math.min(1, n));
  }
}
