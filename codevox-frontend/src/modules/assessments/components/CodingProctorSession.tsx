'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
import {
  initCodingLiveKit,
  startCodingRecording,
  stopCodingLiveKit,
  type CodingLiveKitInit,
} from '@/lib/candidate-api';
import {
  connectLiveKitRoom,
  disconnectLiveKitRoom,
  reachableLiveKitUrl,
} from '@/modules/autonomous-interview/lib/livekit-session';
import { InterviewConfirmDialog } from '@/modules/autonomous-interview/components/InterviewConfirmDialog';
import { ScreenShareRequiredOverlay } from '@/modules/autonomous-interview/components/LiveKitConnectionBanner';
import { postInterviewProctorEvents } from '@/modules/autonomous-interview/lib/autonomous-interview-api';
import { useFocusIntegrity } from '@/modules/proctor/useFocusIntegrity';
import type { ProctorEventInput } from '@/modules/proctor/types';

export type CodingProctorSessionProps = {
  portalToken: string;
  /** When true, skip LiveKit (already submitted / grading). */
  disabled?: boolean;
  onForceSubmit: (reason: string) => void;
  children: (state: {
    ready: boolean;
    recording: boolean;
    sessionToken: string | null;
    mediaStrikeCount: number;
    focusStrikeCount: number;
    proctorAlert: string | null;
    dismissProctorAlert: () => void;
  }) => ReactNode;
};

export function CodingProctorSession({
  portalToken,
  disabled = false,
  onForceSubmit,
  children,
}: CodingProctorSessionProps) {
  const [gateOpen, setGateOpen] = useState(!disabled);
  const [gateBusy, setGateBusy] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [proctorConfig, setProctorConfig] = useState<CodingLiveKitInit['proctorConfig'] | null>(null);
  const [reshareRequired, setReshareRequired] = useState(false);
  const [reshareError, setReshareError] = useState<string | null>(null);
  const [mediaStrikeCount, setMediaStrikeCount] = useState(0);
  const [proctorAlert, setProctorAlert] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);
  const mediaStrikesRef = useRef(0);
  const terminatedRef = useRef(false);
  const onForceSubmitRef = useRef(onForceSubmit);
  onForceSubmitRef.current = onForceSubmit;
  const portalTokenRef = useRef(portalToken);
  portalTokenRef.current = portalToken;
  const sessionTokenRef = useRef<string | null>(null);

  const enableFocus =
    typeof proctorConfig?.enableFocusStrikes === 'boolean'
      ? proctorConfig.enableFocusStrikes
      : true;
  const maxFocus =
    typeof proctorConfig?.maxFocusStrikes === 'number' ? proctorConfig.maxFocusStrikes : 5;
  const autoFocus =
    typeof proctorConfig?.autoSubmitOnFocusStrike === 'boolean'
      ? proctorConfig.autoSubmitOnFocusStrike
      : true;
  const focusThreshold =
    typeof proctorConfig?.focusStrikeThresholdSeconds === 'number'
      ? proctorConfig.focusStrikeThresholdSeconds
      : 5;
  const enableMedia =
    typeof proctorConfig?.enableMediaStrikes === 'boolean'
      ? proctorConfig.enableMediaStrikes
      : true;
  const maxMedia =
    typeof proctorConfig?.maxMediaStrikes === 'number' ? proctorConfig.maxMediaStrikes : 5;
  const autoMedia =
    typeof proctorConfig?.autoSubmitOnMediaStrike === 'boolean'
      ? proctorConfig.autoSubmitOnMediaStrike
      : true;

  const postEvents = useCallback((events: ProctorEventInput[]) => {
    const tok = sessionTokenRef.current;
    if (!tok || !events.length) return;
    void postInterviewProctorEvents(tok, events).catch(() => undefined);
  }, []);

  const handleProctorEvent = useCallback(
    (event: ProctorEventInput) => {
      postEvents([
        {
          ...event,
          payload: {
            ...(event.payload ?? {}),
            round_type: 'coding',
          },
        },
      ]);
      if (event.severity === 'critical' || event.severity === 'warning') {
        setProctorAlert(`Integrity alert: ${event.type.replace(/_/g, ' ')}`);
      }
    },
    [postEvents],
  );

  const terminate = useCallback(
    (reason: string) => {
      if (terminatedRef.current) return;
      terminatedRef.current = true;
      postEvents([
        {
          type: 'focus_strike_terminated',
          severity: 'critical',
          client_ts: Date.now(),
          payload: { reason, round_type: 'coding' },
        },
      ]);
      void stopCodingLiveKit(portalTokenRef.current);
      onForceSubmitRef.current(reason);
    },
    [postEvents],
  );

  const focusStrikesRef = useRef(0);
  const {
    focusStrikeCount,
    hydrateFocusStrikes,
    resetFocusStrikes,
  } = useFocusIntegrity({
    enabled: ready && enableFocus && !disabled && !terminatedRef.current,
    thresholdSeconds: focusThreshold,
    onEvent: handleProctorEvent,
    onFocusStrike: ({ durationSeconds }) => {
      focusStrikesRef.current += 1;
      setProctorAlert(`Focus strike: browser tab/window away for ${durationSeconds}s`);
      if (enableFocus && autoFocus && focusStrikesRef.current >= maxFocus) {
        terminate('max_focus_strikes_exceeded');
      }
    },
  });

  useEffect(() => {
    if (ready) {
      resetFocusStrikes();
      hydrateFocusStrikes(0);
    }
  }, [ready, resetFocusStrikes, hydrateFocusStrikes]);

  const cleanupRoom = useCallback(async () => {
    const room = roomRef.current;
    roomRef.current = null;
    try {
      screenTrackRef.current?.stop();
    } catch {
      /* ignore */
    }
    screenTrackRef.current = null;
    if (room) {
      await disconnectLiveKitRoom(room).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    return () => {
      void cleanupRoom();
    };
  }, [cleanupRoom]);

  const publishScreenAndRecord = useCallback(
    async (room: Room, track: MediaStreamTrack, sessionTok: string) => {
      screenTrackRef.current = track;
      await room.localParticipant.publishTrack(track, {
        source: Track.Source.ScreenShare,
        name: 'screen',
      });

      const pub = [...room.localParticipant.trackPublications.values()].find(
        (p) => p.source === Track.Source.ScreenShare && p.trackSid,
      );
      const trackSid = pub?.trackSid;
      if (trackSid) {
        const res = await startCodingRecording(portalTokenRef.current, {
          track_id: trackSid,
          kind: 'screen_share',
        });
        if (res?.success && res.data?.recording) {
          setRecording(true);
        }
      }

      track.addEventListener('ended', () => {
        setRecording(false);
        setReshareRequired(true);
        if (enableMedia) {
          mediaStrikesRef.current += 1;
          setMediaStrikeCount(mediaStrikesRef.current);
          postEvents([
            {
              type: 'screen_share_dropped',
              severity: 'critical',
              client_ts: Date.now(),
              payload: {
                strike: mediaStrikesRef.current,
                round_type: 'coding',
                session: sessionTok,
              },
            },
          ]);
          if (autoMedia && mediaStrikesRef.current >= maxMedia) {
            terminate('max_media_strikes_exceeded');
          }
        }
      });
    },
    [autoMedia, enableMedia, maxMedia, postEvents, terminate],
  );

  const startSession = useCallback(
    async (screenTrack: MediaStreamTrack) => {
      const initRes = await initCodingLiveKit(portalTokenRef.current);
      if (!initRes?.success || !initRes.data?.livekitToken) {
        throw new Error(initRes?.message ?? 'Failed to start coding LiveKit session');
      }
      const data = initRes.data;
      setProctorConfig(data.proctorConfig ?? null);
      setSessionToken(data.sessionToken);
      sessionTokenRef.current = data.sessionToken;

      const wsUrl = reachableLiveKitUrl(data.livekitUrl);
      const room = await connectLiveKitRoom(wsUrl, data.livekitToken, { resilient: true });
      roomRef.current = room;

      room.on(RoomEvent.Disconnected, () => {
        if (!terminatedRef.current) {
          setReshareRequired(true);
          setRecording(false);
        }
      });

      await publishScreenAndRecord(room, screenTrack, data.sessionToken);
      setReady(true);
      setGateOpen(false);
    },
    [publishScreenAndRecord],
  );

  const handleConfirmScreenShare = useCallback(async () => {
    setGateBusy(true);
    setGateError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      } as DisplayMediaStreamOptions);
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        throw new DOMException('No screen was shared.', 'NotAllowedError');
      }
      if (document.documentElement.requestFullscreen) {
        try {
          await document.documentElement.requestFullscreen();
        } catch {
          /* ignore */
        }
      }
      await startSession(track);
    } catch (err) {
      const name = err instanceof DOMException || err instanceof Error ? err.name : '';
      setGateError(
        name === 'NotAllowedError' || name === 'AbortError'
          ? 'You must share your entire screen to continue the coding round.'
          : err instanceof Error
            ? err.message
            : 'You must share your entire screen to continue.',
      );
    } finally {
      setGateBusy(false);
    }
  }, [startSession]);

  const handleReshare = useCallback(async () => {
    setReshareError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        audio: false,
      } as DisplayMediaStreamOptions);
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((t) => t.stop());
        throw new DOMException('No screen was shared.', 'NotAllowedError');
      }
      const room = roomRef.current;
      if (!room || room.state !== ConnectionState.Connected) {
        await cleanupRoom();
        await startSession(track);
        setReshareRequired(false);
        return;
      }
      try {
        screenTrackRef.current?.stop();
      } catch {
        /* ignore */
      }
      await publishScreenAndRecord(room, track, sessionTokenRef.current ?? '');
      setReshareRequired(false);
    } catch (err) {
      setReshareError(
        err instanceof Error ? err.message : 'Screen share is required to continue.',
      );
    }
  }, [cleanupRoom, publishScreenAndRecord, startSession]);

  if (disabled) {
    return (
      <>
        {children({
          ready: true,
          recording: false,
          sessionToken: null,
          mediaStrikeCount: 0,
          focusStrikeCount: 0,
          proctorAlert: null,
          dismissProctorAlert: () => undefined,
        })}
      </>
    );
  }

  return (
    <>
      <InterviewConfirmDialog
        open={gateOpen && !ready}
        title="Screen share required"
        message={
          <p>
            This coding round is proctored. Share your entire screen to continue. Recording starts
            when you join, and a recruiter may monitor the session live.
          </p>
        }
        confirmLabel={gateBusy ? 'Starting…' : 'Share screen & start'}
        cancelLabel={null}
        confirmDisabled={gateBusy}
        error={gateError}
        onConfirm={() => void handleConfirmScreenShare()}
        onCancel={() => undefined}
      />

      {reshareRequired && ready ? (
        <ScreenShareRequiredOverlay
          onShare={() => void handleReshare()}
          error={reshareError}
        />
      ) : null}

      {children({
        ready,
        recording,
        sessionToken,
        mediaStrikeCount,
        focusStrikeCount,
        proctorAlert,
        dismissProctorAlert: () => setProctorAlert(null),
      })}
    </>
  );
}
