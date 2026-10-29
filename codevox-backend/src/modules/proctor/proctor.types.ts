export type ProctorEventInput = {
  type: string;
  severity: 'info' | 'warning' | 'critical';
  payload?: Record<string, unknown>;
  client_ts?: number;
};

export type ProctorRoundStrikeSummary = {
  round_type: string | null;
  media_strikes: number;
  focus_strikes: number;
};

export type ProctorSummary = {
  total_events: number;
  by_type: Record<string, number>;
  critical_count: number;
  warning_count: number;
  last_event_at: string | null;
  fraud_risk_score?: number;
  /** Active-round scoped counters (authoritative for FE hydration). */
  current_round_type?: string | null;
  current_round_strikes?: ProctorRoundStrikeSummary;
  /** Session-lifetime totals (audit). */
  media_strike_count?: number;
  focus_strike_count?: number;
  terminated_by?: string | null;
  termination_reason?: string | null;
  pipeline_finished?: boolean;
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
