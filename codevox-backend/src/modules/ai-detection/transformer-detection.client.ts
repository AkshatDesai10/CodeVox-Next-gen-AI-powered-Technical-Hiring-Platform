import { BadGatewayException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiTextDetectionResult } from './ai-detection.types';
import { DebertaInstructDetectorClient } from './deberta-instruct-detector.client';
import { resolveTransformerModel, type ResolvedTransformerModel } from './transformer-model.config';
import { chunkText } from './text-extraction.util';

type ClassificationLabel = { label: string; score: number };
type TextClassificationPipeline = (
  text: string,
) => Promise<ClassificationLabel | ClassificationLabel[]>;

function normalizeLabels(
  output: ClassificationLabel | ClassificationLabel[],
): ClassificationLabel[] {
  return Array.isArray(output) ? output : [output];
}

function aiProbabilityFromLabels(labels: ClassificationLabel[]): number {
  const ai = labels.find((l) => /fake|ai|chatgpt|gpt|machine|generated|label_1/i.test(l.label));
  if (ai) return ai.score;
  const human = labels.find((l) => /real|human|label_0/i.test(l.label));
  if (human) return 1 - human.score;
  return labels[0]?.score ?? 0.5;
}

@Injectable()
export class TransformerDetectionClient {
  private readonly log = new Logger(TransformerDetectionClient.name);
  private pipelinePromise: Promise<TextClassificationPipeline> | null = null;
  private loadedModelId: string | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly debertaInstruct: DebertaInstructDetectorClient,
  ) {}

  describeConfig(): ResolvedTransformerModel {
    return resolveTransformerModel(this.config);
  }

  private resolved(): ResolvedTransformerModel {
    return resolveTransformerModel(this.config);
  }

  private async getPipeline(): Promise<TextClassificationPipeline> {
    const { modelId, modelKey } = this.resolved();
    if (this.pipelinePromise && this.loadedModelId === modelId) {
      return this.pipelinePromise;
    }
    this.loadedModelId = modelId;
    this.pipelinePromise = (async () => {
      this.log.log(`Loading transformer model "${modelId}" (${modelKey}, onnx)...`);
      const { pipeline } = await import('@xenova/transformers');
      const classifier = await pipeline('text-classification', modelId, {
        quantized: true,
      });
      this.log.log(`Transformer model "${modelId}" ready`);
      return classifier as TextClassificationPipeline;
    })().catch((err) => {
      this.pipelinePromise = null;
      this.loadedModelId = null;
      const message = err instanceof Error ? err.message : String(err);
      throw new BadGatewayException(
        `Failed to load transformer model "${modelId}": ${message}`,
      );
    });
    return this.pipelinePromise;
  }

  async detectText(text: string): Promise<AiTextDetectionResult> {
    const clean = text.trim();
    if (clean.length < 20) {
      throw new BadGatewayException('Not enough text for transformer AI detection.');
    }

    const { modelKey, modelId, runtime } = this.resolved();
    if (runtime === 'python') {
      return this.debertaInstruct.detectText(clean, modelId);
    }

    const classifier = await this.getPipeline();
    const chunks = chunkText(clean, 480, 16);
    const flagged: Array<{ text: string; ai_probability: number; label: string }> = [];
    let weightSum = 0;
    let aiWeighted = 0;

    for (const chunk of chunks) {
      const raw = await classifier(chunk.slice(0, 512));
      const labels = normalizeLabels(raw);
      const aiProb = aiProbabilityFromLabels(labels);
      const weight = Math.max(chunk.length, 1);
      aiWeighted += aiProb * weight;
      weightSum += weight;
      if (aiProb >= 0.55) {
        flagged.push({
          text: chunk.slice(0, 600),
          ai_probability: Math.round(aiProb * 1000) / 1000,
          label: labels.sort((a, b) => b.score - a.score)[0]?.label ?? 'ai',
        });
      }
    }

    const aiProbability = weightSum > 0 ? aiWeighted / weightSum : 0.5;
    const humanProbability = 1 - aiProbability;
    const verdict =
      aiProbability >= 0.6
        ? 'ai_generated'
        : aiProbability <= 0.4
          ? 'human'
          : 'uncertain';

    return {
      id: `transformer:${modelKey}:${Date.now()}`,
      content_type: `transformer-${modelKey}`,
      verdict,
      confidence: Math.max(aiProbability, humanProbability),
      scores: {
        ai_probability: aiProbability,
        human_probability: humanProbability,
      },
      analysis: {
        classifier_score: aiProbability,
      },
      flagged_segments: flagged,
      created_at: new Date().toISOString(),
    };
  }
}
