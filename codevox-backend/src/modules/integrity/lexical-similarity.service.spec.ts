import { ConfigService } from '@nestjs/config';
import { IntegrityConfigService } from './integrity.config';
import { LexicalSimilarityService } from './lexical-similarity.service';

describe('LexicalSimilarityService', () => {
  const config = new IntegrityConfigService({
    get: (key: string) => {
      if (key === 'PLAGIARISM_SHINGLE_SIZE') return '5';
      return undefined;
    },
  } as unknown as ConfigService);
  const lexical = new LexicalSimilarityService(config);

  it('computes high overlap for near-identical passages', () => {
    const a =
      'Machine learning improves software engineering outcomes through better automation and quality.';
    const b =
      'Machine learning improves software engineering outcomes through better automation and quality assurance.';
    const result = lexical.overlapPercent(a, b, 5);
    expect(result.overlapPct).toBeGreaterThan(0.5);
  });

  it('computes low overlap for unrelated passages', () => {
    const a = 'Neural networks process visual patterns in medical imaging workflows.';
    const b = 'Campus placement drives require updated attendance and venue scheduling.';
    const result = lexical.overlapPercent(a, b, 5);
    expect(result.overlapPct).toBeLessThan(0.2);
  });

  it('builds 5-word shingles', () => {
    const shingles = lexical.shingles('one two three four five six seven', 5);
    expect(shingles.size).toBe(3);
    expect(shingles.has('one two three four five')).toBe(true);
    expect(shingles.has('two three four five six')).toBe(true);
  });
});
