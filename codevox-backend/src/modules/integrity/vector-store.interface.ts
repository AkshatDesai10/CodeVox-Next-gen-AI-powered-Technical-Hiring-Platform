import type {
  VectorSearchExclude,
  VectorSearchHit,
  VectorUpsertItem,
} from './integrity.types';

export interface VectorStore {
  upsert(items: VectorUpsertItem[]): Promise<void>;
  removeByReport(reportId: string): Promise<void>;
  search(
    queryEmbedding: number[],
    topK: number,
    exclude?: VectorSearchExclude,
  ): Promise<VectorSearchHit[]>;
}

export const VECTOR_STORE = Symbol('VECTOR_STORE');
