import { recruitmentApiBase } from '@/lib/recruitment-api-base';

export type NetworkReadinessStatus = 'good' | 'fair' | 'poor';

export type NetworkReadinessResult = {
  status: NetworkReadinessStatus;
  /** Average round-trip latency in ms (null if offline / failed). */
  pingMs: number | null;
  /** RFC 3550-style mean absolute consecutive RTT variation in ms. */
  jitterMs: number | null;
  /** Measured upload throughput in Mbps (null if failed). */
  uploadMbps: number | null;
  reason: string;
};

const PING_COUNT = 3;
const UPLOAD_BYTES = 200 * 1024; // ~200 KB

const THRESHOLDS = {
  good: { pingMs: 150, jitterMs: 30, uploadMbps: 1.0 },
  fair: { pingMs: 300, jitterMs: 60, uploadMbps: 0.5 },
} as const;

function defaultPingUrl() {
  return `${recruitmentApiBase()}/api/network-check/ping`;
}

function defaultUploadUrl() {
  return `${recruitmentApiBase()}/api/network-check/upload`;
}

function classify(
  pingMs: number | null,
  jitterMs: number | null,
  uploadMbps: number | null,
): Pick<NetworkReadinessResult, 'status' | 'reason'> {
  if (pingMs == null || jitterMs == null || uploadMbps == null) {
    return {
      status: 'poor',
      reason: 'Network test failed. Check your connection and retry.',
    };
  }

  const poor =
    pingMs > THRESHOLDS.fair.pingMs ||
    jitterMs > THRESHOLDS.fair.jitterMs ||
    uploadMbps < THRESHOLDS.fair.uploadMbps;
  if (poor) {
    const parts: string[] = [];
    if (pingMs > THRESHOLDS.fair.pingMs) parts.push(`high ping (${Math.round(pingMs)} ms)`);
    if (jitterMs > THRESHOLDS.fair.jitterMs) {
      parts.push(`unstable jitter (${Math.round(jitterMs)} ms)`);
    }
    if (uploadMbps < THRESHOLDS.fair.uploadMbps) {
      parts.push(`slow upload (${uploadMbps.toFixed(2)} Mbps)`);
    }
    return {
      status: 'poor',
      reason: `Connection looks too weak (${parts.join(', ')}). Move closer to Wi‑Fi or switch networks.`,
    };
  }

  const fair =
    pingMs > THRESHOLDS.good.pingMs ||
    jitterMs > THRESHOLDS.good.jitterMs ||
    uploadMbps < THRESHOLDS.good.uploadMbps;
  if (fair) {
    return {
      status: 'fair',
      reason:
        'Connection is usable but not ideal. You can continue — close other video apps if possible.',
    };
  }

  return {
    status: 'good',
    reason: 'Connection looks healthy for a live assessment.',
  };
}

async function measureOnePing(pingUrl: string): Promise<number> {
  const url = `${pingUrl}${pingUrl.includes('?') ? '&' : '?'}t=${Date.now()}`;
  const started = performance.now();
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    credentials: 'omit',
  });
  const elapsed = performance.now() - started;
  if (!res.ok) throw new Error(`Ping failed (${res.status})`);
  // Drain body so connection can be reused cleanly.
  await res.arrayBuffer().catch(() => undefined);
  return elapsed;
}

/**
 * RFC 3550 interarrival jitter approximation using consecutive RTT samples:
 * mean of |rtt[i] - rtt[i-1]|.
 */
function computeJitterMs(rtts: number[]): number {
  if (rtts.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < rtts.length; i += 1) {
    sum += Math.abs(rtts[i] - rtts[i - 1]);
  }
  return sum / (rtts.length - 1);
}

async function measureUploadMbps(uploadUrl: string): Promise<number> {
  const payload = new Uint8Array(UPLOAD_BYTES);
  // Non-zero pattern so middleboxes don't over-compress empty buffers.
  for (let i = 0; i < payload.length; i += 256) {
    payload[i] = (i / 256) & 0xff;
  }
  const started = performance.now();
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: payload,
    cache: 'no-store',
    credentials: 'omit',
  });
  const elapsedMs = Math.max(1, performance.now() - started);
  if (!res.ok) throw new Error(`Upload failed (${res.status})`);
  await res.arrayBuffer().catch(() => undefined);
  const elapsedSec = elapsedMs / 1000;
  return (UPLOAD_BYTES * 8) / (elapsedSec * 1_000_000);
}

export async function checkNetworkReadiness(
  pingUrl = defaultPingUrl(),
  uploadUrl = defaultUploadUrl(),
): Promise<NetworkReadinessResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return {
      status: 'poor',
      pingMs: null,
      jitterMs: null,
      uploadMbps: null,
      reason: 'You appear to be offline. Reconnect to the internet and retry.',
    };
  }

  try {
    const rtts: number[] = [];
    for (let i = 0; i < PING_COUNT; i += 1) {
      rtts.push(await measureOnePing(pingUrl));
    }
    const pingMs = rtts.reduce((a, b) => a + b, 0) / rtts.length;
    const jitterMs = computeJitterMs(rtts);
    const uploadMbps = await measureUploadMbps(uploadUrl);
    const { status, reason } = classify(pingMs, jitterMs, uploadMbps);
    return {
      status,
      pingMs,
      jitterMs,
      uploadMbps,
      reason,
    };
  } catch {
    return {
      status: 'poor',
      pingMs: null,
      jitterMs: null,
      uploadMbps: null,
      reason: 'Could not reach the network check service. Retry in a moment.',
    };
  }
}

export function formatNetworkMetrics(result: NetworkReadinessResult): string {
  const ping =
    result.pingMs != null ? `${Math.round(result.pingMs)}ms` : '—';
  const jitter =
    result.jitterMs != null ? `${Math.round(result.jitterMs)}ms` : '—';
  const upload =
    result.uploadMbps != null ? `${result.uploadMbps.toFixed(1)} Mbps` : '—';
  return `Ping: ${ping} (Jitter: ${jitter}) • Upload: ${upload}`;
}
