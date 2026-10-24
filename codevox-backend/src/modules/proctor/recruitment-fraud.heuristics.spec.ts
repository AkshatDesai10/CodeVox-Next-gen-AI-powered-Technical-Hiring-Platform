import {
  evaluatePauseThenFluent,
  evaluatePlaybackSuspected,
  evaluateRecruitmentFraudSignals,
} from './recruitment-fraud.heuristics';

describe('recruitment-fraud.heuristics', () => {
  const config = { aiCheatPauseMs: 2000, aiCheatMinWords: 10 };

  it('flags playback_suspected on fast long reply', () => {
    const event = evaluatePlaybackSuspected({
      user_text: 'a'.repeat(50),
      reply_latency_ms: 120,
      turn_index: 2,
    });
    expect(event?.type).toBe('playback_suspected');
  });

  it('flags pause_then_fluent_answer', () => {
    const event = evaluatePauseThenFluent(
      {
        user_text: 'This is a detailed answer about database indexing and query optimization in production.',
        speech_start_delay_ms: 3000,
        utterance_duration_ms: 2000,
        turn_index: 3,
      },
      config,
    );
    expect(event?.type).toBe('pause_then_fluent_answer');
  });

  it('aggregates recruitment fraud signals', () => {
    const events = evaluateRecruitmentFraudSignals(
      {
        user_text: 'Firstly, we used indexing. Secondly, we optimized queries. In conclusion, performance improved.',
        speech_start_delay_ms: 2800,
        utterance_duration_ms: 2200,
        reply_latency_ms: 150,
        turn_index: 4,
      },
      [
        { turn_index: 1, user_word_count: 20, reply_latency_ms: 180 },
        { turn_index: 2, user_word_count: 22, reply_latency_ms: 170 },
        { turn_index: 3, user_word_count: 21, reply_latency_ms: 175 },
      ],
      config,
    );
    expect(events.length).toBeGreaterThan(0);
  });
});
