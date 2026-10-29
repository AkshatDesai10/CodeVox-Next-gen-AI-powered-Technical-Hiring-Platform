'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, Track, Participant } from 'livekit-client';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { getAutonomousSession } from '@/modules/autonomous-interview/lib/autonomous-interview-api';
import { useInterviewRoom } from '@/modules/autonomous-interview/context/InterviewRoomContext';
import { InterviewConfirmDialog } from '@/modules/autonomous-interview/components/InterviewConfirmDialog';
import {
  historyToChatMessages,
  InterviewLiveTranscript,
  type ChatMessage,
} from '@/modules/autonomous-interview/components/InterviewLiveTranscript';
import { postInterviewProctorEvents, forceCompleteAutonomous, leaveBuildWithoutSubmission } from '@/modules/autonomous-interview/lib/autonomous-interview-api';
import {
  getFocusStrikeThresholdSeconds,
  getMaxFocusStrikes,
  getMaxMediaStrikes,
  getMediaGraceSeconds,
  isAutoSubmitOnFocusStrikeEnabled,
  isAutoSubmitOnMediaStrikeEnabled,
  isFocusStrikesEnabled,
  isMediaStrikesEnabled,
} from '@/modules/autonomous-interview/lib/media-recovery';
import { useFocusIntegrity } from '@/modules/proctor/useFocusIntegrity';
import { useProctorEventBatch } from '@/modules/proctor/useProctorEventBatch';
import { useSessionProctor } from '@/modules/proctor/useSessionProctor';
import { BuildAssessmentSidePanel } from '@/modules/autonomous-interview/components/BuildAssessmentSidePanel';
import { FullscreenEnforcementModal } from '@/modules/autonomous-interview/components/FullscreenEnforcementModal';
import { getProjectInterviewSubmission } from '@/modules/assessments/lib/project-interview-api';

import { CircularAudioVisualizer } from '@/modules/autonomous-interview/components/CircularAudioVisualizer';
import { disconnectLiveKitRoom } from '@/modules/autonomous-interview/lib/livekit-session';
import { useInterviewLeaveGuard, releaseInterviewLeaveGuard, type LeaveAttempt } from '@/modules/autonomous-interview/lib/interview-leave-guard';
import type { ProctorEventInput } from '@/modules/proctor/types';

const NOTES_PREFIX = 'codevox-interview-notes:';

type Props = {
  onForceExit?: () => void;
  candidateToken: string;
  techStack: string;
  phase: 'ai_verbal' | 'hr_verbal' | 'closing' | 'bnd_assessment' | 'bnd_interview' | 'ai_screening';
  visible: boolean;
  compact?: boolean;
  /** Build & Defend Build LiveKit room UX. */
  buildMode?: boolean;
  /** Portal or submission token for Build assessment API. */
  buildLookupToken?: string | null;
  subPhase?: string | null;
  liveChatHistory?: { role: string; content: string }[];
  referenceFaceDescriptor?: number[] | null;
  proctorConfig?: {
    faceCheckIntervalMs: number;
    faceMatchThreshold: number;
    requireCameraForStart: boolean;
    requireVoiceEnroll?: boolean;
    enableMediaStrikes?: boolean;
    maxMediaStrikes?: number;
    autoSubmitOnMediaStrike?: boolean;
    enableFocusStrikes?: boolean;
    maxFocusStrikes?: number;
    autoSubmitOnFocusStrike?: boolean;
    focusStrikeThresholdSeconds?: number;
  };
  proctorWarning?: string | null;
  onProctorWarningDismiss?: () => void;
  onPhaseChange?: (phase: string) => void;
  /** True after the candidate grants screen share from the Start Round gate. */
  screenShareGranted?: boolean;
  setScreenShareGranted?: (granted: boolean) => void;
  setPreAcquiredScreenTrack?: (track: MediaStreamTrack | null) => void;
};

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function LiveKitVoiceStagePanel({
  candidateToken,
  techStack,
  phase,
  visible,
  compact = false,
  buildMode = false,
  buildLookupToken = null,
  subPhase,
  liveChatHistory = [],
  referenceFaceDescriptor = null,
  proctorConfig,
  proctorWarning = null,
  onProctorWarningDismiss,
  onForceExit,
  screenShareGranted = false,
  setScreenShareGranted,
  setPreAcquiredScreenTrack,
}: Props) {
  const {
    room,
    status,
    error,
    micEnabled,
    videoEnabled,
    screenShareEnabled,
    forceCamera,
    forceScreenShare,
    agentConnected,
    connectionState,
    screenReshareRequired,
    requireMic,
    mediaRecoveryRequired,
    mediaRecovery,
    proctorInterventionActive,
    toggleMic,
    toggleVideo,
    toggleScreenShare,
    endInterview,
    beginIntentionalExit,
    releaseIntentionalExit,
    publishProctorTelemetry,
  } = useInterviewRoom();
  const proctorInterventionRef = useRef(proctorInterventionActive);
  proctorInterventionRef.current = proctorInterventionActive;
  // While the link is recovering (or the re-share overlay is up) the regular share prompt stays closed.
  const canPromptScreenShare = connectionState === 'connected' && !screenReshareRequired;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const sessionStartRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState('00:00');
  const [introMaxTurns, setIntroMaxTurns] = useState(50);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [roomName, setRoomName] = useState('');
  const [candidateSpeaking, setCandidateSpeaking] = useState(false);
  const [hasSpokenThisTurn, setHasSpokenThisTurn] = useState(false);
  const [statusHint, setStatusHint] = useState(
    'Joining the interview room - allow microphone access when prompted.',
  );
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [leaveAttempt, setLeaveAttempt] = useState<LeaveAttempt | null>(null);
  const [screenShareDialogOpen, setScreenShareDialogOpen] = useState(false);
  const [screenShareGateError, setScreenShareGateError] = useState<string | null>(null);
  const [screenShareBusy, setScreenShareBusy] = useState(false);
  const [hasPromptedScreenShare, setHasPromptedScreenShare] = useState(false);
  const hadScreenShareRef = useRef(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [errorBannerDismissed, setErrorBannerDismissed] = useState(false);
  const [proctorAlert, setProctorAlert] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [buildDueAtMs, setBuildDueAtMs] = useState<number | null>(null);
  const focusTerminationStartedRef = useRef(false);
  const focusRoundKeyRef = useRef(`${buildMode ? 'build' : 'interview'}:${phase}`);

  const enableMediaStrikes =
    proctorConfig?.enableMediaStrikes ?? isMediaStrikesEnabled();
  const enableFocusStrikes =
    proctorConfig?.enableFocusStrikes ?? isFocusStrikesEnabled();
  const maxFocusStrikes =
    proctorConfig?.maxFocusStrikes ?? getMaxFocusStrikes();
  const focusThresholdSeconds =
    proctorConfig?.focusStrikeThresholdSeconds ?? getFocusStrikeThresholdSeconds();
  const autoSubmitFocus =
    proctorConfig?.autoSubmitOnFocusStrike ?? isAutoSubmitOnFocusStrikeEnabled();
  const autoSubmitMedia =
    proctorConfig?.autoSubmitOnMediaStrike ?? isAutoSubmitOnMediaStrikeEnabled();

  /** Interview is live and actively speaking / interacting */
  const isInterviewLive =
    agentConnected &&
    (status === 'live' || status === 'agent_speaking') &&
    (!forceScreenShare || screenShareGranted);

  /** Focus/fullscreen lockdown: Screening / Verbal / Defend — never Build. Active only when focus strikes enabled and interview is live. */
  const shouldEnforceIntegrity =
    visible &&
    !compact &&
    !buildMode &&
    enableFocusStrikes &&
    isInterviewLive &&
    (phase === 'ai_screening' ||
      phase === 'ai_verbal' ||
      phase === 'hr_verbal' ||
      phase === 'bnd_interview');

  const { enqueue } = useProctorEventBatch(
    (events: ProctorEventInput[]) => postInterviewProctorEvents(candidateToken, events),
    visible && !compact,
  );

  const handleProctorEvent = useCallback(
    (event: ProctorEventInput) => {
      if (proctorInterventionRef.current && event.type === 'extra_voice_suspected') {
        return;
      }
      const withRound: ProctorEventInput = {
        ...event,
        payload: {
          ...(event.payload ?? {}),
          phase,
          round_type:
            (event.payload?.round_type as string | undefined) ??
            (buildMode
              ? 'bnd_build'
              : phase === 'bnd_interview'
                ? 'project_defense'
                : phase === 'ai_screening'
                  ? 'screening'
                  : phase === 'hr_verbal'
                    ? 'hr_verbal'
                    : 'intro_verbal'),
        },
      };
      enqueue(withRound);
      if (event.type === 'multi_face') {
        const multiFaceAt = new Date().toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        publishProctorTelemetry({ multiFace: true, multiFaceAt });
      }
      if (event.severity === 'critical' || event.severity === 'warning') {
        setProctorAlert(`Integrity alert: ${event.type.replace(/_/g, ' ')}`);
      }
    },
    [buildMode, enqueue, phase, publishProctorTelemetry],
  );

  const handleFaceTelemetry = useCallback(
    (state: { lookingAway: boolean; multiFace: boolean }) => {
      publishProctorTelemetry({
        lookingAway: state.lookingAway,
        multiFace: state.multiFace,
        multiFaceAt: state.multiFace
          ? new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : null,
      });
    },
    [publishProctorTelemetry],
  );

  const terminateForProctor = useCallback(
    async (terminationReason: string) => {
      beginIntentionalExit();
      try {
        await endInterview('proctor_termination');
      } catch (err) {
        console.warn('[proctor] LiveKit end_interview signal failed', err);
      }
      try {
        await forceCompleteAutonomous(candidateToken, {
          endedBy: 'proctor',
          terminationReason,
        });
      } catch (err) {
        console.warn('[proctor] force-complete failed', err);
      }
    },
    [beginIntentionalExit, candidateToken, endInterview],
  );

  const {
    isAway,
    secondsLeft: focusSecondsLeft,
    strikePendingAck,
    focusStrikeCount,
    returnToFullscreen,
    hydrateFocusStrikes,
    resetFocusStrikes,
  } = useFocusIntegrity({
    enabled: shouldEnforceIntegrity,
    thresholdSeconds: focusThresholdSeconds,
    onEvent: handleProctorEvent,
    onFocusStrike: ({ durationSeconds }) => {
      setProctorAlert(
        `Focus strike: browser tab/window away for ${durationSeconds}s`,
      );
    },
  });

  useSessionProctor({
    enabled: visible && !compact && videoEnabled,
    videoRef,
    referenceDescriptor: referenceFaceDescriptor,
    faceMatchThreshold: proctorConfig?.faceMatchThreshold ?? 0.55,
    checkIntervalMs: proctorConfig?.faceCheckIntervalMs ?? 3000,
    agentSpeaking: status === 'agent_speaking',
    micEnabled,
    suppressExtraVoice: proctorInterventionActive,
    onEvent: handleProctorEvent,
    onFaceTelemetry: handleFaceTelemetry,
  });

  // Hydrate / reset focus strikes with round transitions (Build never enforces).
  useEffect(() => {
    const nextKey = `${buildMode ? 'build' : 'interview'}:${phase}`;
    if (focusRoundKeyRef.current !== nextKey) {
      focusRoundKeyRef.current = nextKey;
      resetFocusStrikes();
      focusTerminationStartedRef.current = false;
    }
    if (!visible || buildMode) return;
    let cancelled = false;
    void getAutonomousSession(candidateToken).then((session) => {
      if (cancelled) return;
      const summary = session.proctorSummary as Record<string, unknown> | null | undefined;
      const round = summary?.current_round_strikes as
        | { focus_strikes?: number }
        | undefined;
      if (typeof round?.focus_strikes === 'number') {
        hydrateFocusStrikes(round.focus_strikes);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    buildMode,
    candidateToken,
    hydrateFocusStrikes,
    phase,
    resetFocusStrikes,
    visible,
  ]);

  // Focus auto-terminate (two-step: LiveKit signal then force-complete).
  useEffect(() => {
    if (!enableFocusStrikes || !autoSubmitFocus || !shouldEnforceIntegrity) return;
    if (focusStrikeCount < maxFocusStrikes) return;
    if (focusTerminationStartedRef.current) return;
    focusTerminationStartedRef.current = true;
    const displayDeadline = Date.now() + 4000;
    void (async () => {
      try {
        await handleProctorEvent({
          type: 'focus_strike_terminated',
          severity: 'critical',
          client_ts: Date.now(),
          payload: {
            focus_strikes: focusStrikeCount,
            max_focus_strikes: maxFocusStrikes,
            message: 'Session closed after maximum focus strikes',
          },
        });
      } catch {
        /* ignore */
      }
      await terminateForProctor('max_focus_strikes_exceeded');
      const remainingMs = Math.max(0, displayDeadline - Date.now());
      window.setTimeout(() => {
        void disconnectLiveKitRoom(room);
        releaseInterviewLeaveGuard();
        onForceExit?.();
      }, remainingMs);
    })();
  }, [
    autoSubmitFocus,
    focusStrikeCount,
    handleProctorEvent,
    maxFocusStrikes,
    onForceExit,
    room,
    shouldEnforceIntegrity,
    terminateForProctor,
  ]);

  // Verbal stages: block copy/paste (coding sandbox keeps clipboard).
  useEffect(() => {
    if (!shouldEnforceIntegrity) return;
    const block = (e: ClipboardEvent) => {
      e.preventDefault();
    };
    document.addEventListener('copy', block, true);
    document.addEventListener('cut', block, true);
    document.addEventListener('paste', block, true);
    return () => {
      document.removeEventListener('copy', block, true);
      document.removeEventListener('cut', block, true);
      document.removeEventListener('paste', block, true);
    };
  }, [shouldEnforceIntegrity]);

  useEffect(() => {
    if (compact) {
      setEndDialogOpen(false);
      setScreenShareDialogOpen(false);
    }
  }, [compact]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void getAutonomousSession(candidateToken).then((session) => {
      if (cancelled) return;
      const history = session.introChatHistory ?? [];
      if (history.length) {
        setMessages(historyToChatMessages(history));
      }
      setIntroMaxTurns(
        phase === 'bnd_interview' || phase === 'bnd_assessment' || buildMode
          ? 8
          : (session.introMaxTurns ?? 50),
      );
      setRoomName(`interview-${candidateToken}`);
    });
    return () => {
      cancelled = true;
    };
  }, [candidateToken, visible, phase, buildMode]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(`${NOTES_PREFIX}${candidateToken}`);
      if (saved != null) setNotes(saved);
    } catch {
      /* ignore */
    }
  }, [candidateToken]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`${NOTES_PREFIX}${candidateToken}`, notes);
    } catch {
      /* ignore */
    }
  }, [candidateToken, notes]);

  useEffect(() => {
    if (!buildMode || !buildLookupToken) {
      setBuildDueAtMs(null);
      return;
    }
    let cancelled = false;
    void getProjectInterviewSubmission(buildLookupToken)
      .then((view) => {
        if (cancelled || !view.due_at) return;
        setBuildDueAtMs(new Date(view.due_at).getTime());
      })
      .catch(() => {
        /* panel may still show its own due_at */
      });
    return () => {
      cancelled = true;
    };
  }, [buildMode, buildLookupToken]);

  useEffect(() => {
    setMessages(historyToChatMessages(liveChatHistory));
  }, [liveChatHistory]);

  useEffect(() => {
    if (screenShareEnabled) hadScreenShareRef.current = true;
  }, [screenShareEnabled]);

  useEffect(() => {
    if (!screenShareGranted) hadScreenShareRef.current = false;
  }, [screenShareGranted]);

  useEffect(() => {
    if (
      visible &&
      !compact &&
      !forceScreenShare &&
      !screenShareEnabled &&
      !hasPromptedScreenShare &&
      canPromptScreenShare &&
      (status === 'live' || status === 'waiting_agent' || status === 'agent_speaking')
    ) {
      setScreenShareDialogOpen(true);
      setHasPromptedScreenShare(true);
    }
  }, [visible, compact, forceScreenShare, screenShareEnabled, hasPromptedScreenShare, status, canPromptScreenShare]);

  // After a required share drops mid-round, ask again. The Start Round gate owns the first prompt.
  useEffect(() => {
    if (!forceScreenShare || !visible || screenShareEnabled || !canPromptScreenShare) return;
    if (!hadScreenShareRef.current) return;
    if (status === 'live' || status === 'waiting_agent' || status === 'agent_speaking') {
      setScreenShareDialogOpen(true);
    }
  }, [forceScreenShare, visible, screenShareEnabled, status, canPromptScreenShare]);

  useEffect(() => {
    if (screenShareEnabled || screenReshareRequired) setScreenShareDialogOpen(false);
  }, [screenShareEnabled, screenReshareRequired]);

  useEffect(() => {
    if (!room || !videoEnabled) return;
    const attachLocalVideo = () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (pub?.track && videoRef.current) {
        pub.track.attach(videoRef.current);
      }
    };
    attachLocalVideo();
    room.on(RoomEvent.LocalTrackPublished, attachLocalVideo);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, attachLocalVideo);
    };
  }, [room, videoEnabled]);

  useEffect(() => {
    if (!room) return;
    const updateSpeaker = (speakers: Participant[]) => {
      const isSpeaking = speakers.some(s => s.identity === room.localParticipant.identity);
      setCandidateSpeaking(isSpeaking);
      if (isSpeaking) {
        setHasSpokenThisTurn(true);
        consecutiveTimeoutsRef.current = 0;
      }
    };
    room.on(RoomEvent.ActiveSpeakersChanged, updateSpeaker);
    return () => {
      room.off(RoomEvent.ActiveSpeakersChanged, updateSpeaker);
    };
  }, [room]);

  useEffect(() => {
    if (forceScreenShare && !screenShareGranted) {
      setStatusHint('Share your entire screen to start. The interviewer joins after the screen is shared.');
    } else if (status === 'connecting') {
      setStatusHint('Connecting to LiveKit room...');
    } else if (status === 'waiting_agent') {
      setStatusHint('Connected. Waiting for the AI interviewer to join...');
    } else if (status === 'live') {
      setStatusHint('You are live with the interviewer. Speak naturally after they finish.');
    } else if (status === 'agent_speaking') {
      setStatusHint('The interviewer is speaking...');
    }
  }, [status, forceScreenShare, screenShareGranted]);

  useEffect(() => {
    if (actionError || error) setErrorBannerDismissed(false);
  }, [actionError, error]);

  const [countdown, setCountdown] = useState(60);
  const timerPausedRef = useRef(false);
  const consecutiveTimeoutsRef = useRef(0);
  const mediaRecoveryRequiredRef = useRef(mediaRecoveryRequired);
  mediaRecoveryRequiredRef.current = mediaRecoveryRequired;
  const mediaTerminationStartedRef = useRef(false);

  useEffect(() => {
    if (status === 'agent_speaking' && !mediaRecoveryRequiredRef.current && !proctorInterventionRef.current) {
      setCountdown(60);
      timerPausedRef.current = false;
      setHasSpokenThisTurn(false);
    }
  }, [status]);

  useEffect(() => {
    if (proctorInterventionActive) {
      timerPausedRef.current = true;
    }
  }, [proctorInterventionActive]);

  useEffect(() => {
    if (!visible) return;
    let cutoffTriggered = false;
    const isBndInterview = phase === 'bnd_interview';
    const tick = () => {
      if (buildMode && buildDueAtMs) {
        const remaining = Math.max(0, Math.floor((buildDueAtMs - Date.now()) / 1000));
        const h = Math.floor(remaining / 3600);
        const m = Math.floor((remaining % 3600) / 60);
        const s = remaining % 60;
        setElapsed(
          `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
        );
        return;
      }

      const seconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');
      setElapsed(`${mm}:${ss}`);

      // HACK: Temporary 20-minute (1200 seconds) hard cutoff for testing.
      // Never in Build or Defend: only an explicit leave may end those rounds.
      if (!buildMode && !isBndInterview && seconds >= 1200 && !cutoffTriggered) {
        cutoffTriggered = true;
        void endInterview().catch(() => {});
      }

      // Build: candidate works on deliverables; no AI voice interviewer countdown.
      if (buildMode) return;

      if (status === 'live' && connectionState === 'connected') {
        if (mediaRecoveryRequiredRef.current || proctorInterventionRef.current) {
          timerPausedRef.current = true;
        } else {
          const isSpeaking = Boolean(room?.localParticipant?.isSpeaking);
          if (isSpeaking) {
            timerPausedRef.current = true;
            consecutiveTimeoutsRef.current = 0;
          } else if (!hasSpokenThisTurn) {
            timerPausedRef.current = false;
          }
        }
        if (!timerPausedRef.current) {
          setCountdown((c) => {
            if (c <= 1) {
              timerPausedRef.current = true;
              // Defend: do NOT inject fake SYSTEM "silence" turns — that advances
              // questions without listening to the candidate and inflates exchange counts.
              if (isBndInterview) {
                return 0;
              }
              setTimeout(() => {
                consecutiveTimeoutsRef.current += 1;
                if (consecutiveTimeoutsRef.current >= 3) {
                  void endInterview();
                } else {
                  const msg = Math.random() > 0.5 
                    ? "SYSTEM: The candidate has been silent for 1 minute. Ask them if they are still there."
                    : "SYSTEM: The candidate has been silent for 1 minute. State that you are moving on to the next question, and proceed.";
                  const payload = new TextEncoder().encode(JSON.stringify({ id: `timeout-${Date.now()}`, message: msg }));
                  room?.localParticipant.publishData(payload, { reliable: true, topic: 'lk-chat' });
                }
              }, 0);
              return 0;
            }
            return c - 1;
          });
        }
      }
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [visible, endInterview, status, room, buildMode, buildDueAtMs, phase, connectionState]);

  useEffect(() => {
    if (!enableMediaStrikes || !autoSubmitMedia) return;
    if (!mediaRecovery.terminated || mediaTerminationStartedRef.current) return;
    mediaTerminationStartedRef.current = true;
    const maxStrikes = proctorConfig?.maxMediaStrikes ?? getMaxMediaStrikes();
    const graceSeconds = getMediaGraceSeconds();
    const displayDeadline = Date.now() + 4000;
    void (async () => {
      try {
        await postInterviewProctorEvents(candidateToken, [
          {
            type: 'media_permission_terminated',
            severity: 'critical',
            client_ts: Date.now(),
            payload: {
              reason: mediaRecovery.terminationReason ?? 'grace_timeout',
              strikes: mediaRecovery.strike,
              phase,
              details:
                mediaRecovery.terminationReason === 'max_strikes_exceeded'
                  ? `The session was closed after ${maxStrikes} camera or microphone interruptions.`
                  : `The ${graceSeconds}-second recovery window expired without restoring camera or microphone access.`,
            },
          },
        ]);
      } catch (eventErr) {
        console.warn('[termination] Failed to post termination proctor event', eventErr);
      }
      try {
        if (buildMode) await leaveBuildWithoutSubmission(candidateToken);
        else {
          await terminateForProctor(
            mediaRecovery.terminationReason === 'max_strikes_exceeded'
              ? 'max_media_strikes_exceeded'
              : 'media_grace_timeout',
          );
        }
      } catch (err) {
        console.warn('[termination] Backend complete call threw, proceeding with exit', err);
      } finally {
        const remainingMs = Math.max(0, displayDeadline - Date.now());
        window.setTimeout(() => {
          void disconnectLiveKitRoom(room);
          releaseInterviewLeaveGuard();
          onForceExit?.();
        }, remainingMs);
      }
    })();
  }, [
    autoSubmitMedia,
    buildMode,
    candidateToken,
    mediaRecovery.strike,
    mediaRecovery.terminated,
    mediaRecovery.terminationReason,
    onForceExit,
    phase,
    proctorConfig?.maxMediaStrikes,
    room,
    terminateForProctor,
  ]);

  const handleEndInterview = useCallback(async () => {
    setActionError(null);
    // Before any request: the server may delete the room while this call is in flight.
    // If rejoin is still allowed, that delete shows "Disconnected" and a Reconnect button.
    beginIntentionalExit();
    setEndDialogOpen(false);
    const goToDashboard = () => {
      onForceExit?.();
      void disconnectLiveKitRoom(room);
    };
    try {
      if (buildMode) {
        const result = await leaveBuildWithoutSubmission(candidateToken);
        if (result?.finalized === false && result.reason !== 'submission_already_started') {
          releaseIntentionalExit();
          setActionError('Could not end Build. The session was not found.');
          return;
        }
        // A GitHub submit already ended the Build room and is scoring in the background.
        // Staying here only shows the disconnect banner. The dashboard updates when scoring finishes.
        goToDashboard();
        return;
      }
      try {
        await postInterviewProctorEvents(candidateToken, [
          {
            type: 'candidate_ended_interview',
            severity: 'warning',
            client_ts: Date.now(),
            payload: {
              reason: 'candidate_ended_interview',
              phase,
              message: 'Candidate pressed End Interview',
            },
          },
        ]);
      } catch (eventErr) {
        console.warn('[end-interview] Failed to post voluntary exit event', eventErr);
      }
      if (room?.state === 'connected') {
        try {
          await endInterview('candidate_ended_interview');
        } catch {
          try {
            await forceCompleteAutonomous(candidateToken, { endedBy: 'candidate' });
          } catch (e) {
            console.warn('forceCompleteAutonomous failed', e);
          }
          goToDashboard();
          return;
        }
        // The voice engine scores this attempt and posts complete. Stay connected
        // until that lands; disconnecting here used to cancel the score.
        const deadline = Date.now() + 45_000;
        let completed = false;
        while (Date.now() < deadline) {
          try {
            const row = await getAutonomousSession(candidateToken);
            if (row.currentPhase === 'completed') {
              completed = true;
              break;
            }
          } catch {
            /* session row may still be updating */
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!completed) {
          try {
            await forceCompleteAutonomous(candidateToken, { endedBy: 'candidate' });
          } catch (e) {
            console.warn('forceCompleteAutonomous failed', e);
          }
        }
      } else {
        try {
          await forceCompleteAutonomous(candidateToken, { endedBy: 'candidate' });
        } catch (e) {
          console.warn('forceCompleteAutonomous failed', e);
        }
      }
      goToDashboard();
    } catch (err) {
      if (!buildMode) {
        try {
          await forceCompleteAutonomous(candidateToken, { endedBy: 'candidate' });
        } catch (e) {
          console.warn('forceCompleteAutonomous failed', e);
        }
        goToDashboard();
        return;
      }
      releaseIntentionalExit();
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [
    beginIntentionalExit,
    releaseIntentionalExit,
    endInterview,
    onForceExit,
    candidateToken,
    buildMode,
    phase,
    room,
  ]);

  const interviewInProgress =
    visible &&
    (status === 'connecting' || status === 'waiting_agent' || status === 'live' || status === 'agent_speaking');
  const handleLeaveBlocked = useCallback((attempt: LeaveAttempt) => {
    setEndDialogOpen(false);
    setLeaveAttempt(attempt);
  }, []);
  useInterviewLeaveGuard(interviewInProgress, handleLeaveBlocked);

  const handleConfirmScreenShare = useCallback(async () => {
    setActionError(null);
    setScreenShareGateError(null);

    if (forceScreenShare && !screenShareGranted) {
      setScreenShareBusy(true);
      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { displaySurface: 'monitor' },
          audio: false,
        } as DisplayMediaStreamOptions);
        const track = stream.getVideoTracks()[0];
        if (!track) {
          stream.getTracks().forEach((item) => item.stop());
          throw new DOMException('No screen was shared.', 'NotAllowedError');
        }
        setPreAcquiredScreenTrack?.(track);
        setScreenShareGranted?.(true);
        setScreenShareDialogOpen(false);
        if (enableFocusStrikes && !document.fullscreenElement && document.documentElement.requestFullscreen) {
          try {
            await document.documentElement.requestFullscreen();
          } catch {
            /* ignore if browser policy blocks */
          }
        }
      } catch (err) {
        const name = err instanceof DOMException || err instanceof Error ? err.name : '';
        setScreenShareGateError(
          name === 'NotAllowedError' || name === 'AbortError'
            ? 'You must share your entire screen to continue.'
            : err instanceof Error
              ? err.message
              : 'You must share your entire screen to continue.',
        );
        setScreenShareDialogOpen(false);
      } finally {
        setScreenShareBusy(false);
      }
      return;
    }

    try {
      await toggleScreenShare();
      setScreenShareDialogOpen(false);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }, [
    forceScreenShare,
    screenShareGranted,
    setPreAcquiredScreenTrack,
    setScreenShareGranted,
    toggleScreenShare,
  ]);

  const handleScreenShare = useCallback(() => {
    if (forceScreenShare && screenShareEnabled) return;
    if (forceScreenShare && !screenShareGranted) {
      void handleConfirmScreenShare();
      return;
    }
    if (screenShareEnabled) {
      void toggleScreenShare();
      return;
    }
    setScreenShareGateError(null);
    setScreenShareDialogOpen(true);
  }, [forceScreenShare, screenShareEnabled, screenShareGranted, handleConfirmScreenShare, toggleScreenShare]);

  const insertNoteTag = useCallback((tag: string) => {
    setNotes((prev) => prev + tag);
    notesRef.current?.focus();
  }, []);

  const dismissProctor = useCallback(() => {
    setProctorAlert(null);
    onProctorWarningDismiss?.();
  }, [onProctorWarningDismiss]);

  if (!visible) return null;

  const overlayLabel =
    status === 'agent_speaking'
      ? 'Speaking...'
      : status === 'live'
        ? 'Listening...'
        : status === 'waiting_agent'
          ? 'Connecting...'
          : status === 'connecting'
            ? 'Joining room...'
            : null;

  const modeLabel =
    status === 'agent_speaking'
      ? 'Interviewer speaking...'
      : status === 'live'
        ? candidateSpeaking
          ? 'Listening to you...'
          : hasSpokenThisTurn
            ? 'Evaluating your response...'
            : 'Waiting for you to speak...'
        : status === 'waiting_agent'
          ? 'Waiting for interviewer'
          : status === 'connecting'
            ? 'Joining room...'
            : statusHint;

  const showWave = status === 'live' || status === 'agent_speaking';
  const phaseLabel =
    buildMode || phase === 'bnd_assessment'
      ? 'Build Assessment'
      : phase === 'bnd_interview'
        ? 'Project Defend'
        : phase === 'ai_screening'
          ? 'AI Screening'
          : phase === 'closing'
            ? 'Closing'
            : phase === 'hr_verbal'
              ? 'HR Verbal'
              : phase === 'ai_verbal'
                ? 'AI Verbal'
              : subPhase === 'pre_assessment'
                ? 'Pre-Assessment'
                : subPhase === 'screen_share_ready'
                  ? 'Confirm Coding'
                  : subPhase === 'assessment_active'
                    ? 'Assessment Active'
                    : 'AI Verbal';
  const interviewTitle = buildMode ? `${techStack} Build Assessment` : `${techStack} Interview`;
  const exchangeCount = messages.filter((m) => m.role === 'assistant').length;
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const activeRubric =
    [...messages].reverse().find((m) => m.role === 'assistant' && m.rubric)?.rubric ||
    techStack.trim();
  const primaryCount = activeRubric
    ? messages.filter(
        (m) => m.role === 'assistant' && m.rubric === activeRubric && m.questionKind !== 'followup',
      ).length
    : 0;
  const displayError = actionError ?? error;
  const showErrorBanner = Boolean(displayError) && !errorBannerDismissed;
  // HACK: Hide proctor banner for now per user request
  const showProctorBanner = false; // Boolean(proctorAlert || proctorWarning);
  const progressFilled = Math.min(3, Math.max(1, Math.ceil((exchangeCount / Math.max(introMaxTurns, 1)) * 3)));
  const shortRoomId =
    roomName.length > 28 ? `${roomName.slice(0, 12)}…${roomName.slice(-8)}` : roomName || '—';

  const controlDock = (
    <div className="flex shrink-0 items-center gap-2 rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]/90 px-3.5 py-1.5 shadow-xl backdrop-blur-md">
      <button
        type="button"
        onClick={() => void toggleMic()}
        disabled={requireMic && micEnabled}
        title={
          requireMic && micEnabled
            ? 'Microphone is required for this round'
            : micEnabled
              ? 'Mute microphone'
              : 'Unmute microphone'
        }
        className={`group flex h-9 w-9 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-50 ${
          micEnabled
            ? 'bg-[var(--assessment-primary)]/15 text-[var(--assessment-primary)] hover:bg-[var(--assessment-primary)]/25'
            : 'bg-[var(--assessment-error-container)] text-[var(--assessment-error)]'
        }`}
      >
        <AssessmentMaterialIcon
          name={micEnabled ? 'mic' : 'mic_off'}
          size={18}
          className="transition-transform group-hover:scale-110"
        />
      </button>

      {!compact ? (
        <button
          type="button"
          onClick={() => void toggleVideo()}
          disabled={forceCamera && videoEnabled}
          title={
            forceCamera
              ? videoEnabled
                ? 'Camera required (cannot turn off)'
                : 'Turn camera on (required)'
              : videoEnabled
                ? 'Turn camera off'
                : 'Turn camera on'
          }
          className={`group flex h-9 w-9 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed disabled:opacity-60 ${
            videoEnabled
              ? 'bg-[var(--assessment-primary)]/15 text-[var(--assessment-primary)] hover:bg-[var(--assessment-primary)]/25'
              : 'bg-[var(--assessment-error-container)] text-[var(--assessment-error)]'
          }`}
        >
          <AssessmentMaterialIcon
            name={videoEnabled ? 'videocam' : 'videocam_off'}
            size={18}
            className="transition-transform group-hover:scale-110"
          />
        </button>
      ) : null}

      <button
        type="button"
        onClick={handleScreenShare}
        disabled={forceScreenShare && screenShareEnabled}
        title={
          forceScreenShare
            ? screenShareEnabled
              ? 'Screen share required (cannot turn off)'
              : 'Share screen (required)'
            : screenShareEnabled
              ? 'Stop screen share'
              : 'Share screen'
        }
        className={`group flex h-9 w-9 items-center justify-center rounded-full transition-all disabled:cursor-not-allowed ${
          screenShareEnabled
            ? 'bg-emerald-500/15 text-emerald-700'
            : 'bg-[var(--assessment-primary)]/15 text-[var(--assessment-primary)] hover:bg-[var(--assessment-primary)]/25'
        }`}
      >
        <AssessmentMaterialIcon
          name={screenShareEnabled ? 'stop_screen_share' : 'present_to_all'}
          size={18}
          className="transition-transform group-hover:scale-110"
        />
      </button>

      <div className="mx-1 h-5 w-px bg-[var(--assessment-outline-variant)]" />

      <button
        type="button"
        onClick={() => setEndDialogOpen(true)}
        className="flex h-9 items-center gap-1.5 rounded-full bg-[var(--assessment-error)] px-3.5 text-xs font-medium text-white shadow-sm transition-all hover:opacity-90"
      >
        <AssessmentMaterialIcon name="call_end" size={16} />
        <span>{compact ? 'End' : buildMode ? 'Leave Build' : 'Leave Room'}</span>
      </button>
    </div>
  );

  const dialogs = (
    <>
      <InterviewConfirmDialog
        open={endDialogOpen}
        title={buildMode ? 'Leave the Build round?' : 'End interview?'}
        message={
          buildMode
            ? 'You will leave the Build round without submitting a GitHub repository, and you won\'t be able to come back to it. If you still want to submit, stay and use the submission panel before the deadline.'
            : 'This ends your interview and sends your answers for evaluation. You won\'t be able to rejoin or answer any more questions afterward.'
        }
        confirmLabel={buildMode ? 'Leave Build' : 'End interview'}
        cancelLabel="Keep going"
        destructive
        onConfirm={() => void handleEndInterview()}
        onCancel={() => setEndDialogOpen(false)}
      />
            <InterviewConfirmDialog
        open={Boolean(forceScreenShare && !screenShareGranted && !screenShareDialogOpen)}
        title="Start this round"
        message="Share your entire screen to start. The interviewer joins after the screen is shared."
        confirmLabel={screenShareBusy ? 'Waiting for screen share…' : 'Start round and share your entire screen'}
        cancelLabel={null}
        error={screenShareGateError}
        confirmDisabled={screenShareBusy}
        onConfirm={() => {
          void handleConfirmScreenShare();
        }}
        onCancel={() => {}}
      />
      <InterviewConfirmDialog
        open={leaveAttempt !== null}
        title={
          leaveAttempt === 'back'
            ? buildMode
              ? 'Leave the Build round?'
              : 'Leave the interview?'
            : buildMode
              ? 'Your Build round is still in progress'
              : 'Your interview is still in progress'
        }
        message={
          <div className="space-y-3">
            <p>
              {leaveAttempt === 'back'
                ? 'Going back will take you out of the live session.'
                : 'Closing or refreshing this tab disconnects you from the live session.'}{' '}
              {buildMode
                ? 'The Build deadline keeps running while you are away.'
                : 'The AI interviewer cannot hear you while you are away.'}
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>Keep this tab open until you are done.</li>
              <li>If your internet drops, stay on this page. It reconnects automatically.</li>
              <li>
                {buildMode
                  ? 'Submit your GitHub repository in the side panel when you are ready; you will move to the Defend interview automatically.'
                  : 'When you have finished, click "Leave Room" to end the interview properly so your answers are submitted.'}
              </li>
              <li>
                If you close the tab by mistake, reopen the same interview link in this browser to rejoin and continue.
              </li>
            </ul>
          </div>
        }
        confirmLabel={buildMode ? 'Continue Build' : 'Continue interview'}
        cancelLabel={buildMode ? 'Leave Build' : 'End interview'}
        onConfirm={() => setLeaveAttempt(null)}
        onCancel={() => {
          setLeaveAttempt(null);
          setEndDialogOpen(true);
        }}
      />
      <InterviewConfirmDialog
        open={screenShareDialogOpen}
        title="Share your screen"
        message={
          forceScreenShare
            ? 'Screen sharing is required for this round and cannot be turned off. Choose Entire Screen when the browser asks.'
            : 'Screen sharing is required to record the interview session for review. Please choose the window or screen with your browser when prompted.'
        }
        error={screenShareGateError}
        confirmDisabled={screenShareBusy}
        confirmLabel="Start screen share"
        cancelLabel={forceScreenShare ? null : 'Not now'}
        onConfirm={() => void handleConfirmScreenShare()}
        onCancel={() => setScreenShareDialogOpen(false)}
      />
    </>
  );

  if (compact) {
    return (
      <>
        {dialogs}
        {showProctorBanner ? (
          <div className="pointer-events-auto fixed bottom-24 left-4 right-4 z-50 mx-auto max-w-lg rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-amber-950 shadow-lg">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-100">
                  <AssessmentMaterialIcon name="visibility" size={16} className="text-amber-700" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold">{proctorAlert ?? proctorWarning}</p>
                </div>
              </div>
              <button
                type="button"
                className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-amber-700"
                onClick={dismissProctor}
              >
                Acknowledge
              </button>
            </div>
          </div>
        ) : null}
        <div className="pointer-events-none fixed right-4 top-16 z-40 flex flex-col items-end gap-2">
          <div className="pointer-events-auto">{controlDock}</div>
          <p className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]/95 px-2 py-0.5 font-mono-label text-[10px] text-[var(--assessment-on-surface-variant)] shadow">
            {phaseLabel} · {agentConnected ? 'Agent connected' : 'Waiting'}
          </p>
          {actionError ? (
            <p className="max-w-xs rounded-lg bg-[var(--assessment-error-container)] px-2 py-1 text-[10px] text-[var(--assessment-error)]">
              {actionError}
            </p>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <div className="conversation-session flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden antialiased">
      {dialogs}
      <FullscreenEnforcementModal
        open={shouldEnforceIntegrity && isAway}
        secondsLeft={focusSecondsLeft}
        strikePendingAck={strikePendingAck}
        focusStrikeCount={focusStrikeCount}
        maxFocusStrikes={maxFocusStrikes}
        onReturn={() => void returnToFullscreen()}
      />

      {/* TOP HEADER BAR — CodeVox Assessment shell */}
      <header className="z-30 flex h-14 shrink-0 items-center justify-between bg-[var(--assessment-primary)] px-4 shadow-md sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/15 text-white shadow-sm">
              <AssessmentMaterialIcon name="neurology" size={18} />
            </div>
            <span className="shrink-0 text-base font-bold text-[var(--assessment-on-primary)]">
              CodeVox Assessment
            </span>
          </div>
          <div className="hidden h-6 w-px bg-white/30 sm:block" />
          <div className="hidden min-w-0 items-center gap-2 sm:flex">
            <span className="truncate text-xs font-medium uppercase tracking-wider text-white/80">
              Candidate Assessment
            </span>
            <span className="font-mono-label inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-xs text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {interviewTitle}
              <span className="text-white/50">·</span>
              {phaseLabel}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 sm:px-4">
            <AssessmentMaterialIcon name="timer" size={16} className="text-white" />
            <span className="font-mono-label text-xs font-medium text-white">
              {buildMode ? 'Time left' : 'Timer'}: {elapsed}
            </span>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-3 py-1.5 sm:flex sm:px-4">
            <AssessmentMaterialIcon name="podcasts" size={16} className="text-white" />
            <span className="font-mono-label text-xs font-medium text-white">
              LiveKit · {agentConnected ? 'Live' : 'Wait'}
            </span>
          </div>
        </div>
      </header>

      {showErrorBanner ? (
        <div className="z-30 flex w-full shrink-0 items-center justify-between border-b border-[var(--assessment-error)]/30 bg-[var(--assessment-error-container)]/80 px-6 py-2 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-[var(--assessment-error)]/30 bg-[var(--assessment-error)]/15">
              <AssessmentMaterialIcon name="wifi_off" size={16} className="text-[var(--assessment-error)]" />
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="font-mono-label rounded border border-[var(--assessment-error)]/25 bg-[var(--assessment-error)]/10 px-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--assessment-error)]">
                Error
              </span>
              <span className="truncate text-xs font-medium text-[var(--color-danger-text, #b91c1c)]">
                {displayError}
              </span>
            </div>
          </div>
          <button
            type="button"
            title="Dismiss banner"
            className="shrink-0 rounded p-1 text-[var(--color-danger-text, #b91c1c)] transition-colors hover:bg-[var(--assessment-error)]/10"
            onClick={() => {
              setActionError(null);
              setErrorBannerDismissed(true);
            }}
          >
            <AssessmentMaterialIcon name="close" size={16} />
          </button>
        </div>
      ) : null}

      {proctorInterventionActive ? (
        <div className="z-40 flex w-full shrink-0 items-center justify-center gap-2 border-b border-sky-300/60 bg-sky-50 px-4 py-2 text-sky-950 shadow-sm">
          <span className="text-sm font-semibold">
            Interview Paused by Recruiter · Recruiter speaking…
          </span>
        </div>
      ) : null}

      {/* MAIN STAGE */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        {/* LEFT: AI INTERVIEWER STAGE (70%) */}
        <main className="relative flex w-[70%] flex-col items-center justify-center overflow-hidden border-r border-[var(--assessment-outline-variant)] bg-[var(--color-primary-container)]/20">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-[#050B18] via-[#081426] to-[#0B1930]" />

          <div className="custom-scrollbar relative z-10 flex h-full w-full flex-col justify-between overflow-y-auto p-6">
            {/* Active question card */}
            <div className="w-full shrink-0 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]/80 backdrop-blur-md p-5 shadow-lg">
              <div className="mb-2.5 flex items-center justify-between gap-3 border-b border-[var(--assessment-outline-variant)]/40 pb-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                  <span className="font-mono-label inline-flex items-center gap-1.5 rounded-full border border-[var(--assessment-primary)]/30 bg-[var(--assessment-primary)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--assessment-primary)]">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--assessment-primary)]" />
                    Exchange {exchangeCount} of {introMaxTurns}
                  </span>
                  <span className="font-mono-label text-xs font-medium text-[var(--assessment-on-surface-variant)]">
                    {phaseLabel}
                  </span>
                  {activeRubric ? (
                    <>
                      <span className="text-[var(--assessment-outline)]">·</span>
                      <span className="font-mono-label rounded bg-[var(--assessment-surface-container)] px-2 py-0.5 text-[11px] font-medium text-[var(--assessment-on-surface-variant)]">
                        {activeRubric}
                        {primaryCount > 0 ? ` · ${primaryCount} question${primaryCount === 1 ? '' : 's'}` : ''}
                      </span>
                    </>
                  ) : null}
                </div>
                {overlayLabel ? (
                  <span className="font-mono-label shrink-0 rounded border border-[var(--assessment-primary)]/20 bg-[var(--assessment-primary)]/10 px-2 py-0.5 text-[11px] text-[var(--assessment-primary)]">
                    {overlayLabel}
                  </span>
                ) : null}
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--assessment-primary)]/25 bg-[var(--assessment-primary)]/10 text-[var(--assessment-primary)]">
                  <AssessmentMaterialIcon name="format_quote" size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="text-[16px] font-semibold leading-snug tracking-tight text-[var(--assessment-on-surface)]">
                    {lastAssistant?.content
                      ? `"${lastAssistant.content}"`
                      : statusHint}
                  </h1>
                </div>
              </div>
            </div>

            {/* Middle: interviewer tile + HUD */}
            <div className="my-4 grid min-h-0 flex-1 grid-cols-12 items-stretch gap-5">
              <div className="group relative col-span-8 flex flex-col justify-between overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[#0B1930] shadow-sm">
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-gradient-to-b from-[#081426] via-[#050B18] to-[#081426]">
                  <div className="pointer-events-none absolute inset-0 bg-radial-glow opacity-30" />
                  <CircularAudioVisualizer
                    size={280}
                    isSpeaking={status === 'agent_speaking'}
                    isListening={status === 'live'}
                    isAnalyzing={status === 'connecting' || status === 'idle'}
                    agentConnected={agentConnected}
                  />
                </div>

                <div className="relative z-10 flex w-full items-center justify-between p-3.5">
                  <div className="glass-card flex items-center gap-2.5 rounded-full px-3 py-1 shadow-lg">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface)]">
                      AI Interviewer
                    </span>
                    <span className="font-mono-label rounded-full bg-[var(--assessment-primary)]/15 px-1.5 text-[9px] font-semibold uppercase text-[var(--assessment-primary)]">
                      AI Lead
                    </span>
                  </div>
                  {showWave ? (
                    <div className="glass-card flex items-center gap-1.5 rounded-full px-2.5 py-1 shadow-md">
                      <AssessmentMaterialIcon name="graphic_eq" size={12} className="text-[var(--assessment-primary)]" />
                      <span className="font-mono-label text-[10px] text-[var(--assessment-on-surface-variant)]">
                        Live audio
                      </span>
                    </div>
                  ) : null}
                </div>

                <div className="relative z-10 flex w-full items-end justify-between p-3.5">
                  <div className="flex flex-1 items-end justify-start">
                    {showWave ? (
                      <div className="glass-card wave-container rounded-full px-3 py-2 shadow-sm">
                        {Array.from({ length: 8 }).map((_, i) => (
                          <div
                            key={i}
                            className="wave-bar"
                            style={{ animationDelay: `${(i + 1) * 0.1}s` }}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-end justify-center pb-1">
                    {controlDock}
                  </div>
                  <div className="flex flex-1 items-end justify-end" />
                </div>
              </div>

              {/* Right HUD + candidate PiP */}
              <div className="col-span-4 flex flex-col justify-between gap-3">
                {/* Candidate PiP */}
                <div className="relative flex flex-1 flex-col justify-between overflow-hidden rounded-xl border-2 border-[var(--assessment-primary)] bg-[#0B1930] p-3 shadow-2xl">
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B1930]">
                    {videoEnabled ? (
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        muted
                        className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
                      />
                    ) : (
                      <>
                        <div className="mb-0.5 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-sm font-semibold text-white shadow-inner">
                          You
                        </div>
                        <p className="text-xs font-medium text-white/95">You (Candidate)</p>
                        <p className="font-mono-label text-[10px] text-white/60">Camera off</p>
                      </>
                    )}
                  </div>
                  <div className="relative z-10 flex items-center justify-between">
                    <span className="font-mono-label flex items-center gap-1 rounded bg-black/50 px-2 py-0.5 text-[9px] text-white backdrop-blur-sm">
                      <AssessmentMaterialIcon
                        name="person"
                        size={12}
                        className="text-[var(--color-primary-fixed,#93c5fd)]"
                      />
                      You (Candidate)
                    </span>
                    <span
                      className={`font-mono-label flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[9px] backdrop-blur-sm ${
                        micEnabled ? 'text-emerald-400' : 'text-red-300'
                      }`}
                    >
                      <AssessmentMaterialIcon name={micEnabled ? 'mic' : 'mic_off'} size={10} />
                      {micEnabled ? 'Live' : 'Muted'}
                    </span>
                  </div>
                  <div className="relative z-10 flex items-center gap-1.5 rounded bg-black/50 px-2 py-0.5 backdrop-blur-sm">
                    <AssessmentMaterialIcon name="volume_up" size={12} className="text-white/70" />
                    <div className="flex h-1 flex-1 items-center gap-0.5">
                      <span
                        className={`h-1 flex-1 rounded-full ${micEnabled ? 'bg-[var(--assessment-primary)]' : 'bg-white/20'}`}
                      />
                      <span
                        className={`h-1 flex-1 rounded-full ${micEnabled ? 'bg-[var(--assessment-primary)]' : 'bg-white/20'}`}
                      />
                      <span
                        className={`h-1 flex-1 rounded-full ${micEnabled ? 'bg-[var(--assessment-primary)]' : 'bg-white/20'}`}
                      />
                      <span className="h-0.5 flex-1 rounded-full bg-white/20" />
                    </div>
                  </div>
                </div>

                {/* HUD */}
                <div className="flex shrink-0 flex-col justify-between rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]/80 backdrop-blur-md p-4 shadow-lg">
                  <div>
                    <div className="mb-2.5 flex items-center justify-between border-b border-[var(--assessment-outline-variant)]/40 pb-2">
                      <span className="font-mono-label flex items-center gap-1.5 text-[11px] font-semibold uppercase text-[var(--assessment-on-surface-variant)]">
                        <AssessmentMaterialIcon name="memory" size={15} className="text-[var(--assessment-primary)]" />
                        AI Assessment Engine
                      </span>
                      <span className="font-mono-label inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-600">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                        {agentConnected || status === 'live' || status === 'agent_speaking'
                          ? 'Online'
                          : 'Connecting'}
                      </span>
                    </div>

                    <div className="mb-2.5 flex items-center justify-between rounded-xl border border-[var(--assessment-primary)]/20 bg-[var(--assessment-surface-container)] px-3 py-2">
                      <div className="flex items-center gap-2">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--assessment-primary)] opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--assessment-primary)]" />
                        </span>
                        <span className="font-mono-label text-xs font-medium text-[var(--assessment-on-surface)]">
                          {modeLabel}
                        </span>
                      </div>
                      {showWave ? (
                        <div className="flex h-3 items-center gap-0.5 px-1">
                          <span className="h-2 w-0.5 rounded-full bg-[var(--assessment-primary)] wave-animate-1" />
                          <span className="h-3 w-0.5 rounded-full bg-[var(--assessment-primary)] wave-animate-2" />
                          <span className="h-1.5 w-0.5 rounded-full bg-[var(--assessment-primary)] wave-animate-3" />
                          <span className="h-2.5 w-0.5 rounded-full bg-[var(--assessment-primary)] wave-animate-4" />
                        </div>
                      ) : null}
                    </div>

                    <div className="mb-2.5 flex flex-col items-center rounded-xl border border-[var(--assessment-outline-variant)]/60 bg-[var(--assessment-surface-container-low)] p-3 text-center shadow-sm">
                      <div className="mb-3 flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--assessment-primary)]" />
                        <span className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                          {status === 'connecting' || status === 'waiting_agent'
                            ? 'Please wait for the AI interviewer to join.'
                            : status === 'agent_speaking'
                              ? 'Interviewer is speaking...'
                              : 'Listening to your response...'}
                        </span>
                      </div>
                      <div className="relative my-1 flex h-24 w-24 items-center justify-center">
                        <svg className="h-full w-full -rotate-90" viewBox="0 0 96 96" aria-hidden>
                          <circle
                            cx="48"
                            cy="48"
                            r="40"
                            className="text-[var(--assessment-outline-variant)]/30"
                            strokeWidth="4"
                            stroke="currentColor"
                            fill="transparent"
                          />
                          <circle
                            cx="48"
                            cy="48"
                            r="40"
                            className="text-[var(--assessment-primary)]"
                            strokeWidth="4"
                            stroke="currentColor"
                            fill="transparent"
                            strokeDasharray="251.32"
                            strokeDashoffset={
                              status === 'connecting' || status === 'waiting_agent'
                                ? 251.2
                                : status === 'agent_speaking'
                                  ? 0
                                  : 251.2 * (1 - countdown / 60)
                            }
                            strokeLinecap="round"
                          />
                        </svg>
                        <div className="absolute flex flex-col items-center justify-center">
                          <span className="text-[18px] font-bold leading-none tracking-tight text-[var(--assessment-on-surface)]">
                            {status === 'connecting' || status === 'waiting_agent'
                              ? '--:--'
                              : countdown === 60
                                ? '01:00'
                                : `00:${String(countdown).padStart(2, '0')}`}
                          </span>
                          <span className="font-mono-label mt-0.5 text-[10px] text-[var(--assessment-on-surface-variant)]">
                            {status === 'connecting' || status === 'waiting_agent'
                              ? 'waiting'
                              : status === 'agent_speaking'
                                ? 'ready'
                                : timerPausedRef.current
                                  ? 'paused'
                                  : 'time left'}
                          </span>
                        </div>
                      </div>
                      <div className="font-mono-label mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-1 text-[11px] text-[var(--assessment-on-surface)] shadow-sm">
                        <span className="h-1.5 w-1.5 rounded-full bg-[var(--assessment-primary)]" />
                        <span>{modeLabel}</span>
                      </div>
                      <p className="mb-1 mt-2 px-2 text-[11px] leading-snug text-[var(--assessment-on-surface-variant)]">
                        Speak clearly and answer out loud.
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-[var(--assessment-outline-variant)]/40 pt-2">
                    <div className="mb-1.5 flex items-center justify-between font-mono-label text-[10px] text-[var(--assessment-on-surface-variant)]">
                      <span className="flex items-center gap-1 font-medium text-[var(--assessment-on-surface)]">
                        <AssessmentMaterialIcon name="graphic_eq" size={13} className="text-[var(--assessment-primary)]" />
                        Mic:{' '}
                        <span className="font-mono font-bold text-[var(--assessment-primary)]">
                          {micEnabled ? 'Live' : 'Muted'}
                        </span>
                      </span>
                      <span>{videoEnabled ? 'Cam on' : 'Cam off'}</span>
                    </div>
                    <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-[var(--assessment-surface-container)] p-0.5">
                      <div
                        className={`h-full rounded-full bg-[var(--assessment-primary)] ${
                          micEnabled ? 'w-[70%]' : 'w-[15%] opacity-40'
                        }`}
                      />
                      <div className="h-full w-[30%] rounded-full bg-[var(--assessment-surface-container-high)]" />
                    </div>
                  </div>
                </div>


              </div>
            </div>

            {/* Bottom: proctor + controls */}
            <div className="relative z-20 flex w-full shrink-0 items-center justify-between gap-4 pt-1">
              <div className="max-w-lg flex-1 transition-all duration-300">
                {showProctorBanner ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-amber-950 shadow-lg">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-amber-300 bg-amber-100">
                        <AssessmentMaterialIcon name="visibility" size={16} className="text-amber-700" />
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold">Proctoring Alert</p>
                        <p className="text-[10px] text-amber-800/80">{proctorAlert ?? proctorWarning}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 rounded-lg bg-amber-600 px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-700"
                      onClick={dismissProctor}
                    >
                      Acknowledge
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </main>

        {/* RIGHT SIDEBAR */}
        <aside className="z-10 flex h-full w-[30%] min-w-[280px] flex-col border-l border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] shadow-xl">
          {buildMode && buildLookupToken ? (
            <BuildAssessmentSidePanel lookupToken={buildLookupToken} />
          ) : (
            <>
          <div className="shrink-0 border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4">
            <div className="mb-3 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-2.5 shadow-sm">
              <div className="mb-1.5 flex items-center justify-between gap-2 border-b border-[var(--assessment-outline-variant)]/40 pb-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <AssessmentMaterialIcon
                    name="meeting_room"
                    size={15}
                    className="text-[var(--assessment-on-surface-variant)]"
                  />
                  <span className="font-mono-label truncate text-[11px] font-semibold text-[var(--assessment-on-surface)]">
                    Room:{' '}
                    <span className="font-mono text-[var(--assessment-primary)]" title={roomName}>
                      {shortRoomId}
                    </span>
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    title="Copy Room ID"
                    className="rounded p-1 text-[var(--assessment-on-surface-variant)] transition-colors hover:bg-[var(--assessment-surface-container)] hover:text-[var(--assessment-on-surface)]"
                    onClick={() => {
                      if (roomName) void navigator.clipboard?.writeText(roomName);
                    }}
                  >
                    <AssessmentMaterialIcon name="content_copy" size={14} />
                  </button>
                  <span className="font-mono-label rounded border border-[var(--assessment-primary)]/25 bg-[var(--assessment-primary)]/15 px-1.5 text-[10px] font-medium text-[var(--assessment-primary)]">
                    {status === 'connecting' || status === 'idle' ? 'Connecting...' : 'Connected'}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-between text-[11px]">
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  <span className="font-mono-label text-xs font-medium text-[var(--assessment-on-surface)]">
                    Agent:{' '}
                    <span className={agentConnected ? 'font-semibold text-emerald-600' : 'text-[var(--assessment-on-surface-variant)]'}>
                      {agentConnected ? 'Connected' : 'Waiting'}
                    </span>
                  </span>
                </div>
                <span className="font-mono-label text-[10px] text-[var(--assessment-on-surface-variant)]">
                  {formatTime()}
                </span>
              </div>
            </div>

            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[var(--assessment-primary)]" />
                <span className="text-xs font-medium text-[var(--assessment-on-surface-variant)]">
                  {phaseLabel}
                  {screenShareEnabled ? ' · Screen sharing' : ''}
                </span>
              </div>
              <span className="font-mono-label text-[10px] text-[var(--assessment-on-surface-variant)]">
                {exchangeCount}/{introMaxTurns}
              </span>
            </div>
            <div className="mb-1 grid grid-cols-3 gap-1.5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className={`h-1.5 rounded-full ${
                    i < progressFilled ? 'bg-[var(--assessment-primary)]' : 'bg-[var(--assessment-surface-container)]'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col bg-[var(--assessment-surface)]">
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/60 px-4 py-2">
              <span className="font-mono-label flex items-center gap-1.5 text-xs font-medium text-[var(--assessment-on-surface)]">
                <AssessmentMaterialIcon name="record_voice_over" size={15} className="text-[var(--assessment-primary)]" />
                Realtime Dialogue Sync
              </span>
              <label className="flex cursor-pointer select-none items-center gap-1.5 text-xs text-[var(--assessment-on-surface-variant)]">
                <input
                  type="checkbox"
                  checked={autoScroll}
                  onChange={(e) => setAutoScroll(e.target.checked)}
                  className="h-3.5 w-3.5 cursor-pointer rounded text-[var(--assessment-primary)] focus:ring-0"
                />
                Auto-scroll
              </label>
            </div>

            <InterviewLiveTranscript
              messages={messages}
              showThinking={status === 'agent_speaking'}
              autoScroll={autoScroll}
              variant="hub"
            />
          </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

