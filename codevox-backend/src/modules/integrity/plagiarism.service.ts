import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { VivaProjectReportMysql, VivaReportChunkMysql } from '../viva-erp/entities/viva-erp.mysql.entities';
import { ChunkService } from './chunk.service';
import { EmbeddingService } from './embedding.service';
import { IntegrityConfigService } from './integrity.config';
import { LexicalSimilarityService } from './lexical-similarity.service';
import type {
  MatchedChunkEvidence,
  PlagiarismAnalysisResult,
  VectorUpsertItem,
} from './integrity.types';
import { VECTOR_STORE, type VectorStore } from './vector-store.interface';

export type PlagiarismAnalyzeInput = {
  text: string;
  reportId: string;
  studentId: string;
  compositeLexicalWeight?: number;
  compositeSemanticWeight?: number;
};

@Injectable()
export class PlagiarismService {
  private readonly log = new Logger(PlagiarismService.name);

  constructor(
    private readonly chunkService: ChunkService,
    private readonly embeddingService: EmbeddingService,
    private readonly lexicalService: LexicalSimilarityService,
    private readonly config: IntegrityConfigService,
    @Inject(VECTOR_STORE) private readonly vectorStore: VectorStore,
    @InjectRepository(VivaReportChunkMysql)
    private readonly chunks: Repository<VivaReportChunkMysql>,
    @InjectRepository(VivaProjectReportMysql)
    private readonly reports: Repository<VivaProjectReportMysql>,
  ) {}

  async analyze(input: PlagiarismAnalyzeInput): Promise<PlagiarismAnalysisResult> {
    const { text, reportId, studentId } = input;
    const cfg = this.config.values();

    if (text.length < 80) {
      return this.emptyResult(text, 'Insufficient text to compare against prior submissions.');
    }

    const documentChunks = this.chunkService.chunkDocument(
      text,
      cfg.chunkSize,
      cfg.chunkOverlap,
    );
    if (!documentChunks.length) {
      return this.emptyResult(text, 'No readable chunks were produced from the report.');
    }

    const totalTokens = documentChunks.reduce((sum, c) => sum + c.tokenCount, 0);
    const embeddings = await this.embeddingService.embedMany(documentChunks.map((c) => c.text));

    const matchedBySourceIndex = new Map<number, MatchedChunkEvidence>();
    const reportNameCache = new Map<string, string>();

    for (let i = 0; i < documentChunks.length; i += 1) {
      const source = documentChunks[i]!;
      const embedding = embeddings[i];
      if (!embedding?.length) continue;

      const candidates = await this.vectorStore.search(embedding, cfg.topK, {
        reportId,
        studentId,
      });

      for (const candidate of candidates) {
        if (candidate.similarity < cfg.semanticThreshold) continue;

        const lexical = this.lexicalService.overlapPercent(source.text, candidate.chunkText);
        if (lexical.overlapPct < cfg.lexicalThreshold) continue;

        const existing = matchedBySourceIndex.get(source.index);
        if (existing && existing.lexicalSimilarity >= lexical.overlapPct) continue;

        const fileName = await this.reportFileName(candidate.reportId, reportNameCache);
        matchedBySourceIndex.set(source.index, {
          reportId: candidate.reportId,
          studentId: candidate.studentId,
          matchedFileName: fileName,
          sourceChunk: source.text,
          targetChunk: candidate.chunkText,
          semanticSimilarity: candidate.similarity,
          lexicalSimilarity: lexical.overlapPct,
          sourceOffsets: { start: source.startOffset, end: source.endOffset },
          targetOffsets: { start: candidate.startOffset, end: candidate.endOffset },
        });
      }
    }

    const matchedChunks = [...matchedBySourceIndex.values()].sort(
      (a, b) => b.lexicalSimilarity - a.lexicalSimilarity,
    );

    const matchedCopiedTokens = [...matchedBySourceIndex.keys()].reduce((sum, idx) => {
      const sourceChunk = documentChunks.find((c) => c.index === idx);
      return sum + (sourceChunk?.tokenCount ?? 0);
    }, 0);

    const plagiarismPct =
      totalTokens > 0
        ? Math.round((matchedCopiedTokens / totalTokens) * 1000) / 10
        : 0;

    const lexicalWeight = input.compositeLexicalWeight ?? 0.7;
    const semanticWeight = input.compositeSemanticWeight ?? 0.3;
    const semanticSupportPct =
      matchedChunks.length > 0
        ? Math.round(Math.max(...matchedChunks.map((m) => m.semanticSimilarity * 100)) * 10) / 10
        : 0;
    const compositePct =
      Math.round((lexicalWeight * plagiarismPct + semanticWeight * semanticSupportPct) * 10) / 10;

    await this.persistChunks(reportId, studentId, documentChunks, embeddings);

    const best = matchedChunks[0];
    const excerpt: Record<string, unknown> = {
      similarity_pct: compositePct,
      lexical_coverage_pct: plagiarismPct,
      semantic_support_pct: semanticSupportPct,
      composite_pct: compositePct,
      composite_lexical_weight: lexicalWeight,
      composite_semantic_weight: semanticWeight,
      text_preview: text.slice(0, 3000),
      matched_chunks: matchedChunks.map((m) => ({
        report_id: m.reportId,
        student_id: m.studentId,
        matched_file_name: m.matchedFileName,
        source_chunk: m.sourceChunk,
        target_chunk: m.targetChunk,
        semantic_similarity: Math.round(m.semanticSimilarity * 1000) / 1000,
        lexical_similarity: Math.round(m.lexicalSimilarity * 1000) / 1000,
        source_offsets: m.sourceOffsets,
        target_offsets: m.targetOffsets,
      })),
      engine: 'hybrid_semantic_lexical',
      total_tokens: totalTokens,
      matched_copied_tokens: matchedCopiedTokens,
      summary: best
        ? `Composite plagiarism ${compositePct}% (lexical ${plagiarismPct}%, semantic ${semanticSupportPct}%) — best match: "${best.matchedFileName ?? 'prior report'}".`
        : 'No significant overlap with prior student reports in the indexed corpus.',
    };

    if (best) {
      excerpt.matched_report_id = best.reportId;
      excerpt.matched_file_name = best.matchedFileName;
    }

    return {
      plagiarismPct: compositePct,
      lexicalCoveragePct: plagiarismPct,
      semanticSupportPct,
      compositePct,
      totalTokens,
      matchedCopiedTokens,
      matchedChunks,
      excerpt,
    };
  }

  private async persistChunks(
    reportId: string,
    studentId: string,
    documentChunks: ReturnType<ChunkService['chunkDocument']>,
    embeddings: number[][],
  ): Promise<void> {
    await this.chunks.update({ reportId, inactive: 0 }, { inactive: 1 });
    await this.vectorStore.removeByReport(reportId);

    const rows: VivaReportChunkMysql[] = [];
    for (let i = 0; i < documentChunks.length; i += 1) {
      const chunk = documentChunks[i]!;
      const embedding = embeddings[i] ?? [];
      rows.push(
        this.chunks.create({
          reportId,
          studentId,
          chunkIndex: chunk.index,
          chunkText: chunk.text,
          startOffset: chunk.startOffset,
          endOffset: chunk.endOffset,
          embeddingJson: embedding.length ? embedding : null,
          tokenCount: chunk.tokenCount,
          inactive: 0,
        }),
      );
    }

    const saved = await this.chunks.save(rows);
    const upsertItems: VectorUpsertItem[] = saved.map((row, idx) => ({
      chunkId: row.id,
      reportId,
      studentId,
      chunkIndex: row.chunkIndex,
      chunkText: row.chunkText,
      startOffset: row.startOffset,
      endOffset: row.endOffset,
      embedding: embeddings[idx] ?? row.embeddingJson ?? [],
    }));
    if (upsertItems.length) {
      await this.vectorStore.upsert(upsertItems);
    }
  }

  private async reportFileName(
    reportId: string,
    cache: Map<string, string>,
  ): Promise<string | undefined> {
    if (cache.has(reportId)) return cache.get(reportId);
    const row = await this.reports.findOne({ where: { id: reportId, inactive: 0 } });
    const name = row?.fileName;
    if (name) cache.set(reportId, name);
    return name;
  }

  private emptyResult(text: string, summary: string): PlagiarismAnalysisResult {
    return {
      plagiarismPct: 0,
      lexicalCoveragePct: 0,
      semanticSupportPct: 0,
      compositePct: 0,
      totalTokens: 0,
      matchedCopiedTokens: 0,
      matchedChunks: [],
      excerpt: {
        similarity_pct: 0,
        summary,
        text_preview: text.slice(0, 300) || null,
        engine: 'hybrid_semantic_lexical',
        matched_chunks: [],
      },
    };
  }
}
