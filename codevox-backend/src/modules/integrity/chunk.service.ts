import { Injectable } from '@nestjs/common';
import type { DocumentChunk } from './integrity.types';

function countTokens(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return parts?.map((p) => p.trim()).filter(Boolean) ?? [text];
}

@Injectable()
export class ChunkService {
  chunkDocument(text: string, chunkSize = 250, overlap = 50): DocumentChunk[] {
    const normalized = text.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const paragraphs = normalized.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
    const rawChunks: Array<{ text: string; start: number; end: number }> = [];

    let cursor = 0;
    for (const paragraph of paragraphs) {
      const start = normalized.indexOf(paragraph, cursor);
      const end = start + paragraph.length;
      cursor = end;

      const tokens = countTokens(paragraph);
      if (tokens <= chunkSize) {
        rawChunks.push({ text: paragraph, start, end });
        continue;
      }

      for (const sentence of splitSentences(paragraph)) {
        const sStart = normalized.indexOf(sentence, start);
        const sEnd = sStart + sentence.length;
        const sTokens = countTokens(sentence);
        if (sTokens <= chunkSize) {
          rawChunks.push({ text: sentence, start: sStart, end: sEnd });
        } else {
          rawChunks.push(...this.splitByTokenWindow(normalized, sentence, sStart, chunkSize));
        }
      }
    }

    if (!rawChunks.length) {
      rawChunks.push({ text: normalized, start: 0, end: normalized.length });
    }

    return this.applyOverlap(rawChunks, overlap, chunkSize);
  }

  private splitByTokenWindow(
    fullText: string,
    segment: string,
    baseOffset: number,
    chunkSize: number,
  ): Array<{ text: string; start: number; end: number }> {
    const words = segment.split(/\s+/).filter(Boolean);
    const out: Array<{ text: string; start: number; end: number }> = [];
    let i = 0;
    while (i < words.length) {
      const slice = words.slice(i, i + chunkSize);
      const chunkText = slice.join(' ');
      const relStart = segment.indexOf(chunkText, i > 0 ? segment.indexOf(words[i]!) : 0);
      const start = baseOffset + Math.max(0, relStart);
      const end = start + chunkText.length;
      out.push({ text: chunkText, start, end });
      if (i + chunkSize >= words.length) break;
      i += chunkSize;
    }
    return out;
  }

  private applyOverlap(
    parts: Array<{ text: string; start: number; end: number }>,
    overlap: number,
    chunkSize: number,
  ): DocumentChunk[] {
    if (!parts.length) return [];

    const merged: Array<{ text: string; start: number; end: number }> = [];
    let buffer = '';
    let bufStart = parts[0]!.start;
    let bufEnd = parts[0]!.end;

    const flush = () => {
      if (!buffer.trim()) return;
      merged.push({ text: buffer.trim(), start: bufStart, end: bufEnd });
      buffer = '';
    };

    for (const part of parts) {
      const candidate = buffer ? `${buffer} ${part.text}` : part.text;
      if (countTokens(candidate) <= chunkSize) {
        buffer = candidate.trim();
        bufEnd = part.end;
        if (!buffer) bufStart = part.start;
        continue;
      }
      flush();
      buffer = part.text;
      bufStart = part.start;
      bufEnd = part.end;
    }
    flush();

    const withOverlap: DocumentChunk[] = [];
    for (let i = 0; i < merged.length; i += 1) {
      const current = merged[i]!;
      let text = current.text;
      let start = current.start;
      if (i > 0 && overlap > 0) {
        const prevWords = merged[i - 1]!.text.split(/\s+/).filter(Boolean);
        const tail = prevWords.slice(-overlap).join(' ');
        if (tail) {
          text = `${tail} ${current.text}`.trim();
          const idx = current.text.indexOf(current.text.split(/\s+/).filter(Boolean)[0] ?? '');
          start = Math.max(0, current.start - tail.length - (idx > 0 ? 1 : 0));
        }
      }
      withOverlap.push({
        id: `chunk-${i}`,
        text,
        startOffset: start,
        endOffset: current.end,
        index: i,
        tokenCount: countTokens(text),
      });
    }
    return withOverlap;
  }
}
