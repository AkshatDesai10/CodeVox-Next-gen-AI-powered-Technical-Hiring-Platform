'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProctorEventInput } from '@/modules/proctor/types';

export type FocusStrikeInfo = {
  durationSeconds: number;
  triggerReason: string;
};

export type UseFocusIntegrityOptions = {
  enabled: boolean;
  /** Grace before a departure becomes a focus strike (default 5s). */
  thresholdSeconds?: number;
  /** Soft telemetry for blur/hidden/fullscreen (observable only). */
  onEvent?: (event: ProctorEventInput) => void;
  onAwayStart?: (triggerReason: string) => void;
  onAwayEnd?: (info: { struck: boolean; durationSeconds: number }) => void;
  onFocusStrike?: (info: FocusStrikeInfo) => void;
};

export type UseFocusIntegrityResult = {
  isAway: boolean;
  /** Seconds remaining in grace countdown; null when not away or strike already registered. */
  secondsLeft: number | null;
  /** True after grace expired until candidate returns to fullscreen. */
  strikePendingAck: boolean;
  focusStrikeCount: number;
  returnToFullscreen: () => Promise<void>;
  hydrateFocusStrikes: (count: number) => void;
  resetFocusStrikes: () => void;
};

function readThreshold(fallback: number): number {
  const raw = process.env.NEXT_PUBLIC_FOCUS_STRIKE_THRESHOLD_SECONDS;
  const n = Number(raw);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return fallback;
}

/**
 * Coalesced away-session FSM: blur + visibilitychange + fullscreenchange
 * share one 5s timer so Alt+Tab does not triple-count.
 */
export function useFocusIntegrity(
  options: UseFocusIntegrityOptions,
): UseFocusIntegrityResult {
  const {
    enabled,
    thresholdSeconds: thresholdProp,
    onEvent,
    onAwayStart,
    onAwayEnd,
    onFocusStrike,
  } = options;

  const thresholdSeconds = thresholdProp ?? readThreshold(5);

  const [isAway, setIsAway] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [strikePendingAck, setStrikePendingAck] = useState(false);
  const [focusStrikeCount, setFocusStrikeCount] = useState(0);

  const isAwayRef = useRef(false);
  const struckThisAwayRef = useRef(false);
  const awayStartedAtRef = useRef<number | null>(null);
  const awayTriggerRef = useRef('unknown');
  const graceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const focusStrikesRef = useRef(0);

  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const onAwayStartRef = useRef(onAwayStart);
  onAwayStartRef.current = onAwayStart;
  const onAwayEndRef = useRef(onAwayEnd);
  onAwayEndRef.current = onAwayEnd;
  const onFocusStrikeRef = useRef(onFocusStrike);
  onFocusStrikeRef.current = onFocusStrike;
  const thresholdRef = useRef(thresholdSeconds);
  thresholdRef.current = thresholdSeconds;

  const clearTimers = useCallback(() => {
    if (graceTimerRef.current) {
      clearTimeout(graceTimerRef.current);
      graceTimerRef.current = null;
    }
    if (tickTimerRef.current) {
      clearInterval(tickTimerRef.current);
      tickTimerRef.current = null;
    }
  }, []);

  const endAwaySession = useCallback(
    (opts?: { fromReturnClick?: boolean }) => {
      if (!isAwayRef.current) return;
      const started = awayStartedAtRef.current ?? Date.now();
      const durationSeconds = Math.max(0, Math.round((Date.now() - started) / 1000));
      const struck = struckThisAwayRef.current;
      clearTimers();
      isAwayRef.current = false;
      awayStartedAtRef.current = null;
      struckThisAwayRef.current = false;
      setIsAway(false);
      setSecondsLeft(null);
      setStrikePendingAck(false);
      onAwayEndRef.current?.({ struck, durationSeconds });
      if (!struck && durationSeconds > 0) {
        onEventRef.current?.({
          type: 'focus_soft_return',
          severity: 'info',
          client_ts: Date.now(),
          payload: {
            duration_seconds: durationSeconds,
            trigger: awayTriggerRef.current,
            returned_via: opts?.fromReturnClick ? 'button' : 'auto',
            message: `Browser focus restored within ${thresholdRef.current}s grace (no strike)`,
          },
        });
      }
    },
    [clearTimers],
  );

  const registerStrike = useCallback(() => {
    if (struckThisAwayRef.current) return;
    struckThisAwayRef.current = true;
    const started = awayStartedAtRef.current ?? Date.now();
    const durationSeconds = Math.max(
      thresholdRef.current,
      Math.round((Date.now() - started) / 1000),
    );
    const triggerReason = awayTriggerRef.current;
    focusStrikesRef.current += 1;
    setFocusStrikeCount(focusStrikesRef.current);
    setSecondsLeft(0);
    setStrikePendingAck(true);
    onEventRef.current?.({
      type: 'focus_strike',
      severity: 'critical',
      client_ts: Date.now(),
      payload: {
        duration_seconds: durationSeconds,
        trigger: triggerReason,
        focus_strikes: focusStrikesRef.current,
        message: `Browser tab/window away for ${durationSeconds}s`,
      },
    });
    onFocusStrikeRef.current?.({ durationSeconds, triggerReason });
  }, []);

  const beginAwaySession = useCallback(
    (triggerReason: string) => {
      if (isAwayRef.current) return;
      isAwayRef.current = true;
      struckThisAwayRef.current = false;
      awayStartedAtRef.current = Date.now();
      awayTriggerRef.current = triggerReason;
      setIsAway(true);
      setStrikePendingAck(false);
      setSecondsLeft(thresholdRef.current);
      onAwayStartRef.current?.(triggerReason);

      onEventRef.current?.({
        type:
          triggerReason === 'fullscreenchange'
            ? 'fullscreen_exited'
            : triggerReason === 'visibilitychange'
              ? 'tab_hidden'
              : 'window_blur',
        severity: 'warning',
        client_ts: Date.now(),
        payload: {
          reason: triggerReason,
          message:
            triggerReason === 'fullscreenchange'
              ? 'Fullscreen display exited'
              : triggerReason === 'visibilitychange'
                ? 'Browser tab switched / hidden'
                : 'Browser window lost focus',
        },
      });

      clearTimers();
      const deadline = Date.now() + thresholdRef.current * 1000;
      tickTimerRef.current = setInterval(() => {
        const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        setSecondsLeft(left);
      }, 250);
      graceTimerRef.current = setTimeout(() => {
        registerStrike();
      }, thresholdRef.current * 1000);
    },
    [clearTimers, registerStrike],
  );

  const returnToFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      /* user gesture / browser policy may block; still clear away state */
    }
    endAwaySession({ fromReturnClick: true });
  }, [endAwaySession]);

  const hydrateFocusStrikes = useCallback((count: number) => {
    const safe = Math.max(0, Math.floor(count));
    focusStrikesRef.current = safe;
    setFocusStrikeCount(safe);
  }, []);

  const resetFocusStrikes = useCallback(() => {
    focusStrikesRef.current = 0;
    setFocusStrikeCount(0);
  }, []);

  useEffect(() => {
    if (!enabled) {
      clearTimers();
      isAwayRef.current = false;
      setIsAway(false);
      setSecondsLeft(null);
      setStrikePendingAck(false);
      return;
    }

    const onVisibility = () => {
      if (document.hidden) {
        beginAwaySession('visibilitychange');
      } else if (isAwayRef.current && !struckThisAwayRef.current && document.fullscreenElement) {
        endAwaySession();
      }
    };

    const onBlur = () => {
      // Ignore blur while still visible in the same tab (dev tools, etc. still fire blur).
      if (document.hidden || !document.hasFocus()) {
        beginAwaySession('blur');
      }
    };

    const onFocus = () => {
      if (
        isAwayRef.current &&
        !struckThisAwayRef.current &&
        !document.hidden &&
        document.fullscreenElement
      ) {
        endAwaySession();
      }
    };

    const onFullscreen = () => {
      if (!document.fullscreenElement) {
        beginAwaySession('fullscreenchange');
      } else if (isAwayRef.current && !struckThisAwayRef.current && !document.hidden) {
        endAwaySession();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('fullscreenchange', onFullscreen);

    return () => {
      clearTimers();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('fullscreenchange', onFullscreen);
    };
  }, [enabled, beginAwaySession, endAwaySession, clearTimers]);

  return {
    isAway,
    secondsLeft,
    strikePendingAck,
    focusStrikeCount,
    returnToFullscreen,
    hydrateFocusStrikes,
    resetFocusStrikes,
  };
}
