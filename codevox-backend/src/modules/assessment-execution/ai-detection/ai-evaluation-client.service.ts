import { Injectable, Logger } from '@nestjs/common';
import axios, { isAxiosError } from 'axios';
import { createRequire } from 'node:module';
import { join, resolve as resolvePath } from 'node:path';
import { resolveSubmissionSourceCode } from '../utils/php-assessment-adapter';

export type AiDetectionResult = {
  aiProbability: number;
  flagged: boolean;
  signals: string[];
};

export type CodeEvaluationResult = {
  score: number;
  architecturalFlaws: string[];
  isProductionReady: boolean;
};

export type SubmissionAnalysisResult = {
  detection: AiDetectionResult | null;
  evaluation: CodeEvaluationResult | null;
};

type DockerDetectionResult = {
  ok: boolean;
  error: string | null;
  message: string | null;
  aiProbability: number | null;
  flagged: boolean;
  signals: string[];
};

type DockerEvaluationResult = {
  ok: boolean;
  error: string | null;
  message: string | null;
  score: number | null;
  architecturalFlaws: string[];
  isProductionReady: boolean;
};

type DockerBridgeModule = {
  analyzeSubmissionViaDocker: (
    techStack: string,
    codeText: string,
  ) => Promise<{ detection: DockerDetectionResult; evaluation: DockerEvaluationResult }>;
  detectAiCodeViaDocker: (
    techStack: string,
    codeText: string,
  ) => Promise<DockerDetectionResult>;
  evaluateCodeViaDocker: (
    techStack: string,
    codeText: string,
  ) => Promise<DockerEvaluationResult>;
};

function evaluationMode(): 'docker' | 'http' {
  const raw = (process.env.AI_EVALUATION_MODE ?? 'docker').trim().toLowerCase();
  return raw === 'http' ? 'http' : 'docker';
}

function serviceUrl(): string | undefined {
  return process.env.AI_EVALUATION_SERVICE_URL?.trim().replace(/\/$/, '') || undefined;
}

function evaluationTimeoutMs(): number {
  const raw = Number(process.env.AI_EVALUATION_TIMEOUT_MS ?? 90000);
  return Number.isFinite(raw) && raw > 0 ? raw : 90000;
}

function failOpen(): boolean {
  const raw = (process.env.AI_EVALUATION_FAIL_OPEN ?? 'true').trim().toLowerCase();
  return raw !== 'false' && raw !== '0';
}

function loadDockerBridge(): DockerBridgeModule {
  const require = createRequire(join(process.cwd(), 'package.json'));
  const modulePath = resolvePath(
    process.env.AI_EVALUATOR_MODULE?.trim() ||
      join(process.cwd(), 'services', 'dockerAiBridge.js'),
  );
  return require(modulePath) as DockerBridgeModule;
}

@Injectable()
export class AiEvaluationClientService {
  private readonly log = new Logger(AiEvaluationClientService.name);
  private dockerBridge: DockerBridgeModule | null = null;

  private getDockerBridge(): DockerBridgeModule {
    if (!this.dockerBridge) {
      this.dockerBridge = loadDockerBridge();
    }
    return this.dockerBridge;
  }

  /**
   * Runs AI detection and code evaluation in parallel (two separate Python APIs).
   */
  async analyzeSubmission(
    candidateId: string,
    questionId: string,
    codeText: string,
    techStack = 'code',
  ): Promise<SubmissionAnalysisResult | null> {
    const normalized = resolveSubmissionSourceCode(codeText).trim();
    if (!normalized) return null;

    if (evaluationMode() === 'http') {
      return this.analyzeViaHttp(candidateId, questionId, normalized, techStack);
    }
    return this.analyzeViaDocker(candidateId, questionId, normalized, techStack);
  }

  private async analyzeViaDocker(
    candidateId: string,
    questionId: string,
    codeText: string,
    techStack: string,
  ): Promise<SubmissionAnalysisResult | null> {
    try {
      const result = await Promise.race([
        this.getDockerBridge().analyzeSubmissionViaDocker(techStack, codeText),
        new Promise<null>((resolve) => {
          setTimeout(() => resolve(null), evaluationTimeoutMs());
        }),
      ]);

      if (!result) {
        this.log.warn(
          `AI analysis timed out candidate=${candidateId} question=${questionId}`,
        );
        return failOpen() ? null : null;
      }

      const detection = this.mapDockerDetection(result.detection, candidateId, questionId);
      const evaluation = this.mapDockerEvaluation(result.evaluation, candidateId, questionId);

      if (!detection && !evaluation) {
        return failOpen() ? null : null;
      }

      return { detection, evaluation };
    } catch (err) {
      this.log.warn(
        `AI analysis failed candidate=${candidateId} question=${questionId}: ${String(err)}`,
      );
      return failOpen() ? null : null;
    }
  }

  private mapDockerDetection(
    result: DockerDetectionResult,
    candidateId: string,
    questionId: string,
  ): AiDetectionResult | null {
    if (!result.ok || result.aiProbability === null) {
      this.log.warn(
        `AI detection skipped candidate=${candidateId} question=${questionId}: ${result.error ?? 'unknown'} — ${result.message ?? ''}`,
      );
      return null;
    }
    return {
      aiProbability: result.aiProbability,
      flagged: result.flagged,
      signals: result.signals,
    };
  }

  private mapDockerEvaluation(
    result: DockerEvaluationResult,
    candidateId: string,
    questionId: string,
  ): CodeEvaluationResult | null {
    if (!result.ok || result.score === null) {
      this.log.warn(
        `AI evaluation skipped candidate=${candidateId} question=${questionId}: ${result.error ?? 'unknown'} — ${result.message ?? ''}`,
      );
      return null;
    }
    return {
      score: result.score,
      architecturalFlaws: result.architecturalFlaws,
      isProductionReady: result.isProductionReady,
    };
  }

  private async analyzeViaHttp(
    candidateId: string,
    questionId: string,
    codeText: string,
    techStack: string,
  ): Promise<SubmissionAnalysisResult | null> {
    const baseUrl = serviceUrl();
    if (!baseUrl) {
      this.log.debug('AI_EVALUATION_SERVICE_URL unset — skipping HTTP AI analysis');
      return null;
    }

    try {
      const [detectionRes, evaluationRes] = await Promise.all([
        axios.post(
          `${baseUrl}/api/v1/detect-ai-code`,
          { techStack, codeText },
          {
            timeout: evaluationTimeoutMs(),
            headers: { 'Content-Type': 'application/json' },
            validateStatus: (status) => status < 500,
          },
        ),
        axios.post(
          `${baseUrl}/api/v1/evaluate-code`,
          { techStack, codeText },
          {
            timeout: evaluationTimeoutMs(),
            headers: { 'Content-Type': 'application/json' },
            validateStatus: (status) => status < 500,
          },
        ),
      ]);

      const detection = this.mapHttpDetection(detectionRes, candidateId, questionId);
      const evaluation = this.mapHttpEvaluation(evaluationRes, candidateId, questionId);

      if (!detection && !evaluation) {
        return failOpen() ? null : null;
      }

      return { detection, evaluation };
    } catch (err) {
      const message = isAxiosError(err)
        ? `${err.code ?? 'axios'} ${err.message}`
        : String(err);
      this.log.warn(
        `AI analysis HTTP failed candidate=${candidateId} question=${questionId}: ${message}`,
      );
      return failOpen() ? null : null;
    }
  }

  private mapHttpDetection(
    response: { status: number; data: unknown },
    candidateId: string,
    questionId: string,
  ): AiDetectionResult | null {
    if (response.status >= 400) {
      const detail = response.data as { message?: string };
      this.log.warn(
        `AI detection HTTP ${response.status} candidate=${candidateId} question=${questionId}: ${detail?.message ?? 'unknown error'}`,
      );
      return null;
    }

    const data = response.data as {
      ai_probability?: number;
      flagged?: boolean;
      signals?: string[];
    };
    if (
      typeof data.ai_probability !== 'number' ||
      typeof data.flagged !== 'boolean' ||
      !Array.isArray(data.signals)
    ) {
      this.log.warn(
        `AI detection invalid payload candidate=${candidateId} question=${questionId}`,
      );
      return null;
    }

    return {
      aiProbability: Math.max(0, Math.min(100, Math.round(data.ai_probability))),
      flagged: data.flagged,
      signals: data.signals.map(String),
    };
  }

  private mapHttpEvaluation(
    response: { status: number; data: unknown },
    candidateId: string,
    questionId: string,
  ): CodeEvaluationResult | null {
    if (response.status >= 400) {
      const detail = response.data as { message?: string };
      this.log.warn(
        `AI evaluation HTTP ${response.status} candidate=${candidateId} question=${questionId}: ${detail?.message ?? 'unknown error'}`,
      );
      return null;
    }

    const data = response.data as {
      quality_score?: number;
      architectural_flaws?: string[];
      is_production_ready?: boolean;
    };
    if (
      typeof data.quality_score !== 'number' ||
      !Array.isArray(data.architectural_flaws) ||
      typeof data.is_production_ready !== 'boolean'
    ) {
      this.log.warn(
        `AI evaluation invalid payload candidate=${candidateId} question=${questionId}`,
      );
      return null;
    }

    return {
      score: Math.max(0, Math.min(100, Math.round(data.quality_score))),
      architecturalFlaws: data.architectural_flaws.map(String),
      isProductionReady: data.is_production_ready,
    };
  }
}
