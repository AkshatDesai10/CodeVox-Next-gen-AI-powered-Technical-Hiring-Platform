import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiContentDetectionProvider, AiTextDetectionResult } from './ai-detection.types';
import { DeepFlagClient } from './deepflag.client';
import { TransformerDetectionClient } from './transformer-detection.client';

@Injectable()
export class AiContentDetectionService implements OnModuleInit {
  private readonly log = new Logger(AiContentDetectionService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly deepflag: DeepFlagClient,
    private readonly transformer: TransformerDetectionClient,
  ) {}

  onModuleInit(): void {
    const provider = this.provider();
    if (provider === 'transformer') {
      const { modelId, runtime, modelKey } = this.transformer.describeConfig();
      this.log.log(
        `AI content detection: transformer/${modelKey} (${modelId}, ${runtime === 'onnx' ? 'fast ONNX' : 'Python'})`,
      );
      return;
    }
    this.log.log('AI content detection: deepflag API');
  }

  provider(): AiContentDetectionProvider {
    const raw = (this.config.get<string>('AI_CONTENT_DETECTION_PROVIDER') ?? 'deepflag')
      .trim()
      .toLowerCase();
    return raw === 'transformer' ? 'transformer' : 'deepflag';
  }

  async detectText(text: string): Promise<AiTextDetectionResult> {
    const provider = this.provider();
    if (provider === 'transformer') {
      this.log.debug('Running local transformer AI detection');
      return this.transformer.detectText(text);
    }
    this.log.debug('Running DeepFlag AI detection');
    return this.deepflag.detectText(text);
  }
}
