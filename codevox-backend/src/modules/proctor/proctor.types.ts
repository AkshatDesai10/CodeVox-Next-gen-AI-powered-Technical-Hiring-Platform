export type ProctorEventInput = {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  payload?: Record<string, unknown>;
  client_ts?: number;
};

export type ProctorSummary = {
  total_events: number;
  by_type: Record<string, number>;
  critical_count: number;
  warning_count: number;
  last_event_at: string | null;
  fraud_risk_score?: number;
};

export type VoiceTurnTimingMeta = {
  speech_start_delay_ms?: number;
  utterance_duration_ms?: number;
  reply_latency_ms?: number;
  stt_confidence?: number;
  user_text?: string;
  turn_index?: number;
};

export function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

export function computeFraudRiskScore(summary: ProctorSummary): number {
  return Math.min(100, summary.critical_count * 3 + summary.warning_count);
}
