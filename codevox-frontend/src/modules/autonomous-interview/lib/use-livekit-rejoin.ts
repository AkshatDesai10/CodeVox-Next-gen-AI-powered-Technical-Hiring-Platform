'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionState, DisconnectReason, Room, RoomEvent } from 'livekit-client';
import {
  LIVEKIT_CONNECT_OPTIONS,
  describeDisconnectReason,
  shouldAutoRejoin,
} from '@/modules/autonomous-interview/lib/livekit-session';

/**
 * - `reconnecting`: livekit-client's built-in reconnect is running (media keeps flowing once it succeeds).
 * - `rejoining`: the built-in reconnect gave up; we fetch a fresh token and connect the same Room again.
 * - `stopped`: disconnected for a reason where auto-rejoin would be wrong (e.g. opened in another tab).
 */
export type LiveKitLinkState = 'connected' | 'reconnecting' | 'rejoining' | 'stopped';

export type LiveKitLinkInfo = {
  state: LiveKitLinkState;
  attempt: number;
  nextRetryAt: number | null;
  waitingForNetwork: boolean;
  lastError: string | null;
  stoppedReason: string | null;
};

export type LiveKitCredentials = { url: string; token: string };

export type LiveKitLinkLogger = (type: string, payload: Record<string, unknown>) => void;

type Options = {
  room: Room | null;
  /** Evaluated when a disconnect happens: false once the user left or the round is over. */
  shouldRejoin: () => boolean;
  /** Fresh credentials for the same room. Must never hit an endpoint that (re)starts an agent. */
  getCredentials: () => Promise<LiveKitCredentials>;
  /** Republish / resync after a successful rejoin. Failures here do not trigger another rejoin. */
  onRejoined?: (room: Room) => Promise<void> | void;
  log?: LiveKitLinkLogger;
};

const BACKOFF_START_MS = 2_000;
const BACKOFF_MAX_MS = 30_000;

const CONNECTED: LiveKitLinkInfo = {
  state: 'connected',
  attempt: 0,
  nextRetryAt: null,
  waitingForNetwork: false,
  lastError: null,
  stoppedReason: null,
};

export function useLiveKitRejoin({ room, shouldRejoin, getCredentials, onRejoined, log }: Options) {
  const [info, setInfo] = useState<LiveKitLinkInfo>(CONNECTED);

  const roomRef = useRef(room);
  roomRef.current = room;
  const shouldRejoinRef = useRef(shouldRejoin);
  shouldRejoinRef.current = shouldRejoin;
  const getCredentialsRef = useRef(getCredentials);
  getCredentialsRef.current = getCredentials;
  const onRejoinedRef = useRef(onRejoined);
  onRejoinedRef.current = onRejoined;
  const logRef = useRef(log);
  logRef.current = log;

  const inflightRef = useRef<Promise<void> | null>(null);
  const wakeRef = useRef<(() => void) | null>(null);

  const emit = useCallback((type: string, payload: Record<string, unknown> = {}) => {
    logRef.current?.(type, { ...payload, online: typeof navigator !== 'undefined' ? navigator.onLine : null });
  }, []);

  /** Resolves after `ms`, when the browser comes back online, or when "Reconnect now" is clicked. */
  const sleepOrWake = useCallback((ms: number | null) => {
    return new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        if (timer) clearTimeout(timer);
        window.removeEventListener('online', done);
        if (wakeRef.current === done) wakeRef.current = null;
        resolve();
      };
      if (ms != null) timer = setTimeout(done, ms);
      window.addEventListener('online', done);
      wakeRef.current = done;
    });
  }, []);

  const runRejoin = useCallback(
    (target: Room): Promise<void> => {
      if (inflightRef.current) return inflightRef.current;

      const active = () => shouldRejoinRef.current() && roomRef.current === target;

      const loop = async () => {
        let attempt = 0;
        while (active() && target.state !== ConnectionState.Connected) {
          attempt += 1;
          if (!navigator.onLine) {
            setInfo((prev) => ({
              ...prev,
              state: 'rejoining',
              attempt,
              waitingForNetwork: true,
              nextRetryAt: null,
              stoppedReason: null,
            }));
            emit('livekit_rejoin_waiting_network', { attempt });
            await sleepOrWake(null);
            if (!active()) return;
          }

          setInfo((prev) => ({
            ...prev,
            state: 'rejoining',
            attempt,
            waitingForNetwork: false,
            nextRetryAt: null,
            stoppedReason: null,
          }));
          emit('livekit_rejoin_attempt', { attempt });

          try {
            if (target.state === ConnectionState.Disconnected) {
              const creds = await getCredentialsRef.current();
              if (!active()) return;
              await target.connect(creds.url, creds.token, LIVEKIT_CONNECT_OPTIONS);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const delay = Math.min(BACKOFF_START_MS * 2 ** (attempt - 1), BACKOFF_MAX_MS);
            emit('livekit_rejoin_failed', { attempt, error: message, retry_in_ms: delay });
            setInfo((prev) => ({ ...prev, lastError: message, nextRetryAt: Date.now() + delay }));
            await sleepOrWake(delay);
            continue;
          }

          if ((target.state as ConnectionState) !== ConnectionState.Connected) continue;

          try {
            await onRejoinedRef.current?.(target);
          } catch (err) {
            emit('livekit_rejoin_republish_failed', {
              attempt,
              error: err instanceof Error ? err.message : String(err),
            });
          }
          emit('livekit_rejoin_success', { attempt });
          setInfo(CONNECTED);
          return;
        }
      };

      const promise = loop().finally(() => {
        inflightRef.current = null;
      });
      inflightRef.current = promise;
      return promise;
    },
    [emit, sleepOrWake],
  );

  const reconnectNow = useCallback(() => {
    const target = roomRef.current;
    if (!target) return;
    emit('livekit_rejoin_manual', {});
    if (inflightRef.current) {
      wakeRef.current?.();
      return;
    }
    if (target.state === ConnectionState.Disconnected) void runRejoin(target);
  }, [emit, runRejoin]);

  useEffect(() => {
    setInfo(CONNECTED);
    if (!room) return;

    const onReconnecting = () => {
      emit('livekit_reconnecting', { layer: 'media' });
      setInfo((prev) => (prev.state === 'rejoining' ? prev : { ...CONNECTED, state: 'reconnecting' }));
    };
    const onSignalReconnecting = () => {
      emit('livekit_reconnecting', { layer: 'signal' });
      setInfo((prev) => (prev.state === 'rejoining' ? prev : { ...CONNECTED, state: 'reconnecting' }));
    };
    const onReconnected = () => {
      emit('livekit_reconnected', {});
      setInfo(CONNECTED);
    };
    const onDisconnected = (reason?: DisconnectReason) => {
      const reasonName = describeDisconnectReason(reason);
      emit('livekit_disconnected', { reason: reasonName });
      if (!shouldRejoinRef.current()) return;
      // A failed rejoin attempt also emits Disconnected; the running loop owns the retry timing.
      if (inflightRef.current) return;
      if (!shouldAutoRejoin(reason)) {
        setInfo({ ...CONNECTED, state: 'stopped', stoppedReason: reasonName });
        return;
      }
      void runRejoin(room);
    };

    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.SignalReconnecting, onSignalReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.SignalReconnecting, onSignalReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      // Let a sleeping rejoin loop observe that this room is no longer current and exit.
      wakeRef.current?.();
    };
  }, [room, emit, runRejoin]);

  return { link: info, reconnectNow };
}
