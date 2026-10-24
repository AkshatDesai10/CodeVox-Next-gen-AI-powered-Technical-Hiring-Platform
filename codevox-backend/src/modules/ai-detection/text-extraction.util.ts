import { BadRequestException } from '@nestjs/common';
import { doclingExtractionEnabled, extractViaDocling } from './docling-extractor.client';

/** Import the parser lib directly to avoid pdf-parse's debug side-effect on index import. */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as (
  data: Buffer,
) => Promise<{ text: string }>;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mammoth = require('mammoth') as {
  extractRawText: (input: { buffer: Buffer }) => Promise<{ value: string }>;
};

export type SupportedReportKind = 'pdf' | 'docx' | 'text';

const PDF_MIME = new Set(['application/pdf']);
const DOCX_MIME = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
]);
const TEXT_MIME = new Set([
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/octet-stream',
]);

function detectKind(
  mimeType: string | undefined,
  fileName: string | undefined,
): SupportedReportKind {
  const mime = (mimeType ?? '').toLowerCase();
  const name = (fileName ?? '').toLowerCase();
  if (PDF_MIME.has(mime) || name.endsWith('.pdf')) return 'pdf';
  if (
    DOCX_MIME.has(mime) ||
    name.endsWith('.docx') ||
    name.endsWith('.doc')
  )
    return 'docx';
  if (
    TEXT_MIME.has(mime) ||
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.csv')
  )
    return 'text';
  throw new BadRequestException(
    'Unsupported file type. Upload a PDF, Word (.docx), or plain text (.txt) report.',
  );
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function friendlyPdfError(message: string): string {
  if (/bad XRef|Invalid PDF|corrupted|xref/i.test(message)) {
    return 'The PDF appears corrupted or was not exported correctly. Re-save or re-export it as a standard PDF and try again.';
  }
  if (/password|encrypted/i.test(message)) {
    return 'The PDF is password-protected. Remove encryption and upload again.';
  }
  return message;
}

async function extractPdfWithPdfJs(buffer: Buffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    // Tolerate damaged / incremental-update PDFs that still have readable text.
    stopAtErrors: false,
  }).promise;

  const pages: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    try {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => ('str' in item && typeof item.str === 'string' ? item.str : ''))
        .join(' ');
      pages.push(pageText);
    } catch {
      // Skip unreadable pages; other pages may still yield enough text.
    }
  }
  await doc.destroy();
  return pages.join('\n\n');
}

async function extractPdfTextLocal(buffer: Buffer): Promise<string> {
  let primaryError: string | null = null;

  // Misnamed Word files (.docx uploaded as .pdf) start with ZIP magic "PK".
  if (buffer.length >= 2 && buffer[0] === 0x50 && buffer[1] === 0x4b) {
    try {
      const docxText = await extractDocxTextLocal(buffer);
      if (docxText.length >= 20) return docxText;
    } catch {
      // fall through to PDF parsers
    }
  }

  try {
    const parsed = await pdfParse(buffer);
    const text = normalizeWhitespace(parsed.text ?? '');
    if (text.length >= 20) return text;
    primaryError = 'Primary PDF parser returned too little text.';
  } catch (err) {
    primaryError = err instanceof Error ? err.message : String(err);
  }

  try {
    const fallback = normalizeWhitespace(await extractPdfWithPdfJs(buffer));
    if (fallback.length >= 20) return fallback;
    throw new Error('Fallback PDF parser returned too little text.');
  } catch (fallbackErr) {
    const fallbackMessage = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
    const combined = [primaryError, fallbackMessage].filter(Boolean).join(' | ');
    throw new Error(friendlyPdfError(combined));
  }
}

async function extractDocxTextLocal(buffer: Buffer): Promise<string> {
  const parsed = await mammoth.extractRawText({ buffer });
  return normalizeWhitespace(parsed.value ?? '');
}

async function extractWithDocling(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const text = await extractViaDocling(buffer, fileName, mimeType);
  return normalizeWhitespace(text);
}

/** Extracts readable text from an uploaded project report buffer. */
export async function extractReportText(
  file: Express.Multer.File,
): Promise<string> {
  const kind = detectKind(file.mimetype, file.originalname);
  const fileName = file.originalname ?? `upload.${kind === 'pdf' ? 'pdf' : kind === 'docx' ? 'docx' : 'txt'}`;
  const mimeType = file.mimetype ?? 'application/octet-stream';

  try {
    if (kind === 'text') {
      return normalizeWhitespace(file.buffer.toString('utf8'));
    }

    if (doclingExtractionEnabled() && (kind === 'pdf' || kind === 'docx')) {
      try {
        return await extractWithDocling(file.buffer, fileName, mimeType);
      } catch (doclingErr) {
        const message = doclingErr instanceof Error ? doclingErr.message : String(doclingErr);
        try {
          const local =
            kind === 'pdf'
              ? await extractPdfTextLocal(file.buffer)
              : await extractDocxTextLocal(file.buffer);
          if (local.length >= 20) return local;
        } catch {
          // fall through to combined error below
        }
        throw new BadRequestException(
          `Could not read the uploaded report: ${kind === 'pdf' ? friendlyPdfError(message) : message}`,
        );
      }
    }

    if (kind === 'pdf') {
      const text = await extractPdfTextLocal(file.buffer);
      if (text.length < 20) {
        throw new BadRequestException('Could not read the uploaded report: PDF contains too little text.');
      }
      return text;
    }

    const docxText = await extractDocxTextLocal(file.buffer);
    if (docxText.length < 20) {
      throw new BadRequestException('Could not read the uploaded report: Word file contains too little text.');
    }
    return docxText;
  } catch (err) {
    if (err instanceof BadRequestException) throw err;
    const message = err instanceof Error ? err.message : String(err);
    const friendly = kind === 'pdf' ? friendlyPdfError(message) : message;
    throw new BadRequestException(
      `Could not read the uploaded report: ${friendly}`,
    );
  }
}

/**
 * Splits long text into detection-sized chunks on paragraph/sentence
 * boundaries so the detector receives coherent passages.
 */
export function chunkText(
  text: string,
  maxChars = 6000,
  maxChunks = 20,
): string[] {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean ? [clean] : [];

  const paragraphs = clean.split(/\n{2,}/);
  const chunks: string[] = [];
  let current = '';

  const pushCurrent = () => {
    const trimmed = current.trim();
    if (trimmed) chunks.push(trimmed);
    current = '';
  };

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      pushCurrent();
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars));
      }
      continue;
    }
    if ((current + '\n\n' + para).length > maxChars) {
      pushCurrent();
    }
    current = current ? `${current}\n\n${para}` : para;
  }
  pushCurrent();

  return chunks.slice(0, maxChunks);
}
