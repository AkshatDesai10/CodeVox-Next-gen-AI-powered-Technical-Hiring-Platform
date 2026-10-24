'use client';

import { useEffect, useState } from 'react';
import type { LiveKitLinkInfo } from '@/modules/autonomous-interview/lib/use-livekit-rejoin';

const STOPPED_MESSAGES: Record<string, string> = {
  DUPLICATE_IDENTITY: 'This session was opened in another tab or window.',
  PARTICIPANT_REMOVED: 'You were removed from the room.',
  ROOM_DELETED: 'The room was closed.',
  ROOM_CLOSED: 'The room was closed.',
};

function useSecondsUntil(target: number | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (target == null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [target]);
  if (target == null) return null;
  return Math.max(0, Math.ceil((target - now) / 1000));
}

/** Non-blocking status strip shown while the LiveKit connection is being recovered. */
export function LiveKitConnectionBanner({
  link,
  onReconnectNow,
}: {
  link: LiveKitLinkInfo;
  onReconnectNow: () => void;
}) {
  const secondsLeft = useSecondsUntil(link.state === 'rejoining' ? link.nextRetryAt : null);
  if (link.state === 'connected') return null;

  let message: string;
  let detail: string | null = null;
  if (link.state === 'reconnecting') {
    message = 'Connection lost, reconnecting…';
  } else if (link.state === 'stopped') {
    message = 'Disconnected from the room.';
    detail = (link.stoppedReason && STOPPED_MESSAGES[link.stoppedReason]) ?? null;
  } else if (link.waitingForNetwork) {
    message = 'You are offline. Reconnecting as soon as your network is back…';
    detail = link.attempt > 1 ? `Attempt ${link.attempt}` : null;
  } else {
    message = 'Connection lost, reconnecting…';
    detail =
      secondsLeft != null && secondsLeft > 0
        ? `Attempt ${link.attempt} failed · retrying in ${secondsLeft}s`
        : `Attempt ${link.attempt}`;
  }

  const showButton = link.state === 'rejoining' || link.state === 'stopped';

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-16 z-[120] flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-xl items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-950 shadow-lg">
        {link.state !== 'stopped' ? (
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-amber-400 border-t-amber-700" />
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="font-medium">{message}</p>
          {detail ? <p className="text-xs text-amber-800">{detail}</p> : null}
        </div>
        {/* Reconnect now button removed as requested */}
      </div>
    </div>
  );
}

/** Blocking prompt: getDisplayMedia needs a user gesture, so the candidate must click to re-share. */
export function ScreenShareRequiredOverlay({
  onShare,
  error,
}: {
  onShare: () => void;
  error: string | null;
}) {
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-[var(--assessment-surface-container)] p-6 text-center shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-900">Share your screen again to continue</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your screen share stopped while the connection was interrupted. Screen sharing is required
          for this round, so choose the screen or window to share when prompted.
        </p>
        {error ? <p className="mt-3 text-xs text-red-600">{error}</p> : null}
        <button
          type="button"
          className="mt-5 w-full rounded-lg bg-[var(--assessment-primary,#0b4f8a)] px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          onClick={onShare}
        >
          Share your screen again to continue
        </button>
      </div>
    </div>
  );
}
