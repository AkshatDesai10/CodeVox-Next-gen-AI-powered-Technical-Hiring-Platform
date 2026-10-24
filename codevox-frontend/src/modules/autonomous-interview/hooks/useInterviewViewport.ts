'use client';

import { useEffect, useRef, useState } from 'react';
import { viewportWsUrl } from '@/modules/autonomous-interview/lib/autonomous-interview-api';

export type ViewportShiftEvent = {
  type: 'VIEWPORT_SHIFT';
  phase: string;
  payload?: Record<string, unknown>;
};

/** Map internal voice-engine / legacy phase names to viewport UI phases. */
export function normalizeViewportPhase(phase: string | null | undefined): string {
  if (!phase || phase === 'unified' || phase === 'intro_verbal') return 'ai_verbal';
  return phase;
}

export type ChatUpdateEvent = {
  type: 'CHAT_UPDATE';
  payload: {
    chatHistory: { role: string; content: string }[];
    phase?: string;
    currentPhase?: string;
    subPhase?: string;
  };
};

export type ProctorAlertEvent = {
  type: 'PROCTOR_ALERT';
  payload?: {
    message?: string;
    eventType?: string;
  };
};

export function useInterviewViewport(candidateToken: string) {
  const [phase, setPhase] = useState<string | null>(null);
  const [payload, setPayload] = useState<Record<string, unknown> | undefined>();
  const [chatHistory, setChatHistory] = useState<{ role: string; content: string }[]>([]);
  const [subPhase, setSubPhase] = useState<string | null>(null);
  const [proctorAlert, setProctorAlert] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!candidateToken) return;

    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let ws: WebSocket | null = null;

    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(String(event.data)) as
          | ViewportShiftEvent
          | ChatUpdateEvent
          | ProctorAlertEvent;

        if (data.type === 'VIEWPORT_SHIFT') {
          setPhase(normalizeViewportPhase(data.phase));
          setPayload(data.payload);
          const sp = data.payload?.subPhase;
          if (typeof sp === 'string') setSubPhase(sp);
        }
        if (data.type === 'CHAT_UPDATE' && data.payload?.chatHistory) {
          setChatHistory(data.payload.chatHistory);
          const cp = data.payload.currentPhase;
          const syncPhase = data.payload.phase;
          // Dedicated HR rounds: engine reports hr_verbal — keep viewport aligned.
          if (syncPhase === 'hr_verbal') {
            setPhase((current) =>
              current === 'assessing' || current === 'completed'
                ? current
                : normalizeViewportPhase(syncPhase),
            );
            if (data.payload.subPhase) setSubPhase(data.payload.subPhase);
          } else if (syncPhase === 'ai_screening' || data.payload.subPhase === 'transition') {
            // Merged screening→verbal: reflect screening / transition while Nest may already be ai_verbal.
            if (syncPhase) {
              setPhase((current) =>
                current === 'assessing' || current === 'completed'
                  ? current
                  : normalizeViewportPhase(syncPhase),
              );
            }
            if (data.payload.subPhase) setSubPhase(data.payload.subPhase);
          } else {
            const isDedicatedRound =
              cp === 'bnd_interview' ||
              cp === 'bnd_assessment' ||
              cp === 'ai_screening' ||
              cp === 'ai_verbal' ||
              cp === 'closing' ||
              cp === 'completed' ||
              cp === 'assessing';
            if (!isDedicatedRound) {
              if (syncPhase) {
                setPhase((current) =>
                  current === 'assessing' || current === 'completed'
                    ? current
                    : normalizeViewportPhase(syncPhase),
                );
              }
              if (data.payload.subPhase) setSubPhase(data.payload.subPhase);
            }
          }
        }
        if (data.type === 'PROCTOR_ALERT') {
          const p = data.payload;
          setProctorAlert(
            p?.message ??
              `Integrity alert: ${String(p?.eventType ?? 'unknown').replace(/_/g, ' ')}`,
          );
        }
      } catch {
        // ignore
      }
    };

    const connect = () => {
      if (disposed) return;
      ws = new WebSocket(viewportWsUrl());
      wsRef.current = ws;
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: 'join', token: candidateToken }));
      };
      ws.onmessage = handleMessage;
      ws.onclose = () => {
        wsRef.current = null;
        if (!disposed) {
          reconnectTimer = setTimeout(connect, 2000);
        }
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      wsRef.current = null;
    };
  }, [candidateToken]);

  return { phase, payload, setPhase, chatHistory, subPhase, proctorAlert, setProctorAlert };
}
