import { ConfigService } from '@nestjs/config';
import { ChunkService } from './chunk.service';
import { IntegrityConfigService } from './integrity.config';
import { LexicalSimilarityService } from './lexical-similarity.service';
import { PlagiarismService } from './plagiarism.service';
import type { VectorStore } from './vector-store.interface';
import type { VectorSearchHit } from './integrity.types';
import { VivaProjectReportMysql, VivaReportChunkMysql } from '../viva-erp/entities/viva-erp.mysql.entities';

class MockEmbeddingService {
  async embedMany(texts: string[]): Promise<number[][]> {
    return texts.map((text, i) => [i + 1, text.length, 0.5]);
  }
}

class MockVectorStore implements VectorStore {
  async upsert(): Promise<void> {}
  async removeByReport(): Promise<void> {}

  async search(
    _queryEmbedding: number[],
    _topK: number,
    exclude?: { reportId?: string; studentId?: string },
  ): Promise<VectorSearchHit[]> {
    if (exclude?.reportId === '99') return [];
    return [
      {
        chunkId: '10',
        reportId: '42',
        studentId: '7',
        chunkIndex: 0,
        chunkText:
          'Machine learning improves software engineering outcomes through better automation and quality.',
        startOffset: 0,
        endOffset: 90,
        similarity: 0.92,
      },
    ];
  }
}

describe('PlagiarismService', () => {
  const config = new IntegrityConfigService({
    get: (key: string) => {
      const map: Record<string, string> = {
        PLAGIARISM_SEMANTIC_THRESHOLD: '0.80',
        PLAGIARISM_LEXICAL_THRESHOLD: '0.20',
        PLAGIARISM_CHUNK_SIZE: '250',
        PLAGIARISM_CHUNK_OVERLAP: '50',
        PLAGIARISM_TOP_K: '5',
        PLAGIARISM_SHINGLE_SIZE: '5',
      };
      return map[key];
    },
  } as unknown as ConfigService);

  const chunksRepo = {
    update: jest.fn().mockResolvedValue(undefined),
    create: jest.fn((row) => row),
    save: jest.fn(async (rows) =>
      rows.map((row: VivaReportChunkMysql, idx: number) => ({ ...row, id: String(idx + 1) })),
    ),
  };

  const reportsRepo = {
    findOne: jest.fn().mockResolvedValue({ fileName: 'peer-report.pdf' } as VivaProjectReportMysql),
  };

  const service = new PlagiarismService(
    new ChunkService(),
    new MockEmbeddingService() as never,
    new LexicalSimilarityService(config),
    config,
    new MockVectorStore(),
    chunksRepo as never,
    reportsRepo as never,
  );

  it('scores copied-token coverage and returns matched chunk evidence', async () => {
    const source =
      'Machine learning improves software engineering outcomes through better automation and quality. ' +
      'This chapter also discusses deployment pipelines and testing strategies for production systems.';
    const result = await service.analyze({
      text: source,
      reportId: '99',
      studentId: '5',
    });

    expect(result.plagiarismPct).toBeGreaterThan(0);
    expect(result.matchedChunks.length).toBeGreaterThan(0);
    expect(result.excerpt.matched_report_id).toBe('42');
    expect(result.excerpt.engine).toBe('hybrid_semantic_lexical');
    expect(Array.isArray(result.excerpt.matched_chunks)).toBe(true);
    expect(String(result.excerpt.summary)).not.toContain('Jaccard');
  });

  it('returns zero for insufficient text', async () => {
    const result = await service.analyze({
      text: 'short',
      reportId: '1',
      studentId: '2',
    });
    expect(result.plagiarismPct).toBe(0);
    expect(result.matchedChunks).toHaveLength(0);
  });
});
