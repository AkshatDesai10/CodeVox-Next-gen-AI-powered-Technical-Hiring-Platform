import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { VectorStore } from './vector-store.interface';
import type {
  VectorSearchExclude,
  VectorSearchHit,
  VectorUpsertItem,
} from './integrity.types';

const DEFAULT_URL = 'http://localhost:8012';
const DEFAULT_TIMEOUT_MS = 60_000;

@Injectable()
export class FaissVectorStore implements VectorStore {
  constructor(private readonly config: ConfigService) {}

  async upsert(items: VectorUpsertItem[]): Promise<void> {
    if (!items.length) return;
    await this.post('/index/upsert', {
      items: items.map((item) => ({
        chunk_id: item.chunkId,
        report_id: item.reportId,
        student_id: item.studentId,
        chunk_index: item.chunkIndex,
        chunk_text: item.chunkText,
        start_offset: item.startOffset,
        end_offset: item.endOffset,
        embedding: item.embedding,
      })),
    });
  }

  async removeByReport(reportId: string): Promise<void> {
    await this.post('/index/remove', { report_ids: [reportId] });
  }

  async search(
    queryEmbedding: number[],
    topK: number,
    exclude?: VectorSearchExclude,
  ): Promise<VectorSearchHit[]> {
    const body = await this.post<{ results: Array<Record<string, unknown>> }>('/search', {
      embedding: queryEmbedding,
      top_k: topK,
      exclude_report_id: exclude?.reportId ?? null,
      exclude_student_id: exclude?.studentId ?? null,
    });
    return (body.results ?? []).map((row) => ({
      chunkId: String(row.chunk_id),
      reportId: String(row.report_id),
      studentId: String(row.student_id),
      chunkIndex: Number(row.chunk_index ?? 0),
      chunkText: String(row.chunk_text ?? ''),
      startOffset: Number(row.start_offset ?? 0),
      endOffset: Number(row.end_offset ?? 0),
      similarity: Number(row.similarity ?? 0),
    }));
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    const url = `${this.serviceUrl()}${path}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs()),
    });
    const body = (await response.json().catch(() => ({}))) as T & { detail?: string };
    if (!response.ok) {
      throw new Error((body as { detail?: string }).detail ?? `Vector store HTTP ${response.status}`);
    }
    return body;
  }

  private serviceUrl(): string {
    return (this.config.get<string>('EMBEDDING_SERVICE_URL') ?? DEFAULT_URL).trim().replace(/\/$/, '');
  }

  private timeoutMs(): number {
    const raw = Number(this.config.get<string>('EMBEDDING_TIMEOUT_MS') ?? DEFAULT_TIMEOUT_MS);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
  }
}
