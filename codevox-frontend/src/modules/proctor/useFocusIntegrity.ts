'use client';

import { useEffect, useRef } from 'react';
import type { ProctorEventInput } from '@/modules/proctor/types';

const DEBOUNCE_MS = 2000;

export function useFocusIntegrity(
  enabled: boolean,
  onEvent: (event: ProctorEventInput) => void,
) {
  const lastHiddenRef = useRef(0);
  const lastBlurRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const onVisibility = () => {
      if (document.hidden) {
        const now = Date.now();
        if (now - lastHiddenRef.current < DEBOUNCE_MS) return;
        lastHiddenRef.current = now;
        onEvent({
          type: 'tab_hidden',
          severity: 'warning',
          payload: { reason: 'visibilitychange' },
          client_ts: now,
        });
      }
    };

    const onBlur = () => {
      const now = Date.now();
      if (now - lastBlurRef.current < DEBOUNCE_MS) return;
      lastBlurRef.current = now;
      onEvent({
        type: 'window_blur',
        severity: 'warning',
        payload: { reason: 'blur' },
        client_ts: now,
      });
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
    };
  }, [enabled, onEvent]);
}
