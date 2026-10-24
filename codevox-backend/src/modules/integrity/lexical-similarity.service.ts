import { Injectable } from '@nestjs/common';
import { IntegrityConfigService } from './integrity.config';

export type LexicalOverlapResult = {
  overlapPct: number;
  intersectionSize: number;
  unionSize: number;
};

@Injectable()
export class LexicalSimilarityService {
  constructor(private readonly config: IntegrityConfigService) {}

  overlapPercent(source: string, target: string, shingleSize?: number): LexicalOverlapResult {
    const size = shingleSize ?? this.config.values().shingleSize;
    const a = this.shingles(source, size);
    const b = this.shingles(target, size);
    if (!a.size && !b.size) {
      return { overlapPct: 0, intersectionSize: 0, unionSize: 0 };
    }
    let intersection = 0;
    for (const shingle of a) {
      if (b.has(shingle)) intersection += 1;
    }
    const union = new Set([...a, ...b]).size || 1;
    return {
      overlapPct: intersection / union,
      intersectionSize: intersection,
      unionSize: union,
    };
  }

  normalize(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  tokenize(text: string): string[] {
    const normalized = this.normalize(text);
    return normalized ? normalized.split(' ') : [];
  }

  shingles(text: string, shingleSize: number): Set<string> {
    const tokens = this.tokenize(text);
    const out = new Set<string>();
    if (tokens.length < shingleSize) {
      if (tokens.length) out.add(tokens.join(' '));
      return out;
    }
    for (let i = 0; i <= tokens.length - shingleSize; i += 1) {
      out.add(tokens.slice(i, i + shingleSize).join(' '));
    }
    return out;
  }
}
