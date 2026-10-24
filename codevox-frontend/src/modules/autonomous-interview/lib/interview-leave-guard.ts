'use client';

import { useEffect, useRef } from 'react';

export type LeaveAttempt = 'close' | 'back';

const TRAP_KEY = '__interviewLeaveGuard';
/** Delay before the in-app guidance shows; only reached if the page survived the browser's leave prompt. */
const STAYED_DELAY_MS = 500;

let released = false;

/** Call right before an intentional navigation (end, portal redirect, phase hand-off) so it is not blocked. */
export function releaseInterviewLeaveGuard() {
  released = true;
}

function isTrapState(state: unknown) {
  return Boolean(state && typeof state === 'object' && (state as Record<string, unknown>)[TRAP_KEY]);
}

function pushTrap() {
  window.history.pushState({ ...(window.history.state ?? {}), [TRAP_KEY]: true }, '', window.location.href);
}

/**
 * While `active`, asks the browser to confirm closing / refreshing the tab and swallows the Back button.
 * `onBlocked` fires when the candidate stayed (after the browser prompt) or pressed Back, so the room can explain why.
 */
export function useInterviewLeaveGuard(active: boolean, onBlocked: (attempt: LeaveAttempt) => void) {
  const onBlockedRef = useRef(onBlocked);
  useEffect(() => {
    onBlockedRef.current = onBlocked;
  }, [onBlocked]);

  useEffect(() => {
    if (!active) return;
    let stayedTimer: number | undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (released) return;
      event.preventDefault();
      // Legacy browsers only show the prompt when returnValue is set; custom text is ignored everywhere.
      event.returnValue = '';
      window.clearTimeout(stayedTimer);
      stayedTimer = window.setTimeout(() => onBlockedRef.current('close'), STAYED_DELAY_MS);
    };

    const onPopState = (event: PopStateEvent) => {
      if (released || isTrapState(event.state)) return;
      pushTrap();
      onBlockedRef.current('back');
    };

    if (!isTrapState(window.history.state)) pushTrap();
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('popstate', onPopState);
    return () => {
      window.clearTimeout(stayedTimer);
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('popstate', onPopState);
    };
  }, [active]);
}
