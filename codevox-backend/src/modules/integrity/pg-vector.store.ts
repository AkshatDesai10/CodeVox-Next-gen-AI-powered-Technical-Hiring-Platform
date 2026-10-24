import { Injectable } from '@nestjs/common';
import type { VectorStore } from './vector-store.interface';
import type {
  VectorSearchExclude,
  VectorSearchHit,
  VectorUpsertItem,
} from './integrity.types';

@Injectable()
export class PgVectorStore implements VectorStore {
  async upsert(_items: VectorUpsertItem[]): Promise<void> {
    throw new Error('PgVectorStore is not configured (MySQL deployment uses FaissVectorStore).');
  }

  async removeByReport(_reportId: string): Promise<void> {
    throw new Error('PgVectorStore is not configured (MySQL deployment uses FaissVectorStore).');
  }

  async search(
    _queryEmbedding: number[],
    _topK: number,
    _exclude?: VectorSearchExclude,
  ): Promise<VectorSearchHit[]> {
    throw new Error('PgVectorStore is not configured (MySQL deployment uses FaissVectorStore).');
  }
}
