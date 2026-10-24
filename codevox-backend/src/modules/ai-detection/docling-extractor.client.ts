const DEFAULT_URL = 'http://localhost:8011';
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_RETRIES = 8;
const DEFAULT_RETRY_DELAY_MS = 10_000;

export type DoclingExtractResponse = {
  text: string;
  chars?: number;
  file_name?: string;
};

function serviceUrl(): string {
  return (process.env.DOCLING_SERVICE_URL ?? DEFAULT_URL).trim().replace(/\/$/, '');
}

function timeoutMs(): number {
  const raw = Number(process.env.DOCLING_EXTRACTION_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function maxRetries(): number {
  const raw = Number(process.env.DOCLING_MAX_RETRIES ?? DEFAULT_RETRIES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETRIES;
}

function retryDelayMs(): number {
  const raw = Number(process.env.DOCLING_RETRY_DELAY_MS ?? DEFAULT_RETRY_DELAY_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RETRY_DELAY_MS;
}

export function doclingExtractionEnabled(): boolean {
  return (process.env.REPORT_TEXT_EXTRACTOR ?? 'docling').trim().toLowerCase() !== 'local';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function extractViaDocling(
  buffer: Buffer,
  fileName: string,
  mimeType: string,
): Promise<string> {
  const url = `${serviceUrl()}/extract`;
  const retries = maxRetries();
  const delayMs = retryDelayMs();

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(buffer)], { type: mimeType || 'application/octet-stream' }),
        fileName,
      );

      const response = await fetch(url, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(timeoutMs()),
      });

      const body = (await response.json().catch(() => ({}))) as DoclingExtractResponse & {
        detail?: string | { msg?: string };
      };

      if (response.status === 503 && attempt < retries) {
        await sleep(delayMs);
        continue;
      }

      if (!response.ok) {
        const detail =
          typeof body.detail === 'string'
            ? body.detail
            : body.detail?.msg
              ? String(body.detail.msg)
              : `Docling service HTTP ${response.status}`;
        throw new Error(detail);
      }

      const text = (body.text ?? '').trim();
      if (text.length < 20) {
        throw new Error('Docling returned too little text.');
      }
      return text;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const retryable = /still loading|503|ECONNREFUSED|fetch failed|aborted/i.test(message);
      if (retryable && attempt < retries) {
        await sleep(delayMs);
        continue;
      }
      throw new Error(
        `Docling extraction failed (${message}). Start: npm run docker:docling-extractor:up`,
      );
    }
  }

  throw new Error('Docling extraction failed after retries.');
}
