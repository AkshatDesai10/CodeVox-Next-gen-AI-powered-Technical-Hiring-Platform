import { Injectable } from '@nestjs/common';
import { OpenAiClientService, type ChatJsonDetailedResult } from '../assessment-platform/assessment-ai/openai-client.service';

@Injectable()
export class TakeHomeLlmClient {
  constructor(private readonly openai: OpenAiClientService) {}

  isConfigured(prefix?: string): boolean {
    return this.openai.isConfigured();
  }

  model(prefix?: string): string {
    return this.openai.activeModel();
  }

  provider(prefix?: string): string {
    return 'openai';
  }

  async chatJsonDetailed<T>(messages: any[], options?: any): Promise<ChatJsonDetailedResult<T>> {
    return this.openai.chatJsonDetailed<T>(messages, options);
  }
}
