import { Injectable, Logger } from '@nestjs/common';
import {
  OpenAiClientService,
  type ChatJsonDetailedResult,
} from '../assessment-platform/assessment-ai/openai-client.service';

export type ProjectLlmMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export type ProjectLlmOptions = {
  temperature?: number;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high' | 'off';
};

export interface ProjectEvaluationLlm {
  chatJson<T>(messages: ProjectLlmMessage[], options?: ProjectLlmOptions): Promise<T>;
  chatJsonDetailed<T>(
    messages: ProjectLlmMessage[],
    options?: ProjectLlmOptions,
  ): Promise<ChatJsonDetailedResult<T>>;
  activeModel(): string;
}

export const PROJECT_EVALUATION_LLM = Symbol('PROJECT_EVALUATION_LLM');

/**
 * Project evaluation LLM client using OpenAiClientService.
 * Throws instead of returning canned JSON.
 */
@Injectable()
export class ProjectInterviewLlmClient implements ProjectEvaluationLlm {
  private readonly logger = new Logger(ProjectInterviewLlmClient.name);

  constructor(private readonly openai: OpenAiClientService) {}

  activeModel(): string {
    return this.openai.activeModel();
  }

  async chatJson<T>(messages: ProjectLlmMessage[], options?: ProjectLlmOptions): Promise<T> {
    const detailed = await this.chatJsonDetailed<T>(messages, options);
    return detailed.data;
  }

  async chatJsonDetailed<T>(
    messages: ProjectLlmMessage[],
    options?: ProjectLlmOptions,
  ): Promise<ChatJsonDetailedResult<T>> {
    if (!this.openai.isConfigured()) {
      throw new Error('No LLM provider configured for project evaluation');
    }
    const result = await this.openai.chatJsonDetailed<T & { __isFallback?: boolean }>(
      messages,
      options,
    );
    if (result.data && typeof result.data === 'object' && result.data.__isFallback) {
      throw new Error('LLM provider failed (fallback response)');
    }
    return result as ChatJsonDetailedResult<T>;
  }
}
