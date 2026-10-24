import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import type { AiTextDetectionResult } from './ai-detection.types';

export type { AiTextDetectionResult, DeepFlagDetectionResult } from './ai-detection.types';

const DEFAULT_BASE_URL = 'https://api.deepflag.ai';

@Injectable()
export class DeepFlagClient {
  private readonly logger = new Logger(DeepFlagClient.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string {
    return (
      this.config.get<string>('DEEPFLAG_API_URL')?.trim() || DEFAULT_BASE_URL
    ).replace(/\/+$/, '');
  }

  private apiKey(): string {
    const key = this.config.get<string>('DEEPFLAG_API_KEY')?.trim();
    if (!key) {
      throw new BadGatewayException(
        'DeepFlag API key is not configured. Set DEEPFLAG_API_KEY in the backend environment.',
      );
    }
    return key;
  }

  /** Runs AI-content detection on a single block of text. */
  async detectText(text: string): Promise<AiTextDetectionResult> {
    const url = `${this.baseUrl()}/api/v1/detect/text`;
    const maxAttempts = 2;
    let lastMessage = '';

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await axios.post<AiTextDetectionResult>(
          url,
          { text },
          {
            headers: {
              accept: 'application/json',
              'content-type': 'application/json',
              'X-API-Key': this.apiKey(),
            },
            timeout: 30_000,
          },
        );
        return res.data ?? {};
      } catch (err) {
        lastMessage = axios.isAxiosError(err)
          ? `${err.response?.status ?? ''} ${JSON.stringify(
              err.response?.data ?? err.message,
            )}`.trim()
          : err instanceof Error
            ? err.message
            : String(err);
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        const isTimeout = axios.isAxiosError(err) && (err.code === 'ECONNABORTED' || err.message.includes('timeout'));
        const retryable = status === 502 || status === 503 || status === 504 || isTimeout;
        if (retryable && attempt < maxAttempts) {
          this.logger.warn(`DeepFlag detect/text failed (attempt ${attempt}), retrying: ${lastMessage}`);
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }
        this.logger.warn(`DeepFlag detect/text failed: ${lastMessage}`);
        throw new BadGatewayException(
          `AI content detection failed: ${lastMessage}`,
        );
      }
    }

    throw new BadGatewayException(`AI content detection failed: ${lastMessage}`);
  }
}
