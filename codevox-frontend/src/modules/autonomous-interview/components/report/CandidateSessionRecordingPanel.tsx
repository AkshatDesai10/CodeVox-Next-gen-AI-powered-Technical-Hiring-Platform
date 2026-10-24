'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type { InterviewRecording } from '@/modules/autonomous-interview/types/interview-report';
import { recruitmentApiBase } from '@/lib/recruitment-api-base';

type RecruiterBookmark = {
  elapsedLabel: string;
  timestampSeconds: number;
};

type Props = {
  recordingUrl?: string | null;
  recordings?: InterviewRecording[];
  sessionId?: string;
  bookmarks?: RecruiterBookmark[];
};

function formatStartTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function resolvePlaybackSrc(url: string | null | undefined): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/')) return `${recruitmentApiBase()}${trimmed}`;
  if (trimmed.startsWith('local-recordings/')) {
    return `${recruitmentApiBase()}/${trimmed}`;
  }
  if (trimmed.startsWith('local-uploads/')) {
    return `${recruitmentApiBase()}/${trimmed}`;
  }
  return trimmed;
}

function recordingLabel(r: InterviewRecording, index: number): string {
  if (r.label?.trim()) return r.label.trim();
  const phase =
    r.phase === 'build'
      ? 'Build'
      : r.phase === 'defend'
        ? 'Defend'
        : r.phase === 'screening'
          ? 'AI Screening'
          : 'Session';
  const kind = (r.kind ?? r.engine ?? '').toLowerCase();
  if (kind.includes('agent')) return `${phase} — Agent Voice`;
  if (kind.includes('user_video') || kind === 'camera') return `${phase} — Video Recording`;
  if (kind.includes('user') || kind.includes('candidate')) return `${phase} — Candidate Voice`;
  if (kind.includes('screen')) return `${phase} — Screen Share`;
  return `${phase} — Recording ${index + 1}`;
}

function isAudioRecording(r: InterviewRecording | null): boolean {
  if (!r) return false;
  if (r.mediaType === 'audio') return true;
  if (r.mediaType === 'video') return false;
  const kind = (r.kind ?? r.engine ?? '').toLowerCase();
  if (kind.includes('user_video') || kind === 'camera') return false;
  return kind.includes('audio') && !kind.includes('screen_share');
}

export function CandidateSessionRecordingPanel({
  recordingUrl,
  recordings,
  sessionId,
  bookmarks = [],
}: Props) {
  const playable = useMemo(
    () =>
      (recordings ?? [])
        .map((r) => ({ ...r, playbackUrl: resolvePlaybackSrc(r.playbackUrl) }))
        .filter((r) => r.playbackUrl),
    [recordings],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement | null>(null);

  const seekTo = (seconds: number) => {
    const el = mediaRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    void el.play().catch(() => undefined);
  };

  useEffect(() => {
    if (!playable.length) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !playable.some((r) => r.id === selectedId)) {
      setSelectedId(playable[0]!.id);
    }
  }, [playable, selectedId]);

  const selected = playable.find((r) => r.id === selectedId) ?? null;
  const activeUrl =
    selected?.playbackUrl ?? (playable.length ? null : resolvePlaybackSrc(recordingUrl));
  const audioOnly = isAudioRecording(selected);

  return (
    <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/60 p-space-xl shadow-sm flex flex-col justify-between space-y-space-md">
      <div className="space-y-space-md">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <span className="w-7 h-7 rounded-md bg-primary-container/10 text-primary border border-primary/20 flex items-center justify-center font-label-sm text-label-sm font-bold">
              REC
            </span>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-headline-md text-headline-md font-bold text-on-surface">
                  Candidate Session Recording
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 font-label-sm text-label-sm font-semibold">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                  Track clips
                </span>
              </div>
              <p className="font-body-sm text-body-sm text-on-surface-variant">
                Individual Build &amp; Defend tracks • merge later
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant/60 hover:bg-surface-bright text-on-surface-variant hover:text-on-surface font-label-md text-label-md transition-colors"
              title="Copy Timestamped Link"
            >
              <AssessmentMaterialIcon name="link" size={16} />
              <span>Share Clip</span>
            </button>
            {activeUrl && (
              <a
                href={activeUrl}
                download
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant/60 hover:bg-surface-bright text-on-surface-variant hover:text-on-surface font-label-md text-label-md transition-colors"
                title="Download raw recording"
              >
                <AssessmentMaterialIcon name="download" size={16} />
                <span>Download</span>
              </a>
            )}
          </div>
        </div>

        {playable.length > 0 ? (
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Session recordings">
            {playable.map((r, idx) => {
              const active = r.id === selectedId;
              return (
                <button
                  key={r.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedId(r.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-label-md text-label-md transition-colors ${
                    active
                      ? 'border-primary bg-primary text-on-primary'
                      : 'border-outline-variant/60 text-on-surface-variant hover:bg-surface-bright'
                  }`}
                >
                  <span className="font-semibold">{recordingLabel(r, idx)}</span>
                  <span className={active ? 'text-on-primary/80' : 'text-on-surface-variant/80'}>
                    {formatStartTime(r.startedAt)}
                  </span>
                  {r.status === 'recording' ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-rose-500" title="Still recording" />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}

        <div className="relative rounded-lg overflow-hidden bg-inverse-surface border border-outline-variant/60 aspect-video flex flex-col justify-between shadow-sm">
          {activeUrl ? (
            audioOnly ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/90 px-6">
                <AssessmentMaterialIcon name="graphic_eq" size={40} className="text-white/70" />
                <p className="font-body-sm text-body-sm text-white/80 text-center">
                  {selected ? recordingLabel(selected, 0) : 'Audio track'}
                </p>
                <audio
                  key={activeUrl}
                  ref={(el) => {
                    mediaRef.current = el;
                  }}
                  src={activeUrl}
                  controls
                  preload="auto"
                  {...({ referrerPolicy: 'no-referrer' } as any)}
                  className="w-full max-w-md"
                />
              </div>
            ) : (
              <video
                key={activeUrl}
                ref={(el) => {
                  mediaRef.current = el;
                }}
                src={activeUrl}
                controls
                preload="auto"
                {...({ referrerPolicy: 'no-referrer' } as any)}
                className="absolute inset-0 h-full w-full object-contain bg-black"
                controlsList="nodownload"
              />
            )
          ) : (
            <div className="absolute inset-0 flex items-center justify-center flex-col text-white p-4 text-center z-10 bg-black/80">
              <AssessmentMaterialIcon name="videocam_off" size={48} className="text-white/40 mb-2" />
              <p className="font-body-md text-body-md text-white/80">
                Session recording unavailable or processing
              </p>
            </div>
          )}

          {!activeUrl && (
            <>
              <div className="w-full h-full opacity-20 absolute inset-0 pointer-events-none bg-[radial-gradient(#4f46e5_1px,transparent_1px)] [background-size:16px_16px]"></div>
              <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-10 pointer-events-none">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-black/60 backdrop-blur-xs font-mono font-code-sm text-code-sm text-white/90 border border-white/10">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>REC
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded bg-black/50 backdrop-blur-xs font-mono font-code-sm text-code-sm text-white/80 border border-white/10">
                  Token: {sessionId?.substring(0, 8) || '#REC-000'}
                </span>
              </div>
            </>
          )}
        </div>

        {bookmarks.length > 0 ? (
          <div className="rounded-lg border border-outline-variant/60 bg-surface-bright/40 p-3">
            <h4 className="mb-2 font-label-md text-label-md font-bold text-on-surface">
              Recruiter Bookmarks
            </h4>
            <div className="flex flex-wrap gap-1.5">
              {bookmarks.map((b, idx) => (
                <button
                  key={`${b.timestampSeconds}-${idx}`}
                  type="button"
                  onClick={() => seekTo(b.timestampSeconds)}
                  className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-semibold text-rose-800 hover:bg-rose-100"
                  title={`Seek to ${b.elapsedLabel}`}
                >
                  🚩 {b.elapsedLabel}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
