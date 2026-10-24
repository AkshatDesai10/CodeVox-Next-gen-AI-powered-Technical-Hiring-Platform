export type DocumentChunk = {
  id: string;
  text: string;
  startOffset: number;
  endOffset: number;
  index: number;
  tokenCount: number;
};

export type VectorSearchHit = {
  chunkId: string;
  reportId: string;
  studentId: string;
  chunkIndex: number;
  chunkText: string;
  startOffset: number;
  endOffset: number;
  similarity: number;
};

export type MatchedChunkEvidence = {
  reportId: string;
  studentId: string;
  matchedFileName?: string;
  sourceChunk: string;
  targetChunk: string;
  semanticSimilarity: number;
  lexicalSimilarity: number;
  sourceOffsets: { start: number; end: number };
  targetOffsets: { start: number; end: number };
};

export type PlagiarismAnalysisResult = {
  plagiarismPct: number;
  lexicalCoveragePct: number;
  semanticSupportPct: number;
  compositePct: number;
  totalTokens: number;
  matchedCopiedTokens: number;
  matchedChunks: MatchedChunkEvidence[];
  excerpt: Record<string, unknown>;
};

export type VectorUpsertItem = {
  chunkId: string;
  reportId: string;
  studentId: string;
  chunkIndex: number;
  chunkText: string;
  startOffset: number;
  endOffset: number;
  embedding: number[];
};

export type VectorSearchExclude = {
  reportId?: string;
  studentId?: string;
};
