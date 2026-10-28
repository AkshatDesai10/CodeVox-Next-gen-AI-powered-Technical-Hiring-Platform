import fs from 'fs';
import path from 'path';

/** All uploaded objects live under this folder inside LOCAL_UPLOADS_DIR. */
export const UPLOADS_ROOT = 'uploads';

function localUploadsRoot(): string {
  const fromEnv = process.env.LOCAL_UPLOADS_DIR?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.join(process.cwd(), fromEnv);
  }
  return path.join(process.cwd(), 'local-uploads');
}

function publicApiBase(): string {
  return (
    process.env.PUBLIC_API_BASE_URL?.trim() ||
    `http://localhost:${process.env.PORT?.trim() || '4000'}`
  ).replace(/\/$/, '');
}

/** Public HTTP URL served by Nest static assets at `/local-uploads/`. */
export function buildLocalUploadUrl(key: string): string {
  const clean = ensureUnderUploads(key).replace(/^\/+/, '');
  return `${publicApiBase()}/local-uploads/${clean}`;
}

function diskPathForKey(key: string): string {
  const ensured = ensureUnderUploads(key);
  return path.join(localUploadsRoot(), ...ensured.split('/').filter(Boolean));
}

function ensureParentDir(filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.zip': 'application/zip',
    '.json': 'application/json',
    '.txt': 'text/plain',
    '.csv': 'text/csv',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.ogg': 'audio/ogg',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
  };
  return map[ext] ?? 'application/octet-stream';
}

export function normalizePrefix(prefix?: string | null): string {
  return (prefix?.trim() || UPLOADS_ROOT).replace(/^\/+|\/+$/g, '');
}

/** Join path segments under `uploads/` (idempotent if root already present). */
export function underUploads(...parts: Array<string | null | undefined>): string {
  const cleaned = parts
    .flatMap((part) => String(part ?? '').split('/'))
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part !== '.' && part !== '..');
  while (cleaned[0]?.toLowerCase() === UPLOADS_ROOT.toLowerCase()) {
    cleaned.shift();
  }
  return [UPLOADS_ROOT, ...cleaned].join('/');
}

/** Force any object key under the uploads folder. */
export function ensureUnderUploads(key: string): string {
  const trimmed = String(key || '')
    .trim()
    .replace(/^\/+/, '');
  if (!trimmed) return UPLOADS_ROOT;
  const lower = trimmed.toLowerCase();
  if (lower === UPLOADS_ROOT.toLowerCase() || lower.startsWith(`${UPLOADS_ROOT.toLowerCase()}/`)) {
    return trimmed.replace(/\/+$/g, '');
  }
  return underUploads(trimmed);
}

function parseLocalUploadLocation(
  input: string,
  defaultBucket: string,
): { bucket: string; key: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.toLowerCase().startsWith('local:///')) {
    const key = trimmed.slice('local:///'.length).replace(/^\/+/, '');
    return key ? { bucket: defaultBucket, key } : null;
  }
  if (trimmed.toLowerCase().startsWith('local://')) {
    const key = trimmed.slice('local://'.length).replace(/^\/+/, '');
    return key ? { bucket: defaultBucket, key } : null;
  }

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      let pathname = decodeURIComponent(url.pathname || '').replace(/^\/+/, '');
      if (pathname.startsWith('local-uploads/')) {
        pathname = pathname.slice('local-uploads/'.length);
      }
      if (pathname.startsWith('local-recordings/')) {
        return { bucket: defaultBucket, key: pathname };
      }
      if (pathname) return { bucket: defaultBucket, key: pathname.split('?')[0] ?? pathname };
      return null;
    }
  } catch {
    /* fall through */
  }

  if (trimmed.startsWith('/local-uploads/')) {
    const key = trimmed.slice('/local-uploads/'.length).replace(/^\/+/, '');
    return key ? { bucket: defaultBucket, key: key.split('?')[0] ?? key } : null;
  }
  if (trimmed.startsWith('local-uploads/')) {
    const key = trimmed.slice('local-uploads/'.length).replace(/^\/+/, '');
    return key ? { bucket: defaultBucket, key: key.split('?')[0] ?? key } : null;
  }

  return null;
}

/** Normalize storage locations (local upload URLs or bare keys). */
export function parseStorageLocation(
  storagePath: string,
  defaultBucket?: string,
): { bucket: string; key: string } | null {
  const input = decodeInput(storagePath);
  const bucketDefault = defaultBucket?.trim() || 'local-uploads';

  const local = parseLocalUploadLocation(input, bucketDefault);
  if (local) return local;

  // Bare object keys stored in DB
  const bareKey = input.replace(/^\/+/, '').trim();
  if (bareKey && !bareKey.includes('://') && bucketDefault) {
    return { bucket: bucketDefault, key: bareKey };
  }

  return null;
}

function decodeInput(storagePath: string): string {
  try {
    return decodeURIComponent(storagePath.trim());
  } catch {
    return storagePath.trim();
  }
}

/** Public `/local-uploads/...` URL (files served by Nest static assets). */
export async function resolveLocalDownloadUrl(params: {
  storagePath: string;
}): Promise<string> {
  const trimmed = params.storagePath?.trim() ?? '';
  if (!trimmed) return trimmed;

  if (/\/local-uploads\//i.test(trimmed) && /^https?:\/\//i.test(trimmed)) {
    return trimmed.split('?')[0] ?? trimmed;
  }
  if (/\/local-recordings\//i.test(trimmed) && /^https?:\/\//i.test(trimmed)) {
    return trimmed.split('?')[0] ?? trimmed;
  }

  const parsed = parseStorageLocation(trimmed);
  if (!parsed) {
    if (trimmed.startsWith('local-uploads/') || trimmed.startsWith('/local-uploads/')) {
      const key = trimmed.replace(/^\/?local-uploads\//, '');
      return buildLocalUploadUrl(key);
    }
    return trimmed;
  }

  if (parsed.key.startsWith('local-recordings/')) {
    return `${publicApiBase()}/${parsed.key.split('?')[0]}`;
  }

  return buildLocalUploadUrl(parsed.key.split('?')[0] ?? parsed.key);
}

/** Read object bytes from local disk. */
export async function downloadObjectBytes(params: {
  storagePath: string;
  region?: string | null;
  defaultBucket?: string;
}): Promise<{ buffer: Buffer; contentType: string } | null> {
  void params.region;
  const trimmed = params.storagePath?.trim() ?? '';
  if (!trimmed) return null;

  const parsed = parseStorageLocation(trimmed, params.defaultBucket);
  if (!parsed) return null;

  const keyOnly = (parsed.key.split('?')[0] ?? parsed.key).replace(/^\/+/, '');
  const filePath = diskPathForKey(keyOnly);

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  return {
    buffer,
    contentType: guessContentType(filePath),
  };
}

/** Write buffer under local-uploads and return the public URL. */
export async function uploadBuffer(params: {
  key: string;
  body: Buffer;
  contentType?: string;
  bucket?: string;
  region?: string | null;
}): Promise<string> {
  void params.bucket;
  void params.region;
  void params.contentType;

  const key = ensureUnderUploads(params.key);
  const filePath = diskPathForKey(key);
  ensureParentDir(filePath);
  fs.writeFileSync(filePath, params.body);

  return buildLocalUploadUrl(key);
}
