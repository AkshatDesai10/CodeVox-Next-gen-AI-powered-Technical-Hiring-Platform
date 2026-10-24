import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const DEFAULT_URL = 'http://localhost:8012';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_RETRIES = 8;
const DEFAULT_RETRY_DELAY_MS = 10_000;

@Injectable()
export class EmbeddingService {
  constructor(private readonly config: ConfigService) {}

  async embed(text: string): Promise<number[]> {
    const rows = await this.embedMany([text]);
    return rows[0] ?? [];
  }

  async embedMany(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const url = `${this.serviceUrl()}/embed`;
    const retries = this.maxRetries();
    const delayMs = this.retryDelayMs();

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ texts }),
          signal: AbortSignal.timeout(this.timeoutMs()),
        });
        const body = (await response.json().catch(() => ({}))) as {
          embeddings?: number[][];
          detail?: string;
        };

        if (response.status === 503 && attempt < retries) {
          await this.sleep(delayMs);
          continue;
        }
        if (!response.ok) {
          throw new Error(body.detail ?? `Embedding service HTTP ${response.status}`);
        }
        return body.embeddings ?? [];
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const retryable = /still loading|503|ECONNREFUSED|fetch failed|aborted/i.test(message);
        if (retryable && attempt < retries) {
          await this.sleep(delayMs);
          continue;
        }
        throw new Error(
          `Embedding service failed (${message}). Start: npm run embedding-service:start`,
        );
      }
    }
    throw new Error('Embedding service failed after retries.');
  }

  private serviceUrl(): string {
    return (this.config.get<string>('EMBEDDING_SERVICE_URL') ?? DEFAULT_URL).trim().replace(/\/$/, '');
  }

  private timeoutMs(): number {
    const raw = Number(this.config.get<string>('EMBEDDING_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }

  private maxRetries(): number {
    const raw = Number(this.config.get<string>('EMBEDDING_MAX_RETRIES') ?? DEFAULT_RETRIES);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETRIES;
  }

  private retryDelayMs(): number {
    const raw = Number(this.config.get<string>('EMBEDDING_RETRY_DELAY_MS') ?? DEFAULT_RETRY_DELAY_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETRY_DELAY_MS;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
