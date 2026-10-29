'use client';

import {
  createContext,
  useCallback,
  useContext,
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
  type RemoteParticipant,
  type RemoteTrack,
} from 'livekit-client';
import {
  getAutonomousSession,
  initAutonomousSession,
  notifyCandidateReady,
  postInterviewProctorEvents,
} from '@/modules/autonomous-interview/lib/autonomous-interview-api';
import {
  LIVEKIT_CONNECT_OPTIONS,
  connectLiveKitRoom,
  disconnectLiveKitRoom,
  isRecoverableLiveKitError,
  reachableLiveKitUrl,
} from '@/modules/autonomous-interview/lib/livekit-session';
import {
  useLiveKitRejoin,
  type LiveKitLinkState,
} from '@/modules/autonomous-interview/lib/use-livekit-rejoin';
import {
  LiveKitConnectionBanner,
  ScreenShareRequiredOverlay,
} from '@/modules/autonomous-interview/components/LiveKitConnectionBanner';
import { MediaPermissionGateModal } from '@/modules/autonomous-interview/components/MediaPermissionGateModal';
import {
  getMaxMediaStrikes,
  getMediaGraceSeconds,
  isAutoSubmitOnMediaStrikeEnabled,
  isMediaStrikesEnabled,
  INITIAL_MEDIA_RECOVERY,
  classifyMediaError,
  safeStopTrack,
  type MediaDeviceKind,
  type MediaOutageReason,
  type MediaRecoveryState,
} from '@/modules/autonomous-interview/lib/media-recovery';
import type { ProctorEventInput } from '@/modules/proctor/types';
import {
  encodeProctorData,
  isProctorIntervention,
  parseProctorData,
  PROCTOR_TELEMETRY_TYPE,
} from '@/modules/autonomous-interview/lib/proctor-intervention';

type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'waiting_agent'
  | 'live'
  | 'agent_speaking'
  | 'error';

type InterviewRoomContextValue = {
  room: Room | null;
  status: ConnectionStatus;
  error: string | null;
  micEnabled: boolean;
  videoEnabled: boolean;
  screenShareEnabled: boolean;
  /** Camera must stay on (AI Screening / Defend / Build). */
  forceCamera: boolean;
  /** Screen share must stay on (AI Screening / Defend / Build). */
  forceScreenShare: boolean;
  agentConnected: boolean;
  /** LiveKit link health; anything but `connected` means a recovery is in progress. */
  connectionState: LiveKitLinkState;
  /** The candidate must click to share the screen again (shown as a blocking overlay). */
  screenReshareRequired: boolean;
  /** Microphone must stay on for this phase. */
  requireMic: boolean;
  /** Camera must stay on for this phase. */
  requireCamera: boolean;
  /** Full-screen media recovery lock is up. */
  mediaRecoveryRequired: boolean;
  mediaRecovery: MediaRecoveryState;
  graceSecondsLeft: number;
  /** Recruiter push-to-talk is active — timer frozen, agent muted. */
  proctorInterventionActive: boolean;
  reacquireMedia: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  toggleScreenShare: () => Promise<void>;
  /** Pass a reason for candidate exit or proctor termination (LiveKit DataChannel). */
  endInterview: (
    reason?: 'candidate_ended_interview' | 'proctor_termination',
  ) => Promise<void>;
  /** Authoritative media strike count for this round (hydrated / reset with round). */
  mediaStrikeCount: number;
  /** Confirmed Leave: a later room delete must not start auto-rejoin. */
  beginIntentionalExit: () => void;
  /** Leave was rejected; the candidate is still in the round. */
  releaseIntentionalExit: () => void;
  confirmCoding: () => Promise<void>;
  publishAssessmentComplete: (payload: {
    code_quality_score?: number;
    architectural_flaws?: string[];
  }) => Promise<void>;
  publishJson: (payload: Record<string, unknown>) => Promise<void>;
  attachAgentAudio: (track: RemoteTrack) => void;
  /** Broadcast live integrity snapshot to admin monitors. */
  publishProctorTelemetry: (partial?: {
    lookingAway?: boolean;
    multiFace?: boolean;
    multiFaceAt?: string | null;
  }) => void;
};

const InterviewRoomContext = createContext<InterviewRoomContextValue | null>(null);

/** How long a data message waits for a reconnect before failing. */
const PUBLISH_WAIT_MS = 30_000;
/** Rejoin: the agent should already be in the room. First start gets longer to connect. */
const AGENT_REJOIN_GRACE_MS = 8_000;
const AGENT_FIRST_START_GRACE_MS = 20_000;
const AGENT_RESTART_LIMIT = 2;

const AGENT_STARTED_PREFIX = 'livekit-agent-started:';
const AGENT_STARTED_TTL_MS = 12 * 60 * 60 * 1000;

function wasAgentStarted(key: string): boolean {
  try {
    const at = Number(window.localStorage.getItem(key));
    return Number.isFinite(at) && at > 0 && Date.now() - at < AGENT_STARTED_TTL_MS;
  } catch {
    return false;
  }
}

function markAgentStarted(key: string): void {
  try {
    window.localStorage.setItem(key, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function resolveLiveKitUrl(url: string | null | undefined): string {
  return reachableLiveKitUrl(url ?? process.env.NEXT_PUBLIC_LIVEKIT_URL ?? 'ws://localhost:7885');
}

function waitForConnected(room: Room, timeoutMs: number): Promise<void> {
  if (room.state === ConnectionState.Connected) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onState = (state: ConnectionState) => {
      if (state !== ConnectionState.Connected) return;
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Not connected to the interview room.'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      room.off(RoomEvent.ConnectionStateChanged, onState);
    };
    room.on(RoomEvent.ConnectionStateChanged, onState);
  });
}

function hasAgentParticipant(room: Room): boolean {
  return Array.from(room.remoteParticipants.values()).some((p) => p.identity.startsWith('agent-'));
}

const DEVICE_LOCK_MESSAGE =
  'Your camera or microphone is currently blocked by another application (like Zoom or MS Teams). Please close it completely and try again.';

function mediaStartErrorMessage(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return DEVICE_LOCK_MESSAGE;
  }
  return 'Microphone and Camera permissions are required. Please allow access and try again.';
}

type ProviderProps = {
  candidateToken: string;
  enabled: boolean;
  /** Build & Defend Build phase: mic optional (default on, toggleable, no mic strikes); camera + screen forced on. */
  mode?: 'interview' | 'build';
  /** Force camera on and block turning it off (AI Screening / Defend / Build). */
  forceCamera?: boolean;
  /** Force screen share on and block turning it off (AI Screening / Defend / Build). */
  forceScreenShare?: boolean;
  /** Screen capture acquired from the Start Round gesture, published once the room connects. */
  initialScreenTrack?: MediaStreamTrack | null;
  /** Current interview phase. Closing and completed stay unguarded. */
  phase?: string;
  proctorConfig?: Record<string, unknown> | null;
  children: ReactNode;
};

export function InterviewRoomProvider({
  candidateToken,
  enabled,
  mode = 'interview',
  forceCamera = false,
  forceScreenShare = false,
  initialScreenTrack = null,
  phase = '',
  proctorConfig,
  children,
}: ProviderProps) {
  const proctorConfigRef = useRef(proctorConfig);
  proctorConfigRef.current = proctorConfig;
  const buildMode = mode === 'build';
  // Build always requires camera + screen share; callers may also force for Defend / AI Screening.
  const lockCamera = forceCamera || buildMode;
  const lockScreenShare = forceScreenShare || buildMode;
  const isGuardedPhase = phase !== 'closing' && phase !== 'completed' && phase !== 'hr_verbal';
  const requireCamera = isGuardedPhase && Boolean(lockCamera);
  const requireMic =
    isGuardedPhase &&
    !buildMode &&
    (phase === 'ai_screening' || phase === 'ai_verbal' || phase === 'bnd_interview');
  const [room, setRoom] = useState<Room | null>(null);
  const roomRef = useRef<Room | null>(null);
  const agentAudioRef = useRef<HTMLAudioElement | null>(null);
  const agentAudioTrackSidRef = useRef<string | null>(null);
  const adminAudioHostRef = useRef<HTMLDivElement | null>(null);
  const audioContainerRef = useRef<HTMLDivElement | null>(null);
  const [proctorInterventionActive, setProctorInterventionActive] = useState(false);
  const proctorInterventionRef = useRef(false);
  const agentPausedForInterventionRef = useRef(false);
  const lastTelemetryRef = useRef({
    lookingAway: false,
    multiFace: false,
    multiFaceAt: null as string | null,
  });
  const buildModeRef = useRef(buildMode);
  buildModeRef.current = buildMode;
  const lockCameraRef = useRef(lockCamera);
  lockCameraRef.current = lockCamera;
  const lockScreenShareRef = useRef(lockScreenShare);
  lockScreenShareRef.current = lockScreenShare;
  const requireCameraRef = useRef(requireCamera);
  requireCameraRef.current = requireCamera;
  const requireMicRef = useRef(requireMic);
  requireMicRef.current = requireMic;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const initialScreenTrackRef = useRef<MediaStreamTrack | null>(initialScreenTrack);
  initialScreenTrackRef.current = initialScreenTrack;

  /** Set only by an explicit Leave click; disconnects after that are final. */
  const leftRef = useRef(false);
  const intentionalExitRef = useRef(false);
  // What the candidate wants published. Kept separately from UI state because a dropped
  // connection unpublishes everything and the rejoin must restore the previous intent.
  // Build: mic is optional (default on, toggleable) — never required for strikes.
  const micWantedRef = useRef(true);
  const cameraWantedRef = useRef(true);
  const screenWantedRef = useRef(false);
  const micTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const screenTrackRef = useRef<MediaStreamTrack | null>(null);

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [videoEnabled, setVideoEnabled] = useState(false);
  const [screenShareEnabled, setScreenShareEnabled] = useState(false);
  const [agentConnected, setAgentConnected] = useState(false);
  const [screenReshareRequired, setScreenReshareRequired] = useState(false);
  const [reshareError, setReshareError] = useState<string | null>(null);
  const [mediaRecovery, setMediaRecovery] = useState<MediaRecoveryState>(INITIAL_MEDIA_RECOVERY);
  const [graceSecondsLeft, setGraceSecondsLeft] = useState(getMediaGraceSeconds);
  const [reacquireBusy, setReacquireBusy] = useState(false);

  const recoveryRef = useRef(mediaRecovery);
  recoveryRef.current = mediaRecovery;
  const outageActiveRef = useRef(false);
  const mediaStrikesRef = useRef(0);
  const [mediaStrikeCount, setMediaStrikeCount] = useState(0);
  const roundKeyRef = useRef(`${mode}:${phase}`);
  const hydratedRef = useRef(false);
  const graceDeadlineRef = useRef<number | null>(null);
  const outageStartedAtRef = useRef<number | null>(null);
  const revokedEventSentRef = useRef(false);
  const isRejoiningRef = useRef(false);
  const mediaSwapRef = useRef(false);
  const mediaSwapGenerationRef = useRef(0);
  const rejoinGenerationRef = useRef(0);
  const linkStateRef = useRef<LiveKitLinkState>('connected');
  const cameraPermissionStatusRef = useRef<PermissionStatus | null>(null);
  const micPermissionStatusRef = useRef<PermissionStatus | null>(null);

  const commitRecovery = useCallback((next: MediaRecoveryState) => {
    recoveryRef.current = next;
    setMediaRecovery(next);
  }, []);

  const pendingLogsRef = useRef<ProctorEventInput[]>([]);

  const flushLinkLogs = useCallback(() => {
    if (!pendingLogsRef.current.length || !navigator.onLine) return;
    const batch = pendingLogsRef.current.splice(0);
    void postInterviewProctorEvents(candidateToken, batch).catch((err) => {
      // Network failure: keep the events for after the reconnect. HTTP errors are dropped.
      if (err instanceof TypeError) {
        pendingLogsRef.current = [...batch, ...pendingLogsRef.current].slice(-100);
      }
    });
  }, [candidateToken]);

  const logLink = useCallback(
    (type: string, payload: Record<string, unknown>) => {
      const full = { ...payload, mode: buildModeRef.current ? 'build' : 'interview' };
      console.info(`[livekit] ${type}`, full);
      pendingLogsRef.current.push({ type, severity: 'info', payload: full, client_ts: Date.now() });
      flushLinkLogs();
    },
    [flushLinkLogs],
  );
  const logLinkRef = useRef(logLink);
  logLinkRef.current = logLink;

  const attachAgentAudio = useCallback((track: RemoteTrack) => {
    if (agentAudioTrackSidRef.current === track.sid && agentAudioRef.current) {
      return;
    }
    agentAudioTrackSidRef.current = track.sid ?? null;
    const element = agentAudioRef.current ?? (track.attach() as HTMLAudioElement);
    if (!agentAudioRef.current) {
      element.autoplay = true;
      element.setAttribute('playsinline', 'true');
      agentAudioRef.current = element;
      if (audioContainerRef.current) {
        audioContainerRef.current.appendChild(element);
      }
    } else {
      track.attach(element);
    }
    if (proctorInterventionRef.current || recoveryRef.current.required) {
      element.volume = 0;
      try {
        element.pause();
      } catch {
        /* ignore */
      }
    } else {
      element.volume = 1;
      void element.play().catch(() => {});
    }
  }, []);

  const attachAdminAudio = useCallback((track: RemoteTrack, trackSid: string) => {
    const host = adminAudioHostRef.current ?? audioContainerRef.current;
    if (!host) return;
    let el = host.querySelector(`audio[data-admin-sid="${trackSid}"]`) as HTMLAudioElement | null;
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      el.setAttribute('playsinline', 'true');
      el.dataset.adminSid = trackSid;
      host.appendChild(el);
    }
    track.attach(el);
    void el.play().catch(() => {});
  }, []);

  const applyProctorIntervention = useCallback((action: 'PAUSE' | 'RESUME') => {
    const active = action === 'PAUSE';
    proctorInterventionRef.current = active;
    setProctorInterventionActive(active);
    const agentEl = agentAudioRef.current;
    if (!agentEl) return;
    if (active) {
      agentPausedForInterventionRef.current = !agentEl.paused;
      agentEl.volume = 0;
      try {
        agentEl.pause();
      } catch {
        /* ignore */
      }
    } else {
      agentEl.volume = recoveryRef.current.required ? 0 : 1;
      if (agentPausedForInterventionRef.current && !recoveryRef.current.required) {
        void agentEl.play().catch(() => {});
      }
      agentPausedForInterventionRef.current = false;
    }
  }, []);

  const publishProctorTelemetry = useCallback(
    (partial?: {
      lookingAway?: boolean;
      multiFace?: boolean;
      multiFaceAt?: string | null;
    }) => {
      if (partial) {
        lastTelemetryRef.current = {
          lookingAway: partial.lookingAway ?? lastTelemetryRef.current.lookingAway,
          multiFace: partial.multiFace ?? lastTelemetryRef.current.multiFace,
          multiFaceAt:
            partial.multiFaceAt !== undefined
              ? partial.multiFaceAt
              : lastTelemetryRef.current.multiFaceAt,
        };
      }
      const target = roomRef.current;
      if (!target || target.state !== ConnectionState.Connected) return;
      const recovery = recoveryRef.current;
      const payload = {
        type: PROCTOR_TELEMETRY_TYPE,
        timestamp: Date.now(),
        strikeCount: mediaStrikesRef.current,
        maxStrikes: getMaxMediaStrikes(),
        lookingAway: lastTelemetryRef.current.lookingAway,
        multiFace: lastTelemetryRef.current.multiFace,
        multiFaceAt: lastTelemetryRef.current.multiFaceAt,
        mediaOutage: recovery.required,
        graceSecondsLeft: graceDeadlineRef.current
          ? Math.max(0, Math.ceil((graceDeadlineRef.current - Date.now()) / 1000))
          : 0,
      };
      void target.localParticipant
        .publishData(encodeProctorData(payload) as any, { reliable: true })
        .catch(() => undefined);
    },
    [],
  );

  const attachAgentParticipant = useCallback(
    (participant: RemoteParticipant) => {
      if (!participant.identity.startsWith('agent-')) return;
      setAgentConnected(true);
      setStatus((prev) => (prev === 'waiting_agent' || prev === 'connecting' ? 'live' : prev));
      for (const pub of participant.audioTrackPublications.values()) {
        if (pub.track) attachAgentAudio(pub.track);
      }
    },
    [attachAgentAudio],
  );

  const triggerMediaOutageRef = useRef<(kind: MediaDeviceKind, reason?: MediaOutageReason) => void>(() => {});

  const triggerMediaOutage = useCallback((kind: MediaDeviceKind, reason: MediaOutageReason = 'track_ended') => {
    if (
      isRejoiningRef.current ||
      mediaSwapRef.current ||
      linkStateRef.current === 'rejoining' ||
      intentionalExitRef.current ||
      leftRef.current
    ) {
      return;
    }
    if (kind === 'camera' && !requireCameraRef.current) return;
    if (kind === 'mic' && !requireMicRef.current) return;

    const permissionDenied =
      reason === 'permission_denied' ||
      (kind === 'camera' && cameraPermissionStatusRef.current?.state === 'denied') ||
      (kind === 'mic' && micPermissionStatusRef.current?.state === 'denied');

    if (kind === 'camera') setVideoEnabled(false);
    if (kind === 'mic') setMicEnabled(false);

    if (outageActiveRef.current) {
      const prev = recoveryRef.current;
      if (!prev.required) return;
      commitRecovery({
        ...prev,
        cameraMissing: prev.cameraMissing || kind === 'camera',
        micMissing: prev.micMissing || (kind === 'mic' && requireMicRef.current),
        isHardBlocked: prev.isHardBlocked || permissionDenied,
        cameraError:
          kind === 'camera' && permissionDenied ? 'permission' : prev.cameraError,
        micError: kind === 'mic' && permissionDenied ? 'permission' : prev.micError,
      });
      return;
    }

    outageActiveRef.current = true;
    const enableMedia =
      typeof proctorConfigRef.current?.enableMediaStrikes === 'boolean'
        ? proctorConfigRef.current.enableMediaStrikes
        : isMediaStrikesEnabled();
    const autoSubmitMedia =
      typeof proctorConfigRef.current?.autoSubmitOnMediaStrike === 'boolean'
        ? proctorConfigRef.current.autoSubmitOnMediaStrike
        : isAutoSubmitOnMediaStrikeEnabled();
    const maxMedia =
      typeof proctorConfigRef.current?.maxMediaStrikes === 'number'
        ? proctorConfigRef.current.maxMediaStrikes
        : getMaxMediaStrikes();

    if (enableMedia) {
      mediaStrikesRef.current += 1;
      setMediaStrikeCount(mediaStrikesRef.current);
    }
    const strike = mediaStrikesRef.current;
    const terminated =
      enableMedia &&
      autoSubmitMedia &&
      strike >= maxMedia;
    outageStartedAtRef.current = Date.now();
    if (terminated) {
      graceDeadlineRef.current = null;
    } else {
      const graceSeconds = getMediaGraceSeconds();
      graceDeadlineRef.current = Date.now() + graceSeconds * 1000;
      setGraceSecondsLeft(graceSeconds);
    }

    const shouldEmit = !revokedEventSentRef.current;
    revokedEventSentRef.current = true;
    commitRecovery({
      ...recoveryRef.current,
      required: true,
      strike,
      cameraMissing: kind === 'camera' || recoveryRef.current.cameraMissing,
      micMissing: (kind === 'mic' && requireMicRef.current) || recoveryRef.current.micMissing,
      isHardBlocked: permissionDenied,
      attempted: false,
      cameraError: kind === 'camera' && permissionDenied ? 'permission' : null,
      micError: kind === 'mic' && permissionDenied ? 'permission' : null,
      terminated,
      terminationReason: terminated ? 'max_strikes_exceeded' : null,
    });

    if (shouldEmit) {
      queueMicrotask(() => {
        const current = recoveryRef.current;
        const missing: string[] = [];
        if (current.cameraMissing) missing.push('camera');
        if (current.micMissing) missing.push('microphone');
        void postInterviewProctorEvents(candidateToken, [
          {
            type: 'media_permission_revoked',
            severity: 'critical',
            client_ts: Date.now(),
            payload: {
              missing,
              strike: mediaStrikesRef.current,
              reason,
              phase: phaseRef.current,
            },
          },
        ]).catch(() => {});
      });
    }
  }, [candidateToken, commitRecovery]);

  triggerMediaOutageRef.current = triggerMediaOutage;

  const handleCameraEnded = useCallback(() => {
    triggerMediaOutageRef.current('camera', 'track_ended');
  }, []);
  const handleMicEnded = useCallback(() => {
    triggerMediaOutageRef.current('mic', 'track_ended');
  }, []);

  /** Restore what the candidate was publishing before the connection dropped. */
  const republishAfterRejoin = useCallback(
    async (target: Room) => {
      const generation = ++rejoinGenerationRef.current;
      isRejoiningRef.current = true;
      try {
        const lp = target.localParticipant;

        for (const participant of target.remoteParticipants.values()) {
          attachAgentParticipant(participant);
        }

        // Camera / mic: capture again (permission already granted, so no prompt) and release the
        // stale tracks that were kept alive across the drop.
        safeStopTrack(cameraTrackRef.current, handleCameraEnded);
        cameraTrackRef.current = null;
        if (cameraWantedRef.current || lockCameraRef.current) {
          await lp.setCameraEnabled(true);
          setVideoEnabled(true);
        }

        safeStopTrack(micTrackRef.current, handleMicEnded);
        micTrackRef.current = null;
        if (micWantedRef.current) {
          try {
            await lp.setMicrophoneEnabled(true);
            setMicEnabled(true);
          } catch {
            // Build (and any non-required mic): soft-fail — do not block rejoin.
            if (!requireMicRef.current) {
              setMicEnabled(false);
            } else {
              throw new Error('Could not restore microphone.');
            }
          }
        }

        const screen = screenTrackRef.current;
        const wantScreen = screenWantedRef.current || lockScreenShareRef.current;
        if (wantScreen && screen && screen.readyState === 'live') {
          await lp.publishTrack(screen, { source: Track.Source.ScreenShare });
          setScreenShareEnabled(true);
          logLinkRef.current('livekit_screen_republished', {});
        } else if (wantScreen) {
          screenTrackRef.current = null;
          setScreenShareEnabled(false);
          if (lockScreenShareRef.current) {
            setScreenReshareRequired(true);
            logLinkRef.current('livekit_screen_reshare_required', {});
          } else {
            screenWantedRef.current = false;
          }
        }
      } finally {
        window.setTimeout(() => {
          if (rejoinGenerationRef.current === generation) isRejoiningRef.current = false;
        }, 1000);
      }
    },
    [attachAgentParticipant, handleCameraEnded, handleMicEnded],
  );

  const getRejoinCredentials = useCallback(async () => {
    // /init never starts an agent — candidate-ready must not be called on a reconnect.
    const init = await initAutonomousSession(candidateToken);
    if (!init.livekitToken) throw new Error('No LiveKit token returned for rejoin.');
    return { url: resolveLiveKitUrl(init.livekitUrl), token: init.livekitToken };
  }, [candidateToken]);

  const { link, reconnectNow } = useLiveKitRejoin({
    room,
    shouldRejoin: () =>
      enabledRef.current && !leftRef.current && !intentionalExitRef.current,
    getCredentials: getRejoinCredentials,
    onRejoined: republishAfterRejoin,
    log: logLink,
  });
  linkStateRef.current = link.state;

  const publishJson = useCallback(async (payload: Record<string, unknown>) => {
    const room = roomRef.current;
    if (!room) {
      throw new Error('Not connected to the interview room.');
    }
    await waitForConnected(room, PUBLISH_WAIT_MS);
    const data = new TextEncoder().encode(JSON.stringify(payload)) as Uint8Array<ArrayBuffer>;
    await room.localParticipant.publishData(data, { reliable: true });
  }, []);

  const toggleMic = useCallback(async () => {
    // Required-mic rounds (Defend / AI verbal / screening): cannot mute while live.
    // Build: mic is optional — candidate may mute/unmute freely (no mic strikes).
    if (requireMicRef.current && micEnabled) return;
    const room = roomRef.current;
    if (!room) return;
    const next = !micEnabled;
    micWantedRef.current = next;
    await room.localParticipant.setMicrophoneEnabled(next);
    setMicEnabled(next);
  }, [micEnabled]);

  const toggleVideo = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    // Locked rounds: camera must stay on — ignore off attempts.
    if (lockCameraRef.current && videoEnabled) return;
    const next = !videoEnabled;
    cameraWantedRef.current = next;
    await room.localParticipant.setCameraEnabled(next);
    setVideoEnabled(next);
  }, [videoEnabled]);

  const toggleScreenShare = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    if (lockScreenShareRef.current && screenShareEnabled) {
      // Required rounds: screen share cannot be turned off.
      return;
    }
    const next = !screenShareEnabled;
    if (next) {
      screenWantedRef.current = true;
      await room.localParticipant.setScreenShareEnabled(true);
      setScreenReshareRequired(false);
    } else {
      screenWantedRef.current = false;
      const track = screenTrackRef.current;
      await room.localParticipant.setScreenShareEnabled(false);
      // stopLocalTrackOnUnpublish is off, so end the capture explicitly.
      track?.stop();
      screenTrackRef.current = null;
    }
    setScreenShareEnabled(next);
  }, [screenShareEnabled]);

  const reshareScreen = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    setReshareError(null);
    try {
      screenTrackRef.current = null;
      await room.localParticipant.setScreenShareEnabled(true);
      screenWantedRef.current = true;
      setScreenShareEnabled(true);
      setScreenReshareRequired(false);
      logLinkRef.current('livekit_screen_reshared', {});
    } catch (err) {
      setReshareError(
        err instanceof Error && err.message
          ? err.message
          : 'Screen share was not started. Please try again.',
      );
    }
  }, []);

  const beginIntentionalExit = useCallback(() => {
    intentionalExitRef.current = true;
    leftRef.current = true;
  }, []);

  const releaseIntentionalExit = useCallback(() => {
    intentionalExitRef.current = false;
    leftRef.current = false;
  }, []);

  const endInterview = useCallback(async (
    reason?: 'candidate_ended_interview' | 'proctor_termination',
  ) => {
    // Explicit Leave only: from here on a disconnect must not trigger an auto-rejoin.
    leftRef.current = true;
    try {
      await publishJson(
        reason ? { type: 'end_interview', reason } : { type: 'end_interview' },
      );
    } catch (err) {
      // A confirmed exit must stay left. Clearing this flag makes the room-delete
      // that follows Leave look like a network drop and shows "Reconnect".
      if (!intentionalExitRef.current) leftRef.current = false;
      throw err;
    }
  }, [publishJson]);

  // Hydrate media strikes from backend on mount/refresh; reset only when round changes.
  useEffect(() => {
    const nextKey = `${mode}:${phase}`;
    if (roundKeyRef.current !== nextKey) {
      roundKeyRef.current = nextKey;
      mediaStrikesRef.current = 0;
      setMediaStrikeCount(0);
      hydratedRef.current = false;
      commitRecovery(INITIAL_MEDIA_RECOVERY);
      outageActiveRef.current = false;
      revokedEventSentRef.current = false;
      graceDeadlineRef.current = null;
    }
    if (hydratedRef.current || !candidateToken || !enabled) return;
    let cancelled = false;
    void getAutonomousSession(candidateToken).then((session) => {
      if (cancelled) return;
      const summary = session.proctorSummary as Record<string, unknown> | null | undefined;
      const round = summary?.current_round_strikes as
        | { media_strikes?: number }
        | undefined;
      const fromRound =
        typeof round?.media_strikes === 'number' ? round.media_strikes : null;
      const fromLifetime =
        typeof summary?.media_strike_count === 'number'
          ? Number(summary.media_strike_count)
          : 0;
      const serverMax = session.proctorConfig?.maxMediaStrikes;
      const count = Math.max(0, fromRound ?? fromLifetime);
      mediaStrikesRef.current = count;
      setMediaStrikeCount(count);
      if (typeof serverMax === 'number' && serverMax >= 1) {
        /* FE UX still uses NEXT_PUBLIC_* for countdowns; BE auto-submit is authoritative */
      }
      hydratedRef.current = true;
    }).catch(() => {
      hydratedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [candidateToken, commitRecovery, enabled, mode, phase]);

  const confirmCoding = useCallback(async () => {
    await publishJson({ type: 'confirm_coding' });
  }, [publishJson]);

  const publishAssessmentComplete = useCallback(
    async (payload: { code_quality_score?: number; architectural_flaws?: string[] }) => {
      await publishJson({ type: 'assessment_complete', ...payload });
    },
    [publishJson],
  );

  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (
        event.reason?.message?.includes('leave request') || 
        event.reason?.message?.includes('already closed')
      ) {
        event.preventDefault(); // Suppress the Next.js error overlay
      }
    };
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  }, []);

  useEffect(() => {
    const onOnline = () => flushLinkLogs();
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [flushLinkLogs]);

  useEffect(() => {
    if (!enabled || !candidateToken) return;

    let cancelled = false;
    const abort = new AbortController();
    let agentFallbackTimer: ReturnType<typeof setTimeout> | undefined;
    let agentRestarts = 0;
    if (!intentionalExitRef.current) leftRef.current = false;

    void (async () => {
      setStatus('connecting');
      setError(null);
      try {
        const session = await getAutonomousSession(candidateToken);
        if (cancelled) return;
        if (session.proctorConfig) {
          proctorConfigRef.current = session.proctorConfig as Record<string, unknown>;
        }

        // candidate-ready (re)starts the agent, so it is called once per round start. A reload or
        // reopened link mid-round joins the running agent's room via /init instead.
        const startedKey = `${AGENT_STARTED_PREFIX}${candidateToken}:${mode}:${session.currentPhase}`;
        const joinViaInit = wasAgentStarted(startedKey);
        let livekitToken: string;
        let livekitUrl: string | null | undefined;
        let joinedRoomName: string | undefined;

        // Screen-share rounds must join the room and finish the browser share
        // dialog before candidate-ready. That call starts the agent, and the
        // opening question would otherwise play while the share modal is open.
        const shareBeforeAgent = lockScreenShareRef.current && !joinViaInit;

        if (joinViaInit || shareBeforeAgent) {
          const init = await initAutonomousSession(candidateToken);
          if (cancelled) return;
          if (!init.livekitToken) {
            throw new Error('Could not rejoin the interview room - no LiveKit token returned.');
          }
          livekitToken = init.livekitToken;
          livekitUrl = init.livekitUrl;
          joinedRoomName = init.roomName;
          logLinkRef.current(joinViaInit ? 'livekit_join_via_init' : 'livekit_join_before_screen_share', {
            phase: session.currentPhase,
            room: init.roomName,
          });
        } else {
          const ready = await notifyCandidateReady(candidateToken);
          if (cancelled) return;
          if (!ready.livekitToken) {
            throw new Error('Voice agent did not start - is the voice engine running?');
          }
          if (!ready.started && !ready.rejoin) {
            throw new Error('Voice agent did not start - is the voice engine running?');
          }
          markAgentStarted(startedKey);
          livekitToken = ready.livekitToken;
          livekitUrl = ready.livekitUrl;
          joinedRoomName = ready.roomName;
          logLinkRef.current('livekit_join_via_candidate_ready', {
            phase: session.currentPhase,
            room: ready.roomName,
            rejoin: Boolean(ready.rejoin),
          });
        }

        const wsUrl = resolveLiveKitUrl(livekitUrl);
        const room = await connectLiveKitRoom(wsUrl, livekitToken, {
          signal: abort.signal,
          resilient: true,
        });
        if (cancelled) {
          await disconnectLiveKitRoom(room);
          return;
        }

        room.on(RoomEvent.LocalTrackPublished, (publication) => {
          const mediaTrack = publication.track?.mediaStreamTrack ?? null;
          if (publication.source === Track.Source.ScreenShare) {
            screenTrackRef.current = mediaTrack;
            setScreenShareEnabled(true);
            setScreenReshareRequired(false);
          }
          if (publication.source === Track.Source.Camera && mediaTrack) {
            if (cameraTrackRef.current && cameraTrackRef.current !== mediaTrack) {
              cameraTrackRef.current.removeEventListener('ended', handleCameraEnded);
            }
            cameraTrackRef.current = mediaTrack;
            mediaTrack.addEventListener('ended', handleCameraEnded);
            setVideoEnabled(true);
          }
          if (publication.source === Track.Source.Microphone && mediaTrack) {
            if (micTrackRef.current && micTrackRef.current !== mediaTrack) {
              micTrackRef.current.removeEventListener('ended', handleMicEnded);
            }
            mediaTrack.addEventListener('ended', handleMicEnded);
            micTrackRef.current = mediaTrack;
          }
        });

        roomRef.current = room;
        setRoom(room);
        try {
          // Mic default on in all rounds including Build; Build soft-fails if denied
          // (requireMic is false there → no strike / no join block).
          try {
            await room.localParticipant.setMicrophoneEnabled(true);
            micWantedRef.current = true;
            setMicEnabled(true);
          } catch (micErr) {
            if (requireMicRef.current) {
              await disconnectLiveKitRoom(room);
              throw micErr;
            }
            micWantedRef.current = false;
            setMicEnabled(false);
          }
          await room.localParticipant.setCameraEnabled(true);
          setVideoEnabled(true);
        } catch (permErr) {
          await disconnectLiveKitRoom(room);
          throw new Error(mediaStartErrorMessage(permErr));
        }

        const screenTrack = initialScreenTrackRef.current;
        if (screenTrack && screenTrack.readyState === 'live') {
          screenWantedRef.current = true;
          try {
            await room.localParticipant.publishTrack(screenTrack, {
              source: Track.Source.ScreenShare,
            });
            setScreenShareEnabled(true);
          } catch {
            if (lockScreenShareRef.current) setScreenReshareRequired(true);
          }
        } else if (lockScreenShareRef.current) {
          screenWantedRef.current = true;
          setScreenReshareRequired(true);
        }

        if (shareBeforeAgent) {
          const ready = await notifyCandidateReady(candidateToken);
          if (cancelled) return;
          if (!ready.started && !ready.rejoin) {
            throw new Error('Voice agent did not start - is the voice engine running?');
          }
          markAgentStarted(startedKey);
          logLinkRef.current('livekit_agent_started_after_screen_share', {
            phase: session.currentPhase,
            room: ready.roomName,
          });
        }

        for (const participant of room.remoteParticipants.values()) {
          attachAgentParticipant(participant);
        }

        room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
          const source = publication.source;
          // Deferred: during a dropped connection livekit unpublishes every local track before the
          // room state flips to disconnected. Those are restored by the rejoin flow instead.
          window.setTimeout(() => {
            if (room.state !== ConnectionState.Connected) return;
            if (source === Track.Source.ScreenShare) {
              setScreenShareEnabled(false);
              if (screenWantedRef.current || lockScreenShareRef.current) {
                const live = screenTrackRef.current;
                if (live && live.readyState === 'live') {
                  void room.localParticipant
                    .publishTrack(live, { source: Track.Source.ScreenShare })
                    .catch(() => {
                      if (lockScreenShareRef.current) setScreenReshareRequired(true);
                    });
                } else if (lockScreenShareRef.current) {
                  screenTrackRef.current = null;
                  setScreenReshareRequired(true);
                  // Screen-share drop counts as a media strike (separate from camera/mic).
                  if (
                    !isRejoiningRef.current &&
                    !mediaSwapRef.current &&
                    !intentionalExitRef.current &&
                    !leftRef.current
                  ) {
                    const enableMedia =
                      typeof proctorConfigRef.current?.enableMediaStrikes === 'boolean'
                        ? proctorConfigRef.current.enableMediaStrikes
                        : isMediaStrikesEnabled();
                    const autoSubmitMedia =
                      typeof proctorConfigRef.current?.autoSubmitOnMediaStrike === 'boolean'
                        ? proctorConfigRef.current.autoSubmitOnMediaStrike
                        : isAutoSubmitOnMediaStrikeEnabled();
                    const maxMedia =
                      typeof proctorConfigRef.current?.maxMediaStrikes === 'number'
                        ? proctorConfigRef.current.maxMediaStrikes
                        : getMaxMediaStrikes();

                    if (enableMedia) {
                      mediaStrikesRef.current += 1;
                      setMediaStrikeCount(mediaStrikesRef.current);
                    }
                    const strike = mediaStrikesRef.current;
                    const terminated =
                      enableMedia &&
                      autoSubmitMedia &&
                      strike >= maxMedia;
                    void postInterviewProctorEvents(candidateToken, [
                      {
                        type: 'screen_share_dropped',
                        severity: 'critical',
                        client_ts: Date.now(),
                        payload: {
                          strike,
                          phase: phaseRef.current,
                          message: 'Screen share stopped / permission revoked',
                        },
                      },
                    ]).catch(() => {});
                    if (terminated) {
                      commitRecovery({
                        ...recoveryRef.current,
                        required: true,
                        strike,
                        terminated: true,
                        terminationReason: 'max_strikes_exceeded',
                      });
                    }
                  }
                } else {
                  screenWantedRef.current = false;
                }
              }
            }
            if (source === Track.Source.Camera && !isRejoiningRef.current && !mediaSwapRef.current) {
              setVideoEnabled(false);
              triggerMediaOutageRef.current('camera', 'track_ended');
            }
            if (
              source === Track.Source.Microphone &&
              !isRejoiningRef.current &&
              !mediaSwapRef.current
            ) {
              setMicEnabled(false);
              // Build / optional-mic: triggerMediaOutage no-ops when requireMic is false.
              triggerMediaOutageRef.current('mic', 'track_ended');
            }
          }, 0);
        });

        room.on(RoomEvent.Disconnected, () => {
          // A new subscription after rejoin may reuse the old track sid; force a fresh attach.
          agentAudioTrackSidRef.current = null;
          setAgentConnected(false);
        });

        room.on(RoomEvent.TrackSubscribed, (track, pub, participant) => {
          if (track.kind !== Track.Kind.Audio) return;
          if (participant.identity.startsWith('agent-')) {
            attachAgentAudio(track);
            return;
          }
          if (participant.identity.startsWith('admin-')) {
            attachAdminAudio(track, pub.trackSid);
          }
        });

        room.on(RoomEvent.DataReceived, (payload, participant) => {
          const identity = participant?.identity ?? '';
          if (!identity.startsWith('admin-')) return;
          const data = parseProctorData(payload);
          if (!isProctorIntervention(data)) return;
          applyProctorIntervention(data.action);
        });

        const scheduleAgentRestart = (roomToWatch: Room, delayMs: number, reason: string) => {
          if (agentFallbackTimer) clearTimeout(agentFallbackTimer);
          agentFallbackTimer = setTimeout(() => {
            if (cancelled || leftRef.current || roomRef.current !== roomToWatch || hasAgentParticipant(roomToWatch)) {
              return;
            }
            if (agentRestarts >= AGENT_RESTART_LIMIT) {
              logLinkRef.current('livekit_agent_missing', { phase: session.currentPhase, reason });
              return;
            }
            agentRestarts += 1;
            logLinkRef.current('livekit_agent_missing_restart', {
              phase: session.currentPhase,
              reason,
              attempt: agentRestarts,
            });
            void (async () => {
              try {
                const ready = await notifyCandidateReady(candidateToken);
                if (cancelled || !ready.started) return;
                markAgentStarted(startedKey);
                if (ready.livekitToken && ready.roomName && joinedRoomName && ready.roomName !== joinedRoomName) {
                  await roomToWatch.disconnect(false);
                  await roomToWatch.connect(resolveLiveKitUrl(ready.livekitUrl), ready.livekitToken, LIVEKIT_CONNECT_OPTIONS);
                  await republishAfterRejoin(roomToWatch);
                }
              } catch (err) {
                logLinkRef.current('livekit_agent_restart_failed', {
                  error: err instanceof Error ? err.message : String(err),
                });
              }
            })();
          }, delayMs);
        };

        room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
          if (participant.identity.startsWith('agent-') && agentFallbackTimer) {
            clearTimeout(agentFallbackTimer);
            agentFallbackTimer = undefined;
          }
          attachAgentParticipant(participant);
        });

        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          if (participant.identity.startsWith('agent-')) {
            setAgentConnected(false);
            scheduleAgentRestart(room, AGENT_REJOIN_GRACE_MS, 'agent_left');
          }
        });

        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          const agentSpeaking = speakers.some((s) => s.identity.startsWith('agent-'));
          setStatus((prev) => {
            if (agentSpeaking) return 'agent_speaking';
            if (prev === 'agent_speaking' || prev === 'live') return 'live';
            return prev;
          });
        });

        const hasAgent = hasAgentParticipant(room);
        setStatus(hasAgent ? 'live' : 'waiting_agent');

        if (!hasAgent) {
          scheduleAgentRestart(
            room,
            joinViaInit ? AGENT_REJOIN_GRACE_MS : AGENT_FIRST_START_GRACE_MS,
            joinViaInit ? 'rejoin' : 'initial',
          );
        }
      } catch (err) {
        if (cancelled || abort.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        const hint = isRecoverableLiveKitError(message)
          ? `${message} - ensure LiveKit host is running.`
          : message;
        setError(hint);
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      if (agentFallbackTimer) clearTimeout(agentFallbackTimer);
      const activeRoom = roomRef.current;
      roomRef.current = null;
      setRoom(null);
      agentAudioTrackSidRef.current = null;
      agentAudioRef.current = null;
      void disconnectLiveKitRoom(activeRoom);
      const pendingScreen = initialScreenTrackRef.current;
      if (pendingScreen && pendingScreen !== screenTrackRef.current) {
        pendingScreen.stop();
      }
      const generation = ++rejoinGenerationRef.current;
      isRejoiningRef.current = true;
      safeStopTrack(cameraTrackRef.current, handleCameraEnded);
      safeStopTrack(micTrackRef.current, handleMicEnded);
      cameraTrackRef.current = null;
      micTrackRef.current = null;
      screenTrackRef.current?.stop();
      screenTrackRef.current = null;
      window.setTimeout(() => {
        if (rejoinGenerationRef.current === generation) isRejoiningRef.current = false;
      }, 1000);
    };
    // Only a new token or enabling the room may connect or tear it down.
    // Mode and camera/screen locks are read through refs so mid-round changes do not disconnect.
    // Media ended handlers are stable refs, so they must not reconnect the room.
  }, [candidateToken, enabled]);

  const reacquireBusyRef = useRef(false);

  const reacquireMedia = useCallback(async () => {
    const current = recoveryRef.current;
    if (!outageActiveRef.current || current.terminated || reacquireBusyRef.current) return;
    const room = roomRef.current;
    if (!room) return;

    const cameraMissing = current.cameraMissing && requireCameraRef.current;
    const micMissing = current.micMissing && requireMicRef.current;
    if (!cameraMissing && !micMissing) return;

    const swapGeneration = ++mediaSwapGenerationRef.current;
    mediaSwapRef.current = true;
    reacquireBusyRef.current = true;
    setReacquireBusy(true);

    try {
      if (cameraMissing) cameraTrackRef.current?.removeEventListener('ended', handleCameraEnded);
      if (micMissing) micTrackRef.current?.removeEventListener('ended', handleMicEnded);

      const pending: { kind: MediaDeviceKind; promise: Promise<unknown> }[] = [];
      if (cameraMissing) {
        pending.push({ kind: 'camera', promise: room.localParticipant.setCameraEnabled(true) });
      }
      if (micMissing) {
        pending.push({ kind: 'mic', promise: room.localParticipant.setMicrophoneEnabled(true) });
      }

      const results = await Promise.allSettled(pending.map((entry) => entry.promise));

      let nextCameraMissing = current.cameraMissing;
      let nextMicMissing = current.micMissing;
      let cameraError = current.cameraError;
      let micError = current.micError;

      results.forEach((result, index) => {
        const kind = pending[index]?.kind;
        if (!kind) return;
        if (result.status === 'fulfilled') {
          const source = kind === 'camera' ? Track.Source.Camera : Track.Source.Microphone;
          const publication = room.localParticipant.getTrackPublication(source);
          const live = publication?.track?.mediaStreamTrack?.readyState === 'live';
          if (kind === 'camera') {
            nextCameraMissing = !live;
            cameraError = live ? null : 'busy';
            if (live) setVideoEnabled(true);
          } else {
            nextMicMissing = !live;
            micError = live ? null : 'busy';
            if (live) setMicEnabled(true);
          }
          return;
        }
        const classified = classifyMediaError(result.reason);
        if (kind === 'camera') {
          nextCameraMissing = true;
          cameraError = classified;
          setVideoEnabled(false);
        } else {
          nextMicMissing = true;
          micError = classified;
          setMicEnabled(false);
        }
      });

      const cameraOk = !requireCameraRef.current || !nextCameraMissing;
      const micOk = !requireMicRef.current || !nextMicMissing;
      if (cameraOk && micOk) {
        const startedAt = outageStartedAtRef.current ?? Date.now();
        const restored: string[] = [];
        if (requireCameraRef.current) restored.push('camera');
        if (requireMicRef.current) restored.push('microphone');
        outageActiveRef.current = false;
        revokedEventSentRef.current = false;
        graceDeadlineRef.current = null;
        setGraceSecondsLeft(getMediaGraceSeconds());
        commitRecovery({
          ...recoveryRef.current,
          required: false,
          cameraMissing: false,
          micMissing: false,
          isHardBlocked: false,
          attempted: false,
          cameraError: null,
          micError: null,
          terminated: false,
          terminationReason: null,
        });
        void postInterviewProctorEvents(candidateToken, [
          {
            type: 'media_permission_restored',
            severity: 'info',
            client_ts: Date.now(),
            payload: {
              restored,
              strike: mediaStrikesRef.current,
              duration_ms: Date.now() - startedAt,
              phase: phaseRef.current,
            },
          },
        ]).catch(() => {});
        return;
      }

      commitRecovery({
        ...recoveryRef.current,
        required: true,
        attempted: true,
        cameraMissing: nextCameraMissing,
        micMissing: nextMicMissing,
        cameraError,
        micError,
        isHardBlocked: cameraError === 'permission' || micError === 'permission',
      });
    } finally {
      reacquireBusyRef.current = false;
      setReacquireBusy(false);
      window.setTimeout(() => {
        if (mediaSwapGenerationRef.current === swapGeneration) mediaSwapRef.current = false;
      }, 1000);
    }
  }, [candidateToken, commitRecovery, handleCameraEnded, handleMicEnded]);

  const reacquireMediaRef = useRef(reacquireMedia);
  reacquireMediaRef.current = reacquireMedia;

  useEffect(() => {
    if (requireCamera || requireMic) return;
    if (!recoveryRef.current.required || recoveryRef.current.terminated) return;
    outageActiveRef.current = false;
    revokedEventSentRef.current = false;
    graceDeadlineRef.current = null;
    commitRecovery({
      ...INITIAL_MEDIA_RECOVERY,
      strike: mediaStrikesRef.current,
    });
  }, [commitRecovery, requireCamera, requireMic]);

  useEffect(() => {
    if (!mediaRecovery.required || mediaRecovery.terminated) return;
    if (
      isAutoSubmitOnMediaStrikeEnabled() &&
      mediaRecovery.strike >= getMaxMediaStrikes()
    ) {
      return;
    }
    const tick = () => {
      const deadline = graceDeadlineRef.current;
      if (deadline == null || recoveryRef.current.terminated) return;
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setGraceSecondsLeft((prev) => (prev === left ? prev : left));
      const enableMedia =
        typeof proctorConfigRef.current?.enableMediaStrikes === 'boolean'
          ? proctorConfigRef.current.enableMediaStrikes
          : isMediaStrikesEnabled();
      const autoSubmitMedia =
        typeof proctorConfigRef.current?.autoSubmitOnMediaStrike === 'boolean'
          ? proctorConfigRef.current.autoSubmitOnMediaStrike
          : isAutoSubmitOnMediaStrikeEnabled();

      if (left > 0) return;
      if (!enableMedia || !autoSubmitMedia) return;
      commitRecovery({
        ...recoveryRef.current,
        required: true,
        terminated: true,
        terminationReason: 'grace_timeout',
      });
    };
    tick();
    const id = window.setInterval(tick, 250);
    return () => window.clearInterval(id);
  }, [commitRecovery, mediaRecovery.required, mediaRecovery.strike, mediaRecovery.terminated]);

  useEffect(() => {
    const element = agentAudioRef.current;
    if (!element) return;
    if (proctorInterventionActive || mediaRecovery.required) {
      element.volume = 0;
      return;
    }
    element.volume = 1;
  }, [mediaRecovery.required, proctorInterventionActive]);

  useEffect(() => {
    publishProctorTelemetry();
  }, [
    mediaRecovery.required,
    mediaRecovery.strike,
    graceSecondsLeft,
    publishProctorTelemetry,
  ]);

  useEffect(() => {
    let cancelled = false;
    const wired: PermissionStatus[] = [];

    const wire = async (name: 'camera' | 'microphone', kind: MediaDeviceKind) => {
      try {
        const status = await navigator.permissions.query({ name: name as PermissionName });
        if (cancelled) return;
        if (kind === 'camera') cameraPermissionStatusRef.current = status;
        else micPermissionStatusRef.current = status;
        status.onchange = () => {
          if (status.state === 'denied') {
            triggerMediaOutageRef.current(kind, 'permission_denied');
            return;
          }
          if (status.state === 'granted') {
            const prev = recoveryRef.current;
            if (!prev.required || prev.terminated) return;
            const otherRequired = kind === 'camera' ? requireMicRef.current : requireCameraRef.current;
            const other = kind === 'camera' ? micPermissionStatusRef.current : cameraPermissionStatusRef.current;
            if (otherRequired && other?.state === 'denied') {
              commitRecovery({ ...prev, isHardBlocked: true });
              return;
            }
            commitRecovery({ ...prev, isHardBlocked: false });
            if (!reacquireBusyRef.current) {
              void reacquireMediaRef.current();
            }
          }
        };
        wired.push(status);
      } catch {
        /* Safari and older Firefox do not support camera/microphone permission queries. */
      }
    };

    if (requireCamera) void wire('camera', 'camera');
    if (requireMic) void wire('microphone', 'mic');
    return () => {
      cancelled = true;
      for (const status of wired) status.onchange = null;
    };
  }, [commitRecovery, requireCamera, requireMic]);

  useEffect(() => {
    if (!mediaRecovery.required || mediaRecovery.terminated) return;

    const retryIfIdle = () => {
      if (!recoveryRef.current.required || recoveryRef.current.terminated || reacquireBusyRef.current) return;
      void reacquireMediaRef.current();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') retryIfIdle();
    };

    window.addEventListener('focus', retryIfIdle);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', retryIfIdle);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mediaRecovery.required, mediaRecovery.terminated]);

  const value: InterviewRoomContextValue = {
    room,
    status,
    error,
    micEnabled,
    videoEnabled,
    screenShareEnabled,
    forceCamera: lockCamera,
    forceScreenShare: lockScreenShare,
    agentConnected,
    connectionState: link.state,
    screenReshareRequired,
    requireMic,
    requireCamera,
    mediaRecoveryRequired: mediaRecovery.required,
    mediaRecovery,
    graceSecondsLeft,
    proctorInterventionActive,
    reacquireMedia,
    toggleMic,
    toggleVideo,
    toggleScreenShare,
    endInterview,
    mediaStrikeCount,
    beginIntentionalExit,
    releaseIntentionalExit,
    confirmCoding,
    publishAssessmentComplete,
    publishJson,
    attachAgentAudio,
    publishProctorTelemetry,
  };

  return (
    <InterviewRoomContext.Provider value={value}>
      <div ref={audioContainerRef} className="hidden" aria-hidden />
      <div ref={adminAudioHostRef} className="hidden" aria-hidden />
      {room ? <LiveKitConnectionBanner link={link} onReconnectNow={reconnectNow} /> : null}
      {room && screenReshareRequired && link.state === 'connected' ? (
        <ScreenShareRequiredOverlay onShare={() => void reshareScreen()} error={reshareError} />
      ) : null}
      <MediaPermissionGateModal
        recovery={mediaRecovery}
        graceSecondsLeft={graceSecondsLeft}
        requireCamera={requireCamera}
        requireMic={requireMic}
        busy={reacquireBusy}
        onReacquire={() => void reacquireMedia()}
      />
      {children}
    </InterviewRoomContext.Provider>
  );
}

export function useInterviewRoom(): InterviewRoomContextValue {
  const ctx = useContext(InterviewRoomContext);
  if (!ctx) {
    throw new Error('useInterviewRoom must be used within InterviewRoomProvider');
  }
  return ctx;
}

export function useOptionalInterviewRoom(): InterviewRoomContextValue | null {
  return useContext(InterviewRoomContext);
}
