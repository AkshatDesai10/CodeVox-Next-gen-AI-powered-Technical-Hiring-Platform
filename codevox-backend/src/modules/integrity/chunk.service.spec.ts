import { ChunkService } from './chunk.service';

describe('ChunkService', () => {
  const chunker = new ChunkService();

  it('splits on paragraph boundaries and tracks offsets', () => {
    const text = 'First paragraph with enough words to remain intact.\n\nSecond paragraph also stays as its own chunk when small enough.';
    const chunks = chunker.chunkDocument(text, 250, 50);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.startOffset).toBe(0);
    expect(chunks[0]!.text).toContain('First paragraph');
    for (const chunk of chunks) {
      expect(chunk.endOffset).toBeGreaterThan(chunk.startOffset);
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });

  it('does not split words when forced into token windows', () => {
    const words = Array.from({ length: 400 }, (_, i) => `word${i}`).join(' ');
    const chunks = chunker.chunkDocument(words, 100, 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text).not.toMatch(/\bword\d+wo\b/);
      expect(chunk.text.split(/\s+/).every((w) => /^word\d+$/.test(w))).toBe(true);
    }
  });

  it('applies overlap between consecutive chunks', () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) =>
      `Paragraph ${i} ${'token '.repeat(40)}`.trim(),
    ).join('\n\n');
    const chunks = chunker.chunkDocument(paragraphs, 80, 15);
    expect(chunks.length).toBeGreaterThan(1);
    const firstWords = chunks[0]!.text.split(/\s+/).slice(-5);
    const secondWords = chunks[1]!.text.split(/\s+/).slice(0, 10);
    const overlap = firstWords.some((w) => secondWords.includes(w));
    expect(overlap).toBe(true);
  });
});
