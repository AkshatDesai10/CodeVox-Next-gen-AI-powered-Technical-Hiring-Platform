import type { ProctorEventInput, VoiceTurnTimingMeta } from './proctor.types';

export type FraudHeuristicConfig = {
  aiCheatPauseMs: number;
  aiCheatMinWords: number;
};

export type TurnHistorySample = {
  turn_index: number;
  user_word_count: number;
  reply_latency_ms?: number;
};

const DISFLUENCY_RE = /\b(um+|uh+|er+|like|you know)\b/i;
const AI_STRUCTURE_RE =
  /\b(firstly|secondly|in conclusion|furthermore|moreover|it is important to note|to summarize)\b/i;

export function evaluatePauseThenFluent(
  meta: VoiceTurnTimingMeta,
  config: FraudHeuristicConfig,
): ProctorEventInput | null {
  const text = (meta.user_text ?? '').trim();
  if (!text) return null;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < config.aiCheatMinWords) return null;

  const pauseMs = meta.speech_start_delay_ms ?? 0;
  const durationMs = meta.utterance_duration_ms ?? 0;
  const wordsPerSec =
    durationMs > 0 ? words.length / (durationMs / 1000) : words.length;

  if (
    pauseMs >= config.aiCheatPauseMs &&
    wordsPerSec >= 2.2 &&
    !DISFLUENCY_RE.test(text)
  ) {
    return {
      type: 'pause_then_fluent_answer',
      severity: 'warning',
      payload: {
        pause_ms: pauseMs,
        words_per_sec: Number(wordsPerSec.toFixed(2)),
        word_count: words.length,
        turn_index: meta.turn_index,
      },
    };
  }
  return null;
}

export function evaluateAiStructuredAnswer(
  meta: VoiceTurnTimingMeta,
): ProctorEventInput | null {
  const text = (meta.user_text ?? '').trim();
  if (!text || text.split(/\s+/).length < 10) return null;

  const formalMarkers = (text.match(AI_STRUCTURE_RE) ?? []).length;
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 8);
  const uniformLength =
    sentences.length >= 2 &&
    sentences.every((s) => Math.abs(s.split(/\s+/).length - sentences[0].split(/\s+/).length) <= 3);

  if (formalMarkers >= 2 || (formalMarkers >= 1 && uniformLength)) {
    return {
      type: 'ai_assisted_answer_suspected',
      severity: 'warning',
      payload: {
        formal_markers: formalMarkers,
        uniform_sentences: uniformLength,
        turn_index: meta.turn_index,
      },
    };
  }
  return null;
}

export function evaluateAnswerCadence(
  history: TurnHistorySample[],
): ProctorEventInput | null {
  if (history.length < 3) return null;
  const recent = history.slice(-4);
  const latencies = recent
    .map((t) => t.reply_latency_ms)
    .filter((v): v is number => v != null && v > 0);
  const wordCounts = recent.map((t) => t.user_word_count).filter((w) => w > 0);
  if (latencies.length < 3 || wordCounts.length < 3) return null;

  const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
  const latencyVariance =
    latencies.reduce((sum, v) => sum + (v - avgLatency) ** 2, 0) / latencies.length;
  const avgWords = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;
  const wordVariance =
    wordCounts.reduce((sum, v) => sum + (v - avgWords) ** 2, 0) / wordCounts.length;

  if (latencyVariance < 40000 && wordVariance < 12 && avgWords >= 15) {
    return {
      type: 'answer_cadence_anomaly',
      severity: 'info',
      payload: {
        latency_variance: Math.round(latencyVariance),
        word_variance: Number(wordVariance.toFixed(2)),
        sample_size: recent.length,
      },
    };
  }
  return null;
}

export function evaluatePlaybackSuspected(
  meta: VoiceTurnTimingMeta,
): ProctorEventInput | null {
  const text = (meta.user_text ?? '').trim();
  const latency = meta.reply_latency_ms;
  if (latency == null || latency >= 200 || text.length < 40) return null;
  return {
    type: 'playback_suspected',
    severity: 'warning',
    payload: {
      reply_latency_ms: latency,
      user_text_length: text.length,
      turn_index: meta.turn_index,
    },
  };
}

export function evaluateRecruitmentFraudSignals(
  meta: VoiceTurnTimingMeta,
  history: TurnHistorySample[],
  config: FraudHeuristicConfig,
): ProctorEventInput[] {
  const events: ProctorEventInput[] = [];
  for (const evaluator of [
    () => evaluatePlaybackSuspected(meta),
    () => evaluatePauseThenFluent(meta, config),
    () => evaluateAiStructuredAnswer(meta),
    () => evaluateAnswerCadence(history),
  ]) {
    const event = evaluator();
    if (event) events.push(event);
  }
  return events;
}
