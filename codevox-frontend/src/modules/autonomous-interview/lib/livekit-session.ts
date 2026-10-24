import {
  DisconnectReason,
  Room,
  VideoPresets,
  type AudioCaptureOptions,
  type RoomConnectOptions,
} from 'livekit-client';

const CONNECT_TIMEOUT_MS = 120_000;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1']);

function isPrivateHost(hostname: string): boolean {
  if (LOOPBACK_HOSTS.has(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  return false;
}

/**
 * Token URLs often embed a LAN address from LIVEKIT_PUBLIC_URL. That address goes stale
 * when the machine's IP changes, and the signal websocket then aborts. If the token host
 * is private, connect through the same host the page was opened on (port stays).
 */
export function reachableLiveKitUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (typeof window === 'undefined') return parsed.toString();
    const browserHost = window.location.hostname.trim();
    if (!browserHost || !isPrivateHost(parsed.hostname) || parsed.hostname === browserHost) {
      return parsed.toString();
    }
    parsed.hostname = browserHost;
    return parsed.toString();
  } catch {
    return url;
  }
}

export const LIVEKIT_CONNECT_OPTIONS: RoomConnectOptions = {
  autoSubscribe: true,
  peerConnectionTimeout: 30_000,
  maxRetries: 3,
};

const LEGACY_CONNECT_OPTIONS: RoomConnectOptions = {
  autoSubscribe: true,
  peerConnectionTimeout: 120_000,
  websocketTimeout: 60_000,
};

/**
 * Native browser processing for the published microphone.
 * Applied as room capture defaults so the first enable, a later unmute, and a rejoin
 * all use the same constraints. Voice isolation is `ideal` so browsers that do not
 * support it still open the microphone and keep noise suppression.
 */
export const CANDIDATE_MICROPHONE_CAPTURE: AudioCaptureOptions = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: { ideal: true },
};

/**
 * `resilient` rooms are for callers that handle reconnects via useLiveKitRejoin: they keep local
 * tracks alive across a dropped connection, so the caller must stop tracks it unpublishes itself.
 */
/** 360p camera capture — keeps CPU down on low-end laptops during Build & Defend. */
const CAMERA_CAPTURE_DEFAULTS = {
  videoCaptureDefaults: {
    resolution: VideoPresets.h360.resolution,
  },
};

export function createLiveKitRoom({ resilient = false }: { resilient?: boolean } = {}): Room {
  if (!resilient) {
    return new Room({
      ...CAMERA_CAPTURE_DEFAULTS,
      adaptiveStream: false,
      dynacast: false,
      disconnectOnPageLeave: false,
      audioCaptureDefaults: CANDIDATE_MICROPHONE_CAPTURE,
    });
  }
  return new Room({
    ...CAMERA_CAPTURE_DEFAULTS,
    adaptiveStream: true,
    dynacast: true,
    disconnectOnPageLeave: false,
    stopLocalTrackOnUnpublish: false,
    audioCaptureDefaults: CANDIDATE_MICROPHONE_CAPTURE,
    reconnectPolicy: {
      nextRetryDelayInMs: ({ retryCount }) =>
        retryCount < 10 ? Math.min(1000 * 2 ** retryCount, 10_000) : null,
    },
  });
}

export type ConnectLiveKitOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  resilient?: boolean;
};

export async function connectLiveKitRoom(
  wsUrl: string,
  token: string,
  options: ConnectLiveKitOptions = {},
): Promise<Room> {
  const { signal, timeoutMs = CONNECT_TIMEOUT_MS, resilient = false } = options;
  if (signal?.aborted) {
    throw new DOMException('LiveKit connect aborted', 'AbortError');
  }

  const room = createLiveKitRoom({ resilient });

  const connectPromise = room.connect(
    wsUrl,
    token,
    resilient ? LIVEKIT_CONNECT_OPTIONS : LEGACY_CONNECT_OPTIONS,
  );

  const abortConnect = () => {
    connectPromise
      .then(() => room.disconnect())
      .catch(() => room.disconnect())
      .catch(() => {});
  };
  signal?.addEventListener('abort', abortConnect, { once: true });

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('LiveKit connect timed out waiting for WebRTC')),
      timeoutMs,
    );
  });

  try {
    await Promise.race([connectPromise, timeoutPromise]);
    return room;
  } catch (err) {
    abortConnect();
    throw err;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortConnect);
  }
}

export async function disconnectLiveKitRoom(room: Room | null): Promise<void> {
  if (!room) return;
  // stopTracks=true: leaving for good must release camera / mic / screen capture.
  await room.disconnect(true).catch(() => {});
}

export function isRecoverableLiveKitError(message: string): boolean {
  return /pc connection|ice|webrtc|peer|failed to connect|timed out|websocket is already|connection.?timeout|tls/i.test(
    message,
  );
}

export function describeDisconnectReason(reason?: DisconnectReason): string {
  if (reason === undefined) return 'UNKNOWN';
  return DisconnectReason[reason] ?? String(reason);
}

/** Disconnects after which rejoining would be wrong: we left, another tab took over, or the room ended. */
export function shouldAutoRejoin(reason?: DisconnectReason): boolean {
  return (
    reason !== DisconnectReason.CLIENT_INITIATED &&
    reason !== DisconnectReason.DUPLICATE_IDENTITY &&
    reason !== DisconnectReason.PARTICIPANT_REMOVED &&
    reason !== DisconnectReason.ROOM_DELETED &&
    reason !== DisconnectReason.ROOM_CLOSED
  );
}
