import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import type { AiTextDetectionResult } from './ai-detection.types';
import { AiContentDetectionService } from './ai-content-detection.service';
import { AiDetectionReportMysql } from './entities/ai-detection-report.mysql.entity';
import { chunkText, extractReportText } from './text-extraction.util';

const MIN_TEXT_LENGTH = 40;
const PREVIEW_LENGTH = 1000;

export interface AiDetectionReportDto {
  id: string;
  examiner_name: string | null;
  source_type: 'file' | 'text';
  document_title: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size: number | null;
  char_count: number;
  chunk_count: number;
  verdict: string | null;
  confidence: number | null;
  ai_probability: number | null;
  human_probability: number | null;
  analysis: {
    perplexity: number | null;
    burstiness: number | null;
    entropy: number | null;
    classifier_score: number | null;
  };
  flagged_segments: unknown[];
  text_preview: string | null;
  provider_id: string | null;
  created_at: string;
}

interface AggregatedDetection {
  verdict: string;
  confidence: number;
  aiProbability: number;
  humanProbability: number;
  perplexity: number | null;
  burstiness: number | null;
  entropy: number | null;
  classifierScore: number | null;
  flaggedSegments: unknown[];
  providerId: string | null;
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value: number | null, digits = 4): number | null {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

@Injectable()
export class AiDetectionService {
  constructor(
    private readonly detection: AiContentDetectionService,
    @InjectRepository(AiDetectionReportMysql)
    private readonly reports: Repository<AiDetectionReportMysql>,
  ) {}

  async analyze(
    user: JwtUserPayload,
    input: {
      file?: Express.Multer.File;
      text?: string;
      title?: string;
    },
  ): Promise<AiDetectionReportDto> {
    const text = input.file
      ? await extractReportText(input.file)
      : (input.text ?? '').trim();

    if (text.length < MIN_TEXT_LENGTH) {
      throw new BadRequestException(
        `Not enough readable text to analyze (need at least ${MIN_TEXT_LENGTH} characters). If this is a scanned PDF, it may contain images without extractable text.`,
      );
    }

    const chunks = chunkText(text);
    const results = await this.detectChunks(chunks);
    const aggregate = this.aggregate(chunks, results);

    const examinerName = user.name?.trim() || user.email || null;
    const row = this.reports.create({
      id: randomUUID(),
      userId: user.sub ?? null,
      examinerName,
      sourceType: input.file ? 'file' : 'text',
      documentTitle: input.title?.trim() || input.file?.originalname || null,
      fileName: input.file?.originalname ?? null,
      mimeType: input.file?.mimetype ?? null,
      fileSize: input.file?.size ?? null,
      charCount: text.length,
      chunkCount: chunks.length,
      verdict: aggregate.verdict,
      confidence: round(aggregate.confidence),
      aiProbability: round(aggregate.aiProbability),
      humanProbability: round(aggregate.humanProbability),
      perplexity: round(aggregate.perplexity),
      burstiness: round(aggregate.burstiness),
      entropy: round(aggregate.entropy),
      classifierScore: round(aggregate.classifierScore),
      flaggedSegments: aggregate.flaggedSegments,
      textPreview: text.slice(0, PREVIEW_LENGTH),
      providerId: aggregate.providerId,
      inactive: 0,
    });
    const saved = await this.reports.save(row);
    return this.toDto(saved);
  }

  async list(user: JwtUserPayload): Promise<AiDetectionReportDto[]> {
    const rows = await this.reports.find({
      where: { userId: user.sub ?? undefined, inactive: 0 },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return rows.map((row) => this.toDto(row));
  }

  async get(user: JwtUserPayload, id: string): Promise<AiDetectionReportDto> {
    const row = await this.reports.findOne({ where: { id, inactive: 0 } });
    if (!row) throw new NotFoundException('Detection report not found.');
    return this.toDto(row);
  }

  private async detectChunks(
    chunks: string[],
  ): Promise<AiTextDetectionResult[]> {
    const out: AiTextDetectionResult[] = [];
    for (const chunk of chunks) {
      out.push(await this.detection.detectText(chunk));
    }
    return out;
  }

  private aggregate(
    chunks: string[],
    results: AiTextDetectionResult[],
  ): AggregatedDetection {
    let weightSum = 0;
    let aiWeighted = 0;
    const metricAcc = {
      perplexity: [] as number[],
      burstiness: [] as number[],
      entropy: [] as number[],
      classifierScore: [] as number[],
    };
    const flagged: unknown[] = [];
    let providerId: string | null = null;

    results.forEach((res, idx) => {
      const weight = Math.max(chunks[idx]?.length ?? 1, 1);
      const ai =
        num(res.scores?.ai_probability) ??
        (res.verdict === 'ai_generated' ? num(res.confidence) ?? 0.5 : null);
      if (ai !== null) {
        aiWeighted += ai * weight;
        weightSum += weight;
      }
      const perplexity = num(res.analysis?.perplexity);
      const burstiness = num(res.analysis?.burstiness);
      const entropy = num(res.analysis?.entropy);
      const classifier = num(res.analysis?.classifier_score);
      if (perplexity !== null) metricAcc.perplexity.push(perplexity);
      if (burstiness !== null) metricAcc.burstiness.push(burstiness);
      if (entropy !== null) metricAcc.entropy.push(entropy);
      if (classifier !== null) metricAcc.classifierScore.push(classifier);
      if (Array.isArray(res.flagged_segments) && res.flagged_segments.length) {
        flagged.push(
          ...res.flagged_segments.map((seg) =>
            chunks.length > 1
              ? { chunk_index: idx, ...(seg as Record<string, unknown>) }
              : seg,
          ),
        );
      }
      if (!providerId && res.id) providerId = res.id;
    });

    const aiProbability = weightSum > 0 ? aiWeighted / weightSum : 0.5;
    const humanProbability = 1 - aiProbability;
    const avg = (arr: number[]): number | null =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

    const verdict =
      aiProbability >= 0.6
        ? 'ai_generated'
        : aiProbability <= 0.4
          ? 'human'
          : 'uncertain';
    const confidence = Math.max(aiProbability, humanProbability);

    return {
      verdict,
      confidence,
      aiProbability,
      humanProbability,
      perplexity: avg(metricAcc.perplexity),
      burstiness: avg(metricAcc.burstiness),
      entropy: avg(metricAcc.entropy),
      classifierScore: avg(metricAcc.classifierScore),
      flaggedSegments: flagged,
      providerId,
    };
  }

  private toDto(row: AiDetectionReportMysql): AiDetectionReportDto {
    return {
      id: row.id,
      examiner_name: row.examinerName,
      source_type: row.sourceType,
      document_title: row.documentTitle,
      file_name: row.fileName,
      mime_type: row.mimeType,
      file_size: row.fileSize,
      char_count: row.charCount,
      chunk_count: row.chunkCount,
      verdict: row.verdict,
      confidence: row.confidence,
      ai_probability: row.aiProbability,
      human_probability: row.humanProbability,
      analysis: {
        perplexity: row.perplexity,
        burstiness: row.burstiness,
        entropy: row.entropy,
        classifier_score: row.classifierScore,
      },
      flagged_segments: Array.isArray(row.flaggedSegments)
        ? row.flaggedSegments
        : [],
      text_preview: row.textPreview,
      provider_id: row.providerId,
      created_at:
        row.createdAt instanceof Date
          ? row.createdAt.toISOString()
          : String(row.createdAt),
    };
  }
}
