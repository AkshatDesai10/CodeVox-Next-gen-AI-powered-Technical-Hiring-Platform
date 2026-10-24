import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type IntegrityConfigValues = {
  semanticThreshold: number;
  lexicalThreshold: number;
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
  shingleSize: number;
};

@Injectable()
export class IntegrityConfigService {
  constructor(private readonly config: ConfigService) {}

  values(): IntegrityConfigValues {
    return {
      semanticThreshold: this.num('PLAGIARISM_SEMANTIC_THRESHOLD', 0.8),
      lexicalThreshold: this.num('PLAGIARISM_LEXICAL_THRESHOLD', 0.2),
      chunkSize: this.int('PLAGIARISM_CHUNK_SIZE', 250),
      chunkOverlap: this.int('PLAGIARISM_CHUNK_OVERLAP', 50),
      topK: this.int('PLAGIARISM_TOP_K', 5),
      shingleSize: this.int('PLAGIARISM_SHINGLE_SIZE', 5),
    };
  }

  private num(key: string, fallback: number): number {
    const raw = Number(this.config.get<string>(key) ?? fallback);
    return Number.isFinite(raw) ? raw : fallback;
  }

  private int(key: string, fallback: number): number {
    const raw = Number.parseInt(String(this.config.get<string>(key) ?? fallback), 10);
    return Number.isFinite(raw) ? raw : fallback;
  }
}
