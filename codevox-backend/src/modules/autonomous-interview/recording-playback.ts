import { Logger } from '@nestjs/common';
import { existsSync } from 'fs';
import { join } from 'path';
import { resolveLocalDownloadUrl, parseStorageLocation } from '../../files/local-storage';

const logger = new Logger('RecordingPlayback');

export const RECORDING_PLAYBACK_EXPIRY_SECONDS = 3600;

const DEFAULT_INTERVIEW_RECORDING_PREFIX = 'uploads/interview-recordings';

/** Older local/legacy path prefixes. */
const LEGACY_RECORDING_PREFIXES = [
  'interview-recordings',
  'recordings',
  'viva-recordings',
];

export function interviewRecordingPrefix(): string {
  return (
    (process.env.RECORDING_PREFIX ?? process.env.RECORDING_S3_PREFIX ?? DEFAULT_INTERVIEW_RECORDING_PREFIX)
      .trim()
      .replace(/^\/+|\/+$/g, '') || DEFAULT_INTERVIEW_RECORDING_PREFIX
  );
}

function recognizedRecordingPrefixes(): string[] {
  const prefixes = [interviewRecordingPrefix(), ...LEGACY_RECORDING_PREFIXES];
  return [...new Set(prefixes)].sort((a, b) => b.length - a.length);
}

function recordingsDir(): string {
  return (
    process.env.LIVEKIT_LOCAL_RECORDINGS_DIR?.trim() ||
    join(process.cwd(), 'local-recordings')
  );
}

function publicApiBase(): string {
  return (
    process.env.PUBLIC_API_BASE_URL?.trim() ||
    `http://localhost:${process.env.PORT?.trim() || '4000'}`
  ).replace(/\/$/, '');
}

/** Always local filesystem. */
function isLocalRecordingMode(): boolean {
  return true;
}

/**
 * Map a DB storage key / URL onto a file under `local-recordings/`.
 * Egress writes `/out/{prefix}/...` which lands on disk as `local-recordings/{prefix}/...`.
 */
export function resolveLocalRecordingRelativePath(
  source: string | null | undefined,
): string | null {
  const trimmed = source?.trim();
  if (!trimmed) return null;

  let key = trimmed;
  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed);
      key = decodeURIComponent(url.pathname || '').replace(/^\/+/, '');
      if (key.startsWith('local-recordings/')) {
        key = key.slice('local-recordings/'.length);
      }
    }
  } catch {
    /* keep key as trimmed */
  }

  key = key.replace(/^\/+/, '');
  if (key.startsWith('out/')) key = key.slice('out/'.length);
  if (key.startsWith('local-recordings/')) key = key.slice('local-recordings/'.length);

  const prefixes = recognizedRecordingPrefixes();
  if (prefixes.some((prefix) => key.startsWith(`${prefix}/`))) {
    return key;
  }
  if (!key.includes('/')) {
    // Bare filename from legacy room-composite local mode.
    return key;
  }
  for (const prefix of prefixes) {
    const idx = key.indexOf(`${prefix}/`);
    if (idx >= 0) return key.slice(idx);
  }
  return key || null;
}

function localPlaybackUrl(relativePath: string): string {
  return `${publicApiBase()}/local-recordings/${relativePath.replace(/^\/+/, '')}`;
}

/**
 * Canonical storage URL stored in DB — local Nest `/local-recordings/` path.
 */
export function toRecordingStorageUrl(params: {
  key: string;
  bucket?: string | null;
  region?: string | null;
}): string {
  void params.bucket;
  void params.region;
  const key = params.key.replace(/^\/+/, '');
  if (key.startsWith('local-recordings/')) return key;
  return `local-recordings/${key}`;
}

/**
 * Local egress files → Nest `/local-recordings/`.
 * Upload-backed paths → `/local-uploads/` via shared storage helper.
 */
export async function toRecordingPlaybackUrl(
  source: string | null | undefined,
  expirySeconds = RECORDING_PLAYBACK_EXPIRY_SECONDS,
): Promise<string | null> {
  const trimmed = source?.trim();
  if (!trimmed) return null;

  if (trimmed.includes('/local-recordings/') || trimmed.startsWith('local-recordings/')) {
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    const rel = trimmed.replace(/^local-recordings\//, '');
    return localPlaybackUrl(rel);
  }

  const relative = resolveLocalRecordingRelativePath(trimmed);
  if (relative && isLocalRecordingMode()) {
    const abs = join(recordingsDir(), relative);
    if (
      existsSync(abs) ||
      recognizedRecordingPrefixes().some((prefix) => relative.startsWith(`${prefix}/`))
    ) {
      return localPlaybackUrl(relative);
    }
  }
  if (relative) {
    const abs = join(recordingsDir(), relative);
    if (existsSync(abs)) {
      return localPlaybackUrl(relative);
    }
  }

  // Fall through to local-uploads public URL for non-recording storage keys.
  void expirySeconds;
  const storagePath =
    parseStorageLocation(trimmed)?.key
      ? trimmed
      : relative
        ? toRecordingStorageUrl({ key: relative })
        : trimmed;

  try {
    return await resolveLocalDownloadUrl({ storagePath });
  } catch (err) {
    logger.warn(
      `Could not resolve recording URL (${err instanceof Error ? err.message : String(err)}); returning source`,
    );
    return trimmed;
  }
}

export type RecordingPhase = 'build' | 'defend' | 'screening' | 'verbal' | 'other';
export type RecordingKind =
  | 'agent_audio'
  | 'user_audio'
  | 'user_video'
  | 'screen_share'
  | 'screen_share_audio'
  | 'merged'
  | 'other';

/** Build camera video (user_video) — env-gated; default off. */
export function isBuildVideoRecordingEnabled(): boolean {
  const raw = (process.env.BUILD_VIDEO_RECORDING_ENABLED ?? 'false').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function detectRecordingPhase(
  storageKeyOrUrl: string | null | undefined,
  stageId?: string | null,
): RecordingPhase {
  const hay = `${storageKeyOrUrl ?? ''} ${stageId ?? ''}`.toLowerCase();
  if (hay.includes('ai_screening') || hay.includes('screening')) {
    return 'screening';
  }
  if (hay.includes('coding') || hay.includes('sandbox_code')) {
    return 'other';
  }
  if (
    hay.includes('bnd_assessment') ||
    hay.includes('bnd-assessment') ||
    hay.includes('bnd_build') ||
    hay.includes('bnd-build') ||
    hay.includes('in_build') ||
    hay.includes('in-build')
  ) {
    return 'build';
  }
  if (
    hay.includes('bnd_interview') ||
    hay.includes('project_interview') ||
    hay.includes('defend')
  ) {
    return 'defend';
  }
  if (
    hay.includes('ai_verbal') ||
    hay.includes('ai-verbal') ||
    hay.includes('intro_verbal') ||
    hay.includes('intro-verbal')
  ) {
    return 'verbal';
  }
  return 'other';
}

export function detectRecordingKind(engine: string | null | undefined): RecordingKind {
  const e = (engine ?? '').toLowerCase();
  if (e.includes('agent_audio') || e === 'agent') return 'agent_audio';
  if (e.includes('user_video') || e === 'camera') return 'user_video';
  if (e.includes('user_audio') || e === 'user' || e === 'candidate') return 'user_audio';
  if (e.includes('screen_share_audio')) return 'screen_share_audio';
  if (e.includes('screen_share') || e.includes('screen')) return 'screen_share';
  return 'other';
}

/** Parse kind from egress filename stem: `{ts}_{kind}` or legacy `{kind}_{ts}_{count}`. */
export function kindFromStorageKey(storageKey: string | null | undefined): string | null {
  const base = (storageKey ?? '').split('/').pop() ?? '';
  const stem = base.replace(/\.[a-z0-9]+$/i, '');
  if (!stem) return null;
  const kinds = [
    'agent_audio',
    'user_video',
    'user_audio',
    'screen_share_audio',
    'screen_share',
  ];
  for (const kind of kinds) {
    if (stem === kind || stem.endsWith(`_${kind}`) || stem.startsWith(`${kind}_`)) {
      return kind;
    }
  }
  return stem.replace(/_\d+_\d+$/, '').replace(/^\d+_/, '').slice(0, 32) || null;
}

export function recordingDisplayLabel(phase: RecordingPhase, kind: RecordingKind): string {
  const phaseLabel =
    phase === 'build'
      ? 'Build'
      : phase === 'defend'
        ? 'Defend'
        : phase === 'screening'
          ? 'AI Screening'
          : phase === 'verbal'
            ? 'AI Verbal'
            : 'Session';
  switch (kind) {
    case 'agent_audio':
      return `${phaseLabel} — Agent Voice`;
    case 'user_audio':
      return `${phaseLabel} — Candidate Voice`;
    case 'user_video':
      return `${phaseLabel} — Video Recording`;
    case 'screen_share':
      return `${phaseLabel} — Screen Share`;
    case 'screen_share_audio':
      return `${phaseLabel} — Screen Audio`;
    case 'merged':
      return `${phaseLabel} — Merged Recording`;
    default:
      return `${phaseLabel} — Recording`;
  }
}
