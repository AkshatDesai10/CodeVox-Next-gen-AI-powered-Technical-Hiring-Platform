import type { ConfigService } from '@nestjs/config';
import type { AiTransformerModel } from './ai-detection.types';
import { DEBERTA_INSTRUCT_MODEL_ID } from './deberta-instruct-detector.client';

export const ROBERTA_ONNX_MODEL_ID = 'nicoamoretti/roberta-openai-detector-onnx';

export type TransformerRuntime = 'onnx' | 'python';

export type ResolvedTransformerModel = {
  modelKey: AiTransformerModel;
  modelId: string;
  runtime: TransformerRuntime;
};

function isDebertaModelId(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === 'deberta'
    || normalized.includes('deberta-v3-instruct')
    || normalized.includes('1024m/deberta')
  );
}

/** Resolve local transformer model from env (`AI_TRANSFORMER_MODEL` or `AI_TRANSFORMER_MODEL_ID`). */
export function resolveTransformerModel(config: ConfigService): ResolvedTransformerModel {
  const override = config.get<string>('AI_TRANSFORMER_MODEL_ID')?.trim();
  if (override) {
    const deberta = isDebertaModelId(override);
    return {
      modelKey: deberta ? 'deberta' : 'roberta',
      modelId: override,
      runtime: deberta ? 'python' : 'onnx',
    };
  }

  const raw = (config.get<string>('AI_TRANSFORMER_MODEL') ?? 'roberta').trim().toLowerCase();
  const deberta = isDebertaModelId(raw);
  return {
    modelKey: deberta ? 'deberta' : 'roberta',
    modelId: deberta ? DEBERTA_INSTRUCT_MODEL_ID : ROBERTA_ONNX_MODEL_ID,
    runtime: deberta ? 'python' : 'onnx',
  };
}
