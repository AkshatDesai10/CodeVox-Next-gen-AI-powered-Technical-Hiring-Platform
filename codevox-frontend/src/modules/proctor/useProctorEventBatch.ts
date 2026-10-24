'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { ProctorEventInput } from '@/modules/proctor/types';

const BATCH_INTERVAL_MS = 15_000;

export function useProctorEventBatch(
  postEvents: (events: ProctorEventInput[]) => Promise<unknown>,
  enabled: boolean,
) {
  const queueRef = useRef<ProctorEventInput[]>([]);
  const flushingRef = useRef(false);

  const flush = useCallback(async () => {
    if (flushingRef.current || !queueRef.current.length) return;
    flushingRef.current = true;
    const batch = queueRef.current.splice(0, queueRef.current.length);
    try {
      await postEvents(batch);
    } catch {
      queueRef.current.unshift(...batch);
    } finally {
      flushingRef.current = false;
    }
  }, [postEvents]);

  const enqueue = useCallback(
    (event: ProctorEventInput) => {
      queueRef.current.push(event);
      if (event.severity === 'critical') {
        void flush();
      }
    },
    [flush],
  );

  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      void flush();
    }, BATCH_INTERVAL_MS);
    return () => {
      clearInterval(id);
      void flush();
    };
  }, [enabled, flush]);

  return { enqueue, flush };
}
