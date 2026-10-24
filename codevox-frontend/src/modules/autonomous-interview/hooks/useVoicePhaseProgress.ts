'use client';

import { useEffect, useRef, useState } from 'react';
import type { VoicePhasePillId } from '@/modules/autonomous-interview/components/VoicePhasePillStrip';

const EXPECTED_SESSION_MS = 20 * 60 * 1000;
const ADVANCE_AFTER_ELAPSED_RATIO = 0.4;

type SpeakingState = 'speaking' | 'analyzing' | 'listening' | 'idle';

/**
 * Map backend phase / subPhase to Screening → Transition → Technical pills.
 * Dedicated HR rounds (hr_verbal) are optional and map to technical so the strip
 * still advances rather than inventing a behavioral pill.
 */
function mapBackendPhase(
  phase?: string | null,
  engine?: string | null,
): VoicePhasePillId | null {
  const p = String(phase ?? '').toLowerCase();
  const e = String(engine ?? '').toLowerCase();
  if (p === 'transition' || p === 'transition_bridge' || p.includes('bridge')) {
    return 'transition';
  }
  if (
    e === 'screening' ||
    p === 'ai_screening' ||
    p === 'screening' ||
    p.includes('screening')
  ) {
    return 'screening';
  }
  if (
    p === 'technical_deep_dive' ||
    p === 'technical_phase' ||
    p === 'ai_verbal' ||
    p === 'technical' ||
    e === 'technical' ||
    // Dedicated HR rounds: keep strip on technical (no behavioral pill in merge path).
    e === 'behavioral' ||
    p === 'hr_verbal' ||
    p.includes('behaviour') ||
    p.includes('behavior')
  ) {
    return 'technical';
  }
  return null;
}

/**
 * Drive the Screening → Transition → Technical pill strip from session state when
 * available; otherwise advance heuristically on Speaking→Analyzing after ~40% elapsed.
 */
export function useVoicePhaseProgress(opts: {
  visible: boolean;
  speakingState: SpeakingState;
  backendPhase?: string | null;
  backendEngine?: string | null;
}): VoicePhasePillId {
  const { visible, speakingState, backendPhase, backendEngine } = opts;
  const [pill, setPill] = useState<VoicePhasePillId>('screening');
  const sessionStartRef = useRef(Date.now());
  const prevSpeakingRef = useRef<SpeakingState>('idle');
  const advancedRef = useRef(0);

  useEffect(() => {
    if (!visible) return;
    sessionStartRef.current = Date.now();
    advancedRef.current = 0;
    setPill('screening');
  }, [visible]);

  useEffect(() => {
    const mapped = mapBackendPhase(backendPhase, backendEngine);
    if (mapped) {
      setPill(mapped);
      if (mapped === 'technical') advancedRef.current = 2;
      else if (mapped === 'transition') advancedRef.current = Math.max(advancedRef.current, 1);
      else if (mapped === 'screening') advancedRef.current = 0;
    }
  }, [backendPhase, backendEngine]);

  useEffect(() => {
    if (!visible) return;
    const prev = prevSpeakingRef.current;
    prevSpeakingRef.current = speakingState;

    if (prev === 'speaking' && speakingState === 'analyzing') {
      const elapsed = Date.now() - sessionStartRef.current;
      if (elapsed >= EXPECTED_SESSION_MS * ADVANCE_AFTER_ELAPSED_RATIO) {
        setPill((current) => {
          if (current === 'screening' && advancedRef.current < 1) {
            advancedRef.current = 1;
            return 'transition';
          }
          if (current === 'transition' && advancedRef.current < 2) {
            advancedRef.current = 2;
            return 'technical';
          }
          return current;
        });
      }
    }
  }, [speakingState, visible]);

  return pill;
}

export function resolveSpeakingState(input: {
  agentSpeaking?: boolean;
  analyzing?: boolean;
  listening?: boolean;
}): SpeakingState {
  if (input.agentSpeaking) return 'speaking';
  if (input.analyzing) return 'analyzing';
  if (input.listening) return 'listening';
  return 'idle';
}
