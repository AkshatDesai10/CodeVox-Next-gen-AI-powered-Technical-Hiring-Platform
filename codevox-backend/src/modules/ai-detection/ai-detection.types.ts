/** Normalized AI text-detection result (DeepFlag + local transformer providers). */
export interface AiTextDetectionResult {
  id?: string;
  content_type?: string;
  verdict?: string;
  confidence?: number;
  scores?: {
    ai_probability?: number;
    human_probability?: number;
  };
  analysis?: {
    perplexity?: number;
    burstiness?: number;
    entropy?: number;
    classifier_score?: number;
  };
  flagged_segments?: unknown[];
  created_at?: string;
}

/** @deprecated Use AiTextDetectionResult */
export type DeepFlagDetectionResult = AiTextDetectionResult;

export type AiContentDetectionProvider = 'deepflag' | 'transformer';
export type AiTransformerModel = 'roberta' | 'deberta';
