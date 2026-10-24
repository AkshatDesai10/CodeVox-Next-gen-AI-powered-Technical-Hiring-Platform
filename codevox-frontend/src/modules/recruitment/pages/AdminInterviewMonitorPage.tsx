'use client';

import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RecruitmentOpsShell } from '@/modules/recruitment/components/RecruitmentOpsShell';
import {
  createAdminInterviewMonitorJoin,
  forceAdvanceProjectInterview,
  getProjectInterviewEvalStatus,
  type AdminInterviewMonitorJoin,
  type ProjectInterviewEvalStatus,
} from '@/modules/recruitment/lib/recruitment-api';
import {
  connectLiveKitRoom,
  disconnectLiveKitRoom,
  reachableLiveKitUrl,
} from '@/modules/autonomous-interview/lib/livekit-session';
import { useLiveKitRejoin } from '@/modules/autonomous-interview/lib/use-livekit-rejoin';
import { LiveKitConnectionBanner } from '@/modules/autonomous-interview/components/LiveKitConnectionBanner';
import { postInterviewProctorEvents } from '@/modules/autonomous-interview/lib/autonomous-interview-api';
import {
  encodeProctorData,
  isProctorTelemetry,
  parseProctorData,
  PROCTOR_INTERVENTION_TYPE,
} from '@/modules/autonomous-interview/lib/proctor-intervention';

function publicLiveKitUrl(url: string) {
  return reachableLiveKitUrl(url);
}

function formatElapsed(totalSeconds: number) {
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatClock(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function AdminInterviewMonitorPage() {
  const params = useParams();
  const search = useSearchParams();
  const token = String(params?.token ?? '');
  const initialRound = search.get('round') ?? undefined;

  const [roundType, setRoundType] = useState<string | undefined>(initialRound);
  const [join, setJoin] = useState<AdminInterviewMonitorJoin | null>(null);
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hasCamera, setHasCamera] = useState(false);
  const [hasScreen, setHasScreen] = useState(false);
  const [remoteLabels, setRemoteLabels] = useState<string[]>([]);
  const [reconnectKey, setReconnectKey] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const [monitorRoom, setMonitorRoom] = useState<Room | null>(null);
  const cameraRef = useRef<HTMLVideoElement | null>(null);
  const screenRef = useRef<HTMLVideoElement | null>(null);
  const audioHostRef = useRef<HTMLDivElement | null>(null);
  const pendingCamera = useRef<RemoteTrack | null>(null);
  const pendingScreen = useRef<RemoteTrack | null>(null);

  const [activeTab, setActiveTab] = useState<'split' | 'screen' | 'camera'>('split');
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [showResume, setShowResume] = useState(false);
  const [pttActive, setPttActive] = useState(false);
  const [pttError, setPttError] = useState<string | null>(null);
  const [flagFlash, setFlagFlash] = useState<string | null>(null);
  const [flagBusy, setFlagBusy] = useState(false);
  const [flagCount, setFlagCount] = useState(0);
  const [elapsedLabel, setElapsedLabel] = useState('00:00');

  const [strikeCount, setStrikeCount] = useState(0);
  const [maxStrikes, setMaxStrikes] = useState(5);
  const [lookingAway, setLookingAway] = useState(false);
  const [multiFaceAt, setMultiFaceAt] = useState<string | null>(null);
  const [multiFaceDismissed, setMultiFaceDismissed] = useState(false);
  const [mediaOutage, setMediaOutage] = useState(false);
  const [graceSecondsLeft, setGraceSecondsLeft] = useState(0);
  const [evalStatus, setEvalStatus] = useState<ProjectInterviewEvalStatus | null>(null);
  const [forceAdvanceBusy, setForceAdvanceBusy] = useState(false);
  const [forceAdvanceError, setForceAdvanceError] = useState<string | null>(null);

  const pttActiveRef = useRef(false);
  const sessionStartMsRef = useRef<number | null>(null);
  const multiFaceCleanLatchRef = useRef(0);
  const candidateInRoomRef = useRef(false);

  const setCameraEl = useCallback((el: HTMLVideoElement | null) => {
    cameraRef.current = el;
    if (el && pendingCamera.current) {
      pendingCamera.current.attach(el);
      void el.play().catch(() => undefined);
      setHasCamera(true);
    }
  }, []);

  const setScreenEl = useCallback((el: HTMLVideoElement | null) => {
    screenRef.current = el;
    if (el && pendingScreen.current) {
      pendingScreen.current.attach(el);
      void el.play().catch(() => undefined);
      setHasScreen(true);
    }
  }, []);

  const attachAudio = useCallback((track: RemoteTrack, trackSid: string) => {
    const host = audioHostRef.current;
    if (!host) return;
    let el = host.querySelector(`audio[data-sid="${trackSid}"]`) as HTMLAudioElement | null;
    if (!el) {
      el = document.createElement('audio');
      el.autoplay = true;
      (el as HTMLAudioElement & { playsInline?: boolean }).playsInline = true;
      el.dataset.sid = trackSid;
      host.appendChild(el);
    }
    track.attach(el);
    void el.play().catch(() => undefined);
  }, []);

  const attachVideo = useCallback((track: RemoteTrack, source: Track.Source | undefined) => {
    const isScreen = source === Track.Source.ScreenShare;
    if (isScreen) {
      pendingScreen.current = track;
      if (screenRef.current) {
        track.attach(screenRef.current);
        void screenRef.current.play().catch(() => undefined);
        setHasScreen(true);
      }
      return;
    }
    pendingCamera.current = track;
    if (cameraRef.current) {
      track.attach(cameraRef.current);
      void cameraRef.current.play().catch(() => undefined);
      setHasCamera(true);
    }
  }, []);

  const refreshLabels = useCallback((room: Room) => {
    const labels = [...room.remoteParticipants.values()].map((p) => {
      const pubs = [...p.trackPublications.values()]
        .filter((pub) => pub.kind)
        .map((pub) => `${pub.source ?? pub.kind}${pub.isSubscribed ? '' : '(unsub)'}`)
        .join(',');
      return `${p.identity}${pubs ? ` [${pubs}]` : ''}`;
    });
    setRemoteLabels(labels);
  }, []);

  const ingestPublication = useCallback(
    (participant: RemoteParticipant, pub: RemoteTrackPublication) => {
      if (!pub.isSubscribed) {
        try {
          pub.setSubscribed(true);
        } catch {
          /* ignore */
        }
      }
      if (!pub.track) return;
      if (pub.track.kind === Track.Kind.Audio) {
        attachAudio(pub.track, pub.trackSid);
      } else if (pub.track.kind === Track.Kind.Video) {
        attachVideo(pub.track, pub.source);
      }
    },
    [attachAudio, attachVideo],
  );

  const syncRemotes = useCallback(
    (room: Room) => {
      refreshLabels(room);
      for (const participant of room.remoteParticipants.values()) {
        for (const pub of participant.trackPublications.values()) {
          ingestPublication(participant, pub);
        }
      }
    },
    [ingestPublication, refreshLabels],
  );

  const refreshJoin = useCallback(async () => {
    if (!token) return null;
    const data = await createAdminInterviewMonitorJoin(token, roundType);
    setJoin(data);
    setStrikeCount(data.strikeCount ?? 0);
    setMaxStrikes(data.maxStrikes ?? 5);
    // Always re-sync from server: clock = candidate round enter time, not admin open time.
    if (data.sessionStartedAt) {
      const started = Date.parse(data.sessionStartedAt);
      sessionStartMsRef.current = Number.isFinite(started) ? started : null;
    } else {
      sessionStartMsRef.current = null;
    }
    return data;
  }, [token, roundType]);

  const getMonitorCredentials = useCallback(async () => {
    const data = await refreshJoin();
    if (!data?.livekitToken) throw new Error('No monitor token returned.');
    return {
      url: publicLiveKitUrl(
        data.livekitUrl || process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7885',
      ),
      token: data.livekitToken,
    };
  }, [refreshJoin]);

  // Build & Defend: poll AI eval status so recruiters can force-advance if stuck.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const lookup = join?.candidateToken || token;
    const tick = async () => {
      try {
        const data = await getProjectInterviewEvalStatus(lookup);
        if (!cancelled) {
          setEvalStatus(data);
          setForceAdvanceError(null);
        }
      } catch {
        // Not a project-interview session (or no submission yet) — hide the pill.
        if (!cancelled) setEvalStatus(null);
      }
    };
    void tick();
    const id = window.setInterval(() => void tick(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token, join?.candidateToken]);

  const onForceAdvance = useCallback(async () => {
    if (!token || forceAdvanceBusy) return;
    setForceAdvanceBusy(true);
    setForceAdvanceError(null);
    try {
      const lookup = join?.candidateToken || token;
      const result = await forceAdvanceProjectInterview(lookup);
      setEvalStatus((prev) =>
        prev
          ? {
              ...prev,
              status: result.new_status,
              can_force_advance: false,
              interview_token: result.interview_token ?? prev.interview_token,
            }
          : prev,
      );
    } catch (err) {
      setForceAdvanceError(err instanceof Error ? err.message : 'Force advance failed');
    } finally {
      setForceAdvanceBusy(false);
    }
  }, [token, join?.candidateToken, forceAdvanceBusy]);

  const { link, reconnectNow } = useLiveKitRejoin({
    room: monitorRoom,
    shouldRejoin: () => roomRef.current !== null,
    getCredentials: getMonitorCredentials,
    onRejoined: (room) => {
      syncRemotes(room);
      window.setTimeout(() => {
        if (roomRef.current === room) syncRemotes(room);
      }, 800);
    },
    log: (type, payload) => console.info(`[livekit monitor] ${type}`, payload),
  });

  const publishIntervention = useCallback(async (action: 'PAUSE' | 'RESUME') => {
    const room = roomRef.current;
    if (!room) throw new Error('Monitor room is not connected.');
    const payload = encodeProctorData({
      type: PROCTOR_INTERVENTION_TYPE,
      action,
      timestamp: Date.now(),
      admin: 'Admin Monitor',
    });
    await room.localParticipant.publishData(payload as any, { reliable: true });
  }, []);

  const startPtt = useCallback(async () => {
    if (pttActiveRef.current) return;
    setPttError(null);
    const room = roomRef.current;
    if (!room || status !== 'live' || room.state !== ConnectionState.Connected) {
      setPttError('Wait until the monitor is connected.');
      return;
    }
    if (!candidateInRoomRef.current) {
      setPttError('Candidate has not joined this round yet. Wait until their feed is live.');
      return;
    }
    try {
      // PAUSE first so the candidate freezes before hearing admin audio.
      await publishIntervention('PAUSE');
      await room.localParticipant.setMicrophoneEnabled(true);
      pttActiveRef.current = true;
      setPttActive(true);
    } catch (err) {
      try {
        await room.localParticipant.setMicrophoneEnabled(false);
      } catch {
        /* ignore */
      }
      try {
        await publishIntervention('RESUME');
      } catch {
        /* ignore */
      }
      setPttError(
        err instanceof Error
          ? err.message
          : 'Could not enable microphone. Check browser mic permission.',
      );
      pttActiveRef.current = false;
      setPttActive(false);
    }
  }, [publishIntervention, status]);

  const stopPtt = useCallback(async () => {
    if (!pttActiveRef.current) return;
    const room = roomRef.current;
    pttActiveRef.current = false;
    setPttActive(false);
    try {
      if (room) {
        await room.localParticipant.setMicrophoneEnabled(false);
        await publishIntervention('RESUME');
      }
    } catch (err) {
      setPttError(err instanceof Error ? err.message : 'Failed to resume interview after speaking.');
    }
  }, [publishIntervention]);

  const handleFlagMoment = useCallback(async () => {
    if (!join?.candidateToken || flagBusy) return;
    if (!candidateInRoomRef.current) {
      setPttError('Candidate has not joined this round yet. Flag moments are only for live sessions.');
      return;
    }
    setFlagBusy(true);
    const started = sessionStartMsRef.current ?? Date.now();
    const timestampSeconds = Math.max(0, Math.floor((Date.now() - started) / 1000));
    const label = formatElapsed(timestampSeconds);
    try {
      await postInterviewProctorEvents(join.candidateToken, [
        {
          type: 'admin_flagged_moment',
          severity: 'info',
          payload: {
            timestamp_seconds: timestampSeconds,
            elapsed_label: label,
            flagged_by: 'admin',
          },
          client_ts: Date.now(),
        },
      ]);
      setFlagCount((n) => n + 1);
      setFlagFlash(`Flagged at ${label}`);
      window.setTimeout(() => setFlagFlash(null), 2000);
    } catch (err) {
      setPttError(err instanceof Error ? err.message : 'Failed to save flag moment.');
    } finally {
      setFlagBusy(false);
    }
  }, [flagBusy, join?.candidateToken]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return;
      if (!candidateInRoomRef.current) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      e.preventDefault();
      void startPtt();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      void stopPtt();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [startPtt, stopPtt]);

  useEffect(() => {
    if (!showResume) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowResume(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showResume]);

  useEffect(() => {
    let cancelled = false;
    const abort = new AbortController();
    let pollId: ReturnType<typeof setInterval> | undefined;

    void (async () => {
      if (!token) return;
      setStatus('connecting');
      setError(null);
      setHasCamera(false);
      setHasScreen(false);
      setRemoteLabels([]);
      pendingCamera.current = null;
      pendingScreen.current = null;
      pttActiveRef.current = false;
      setPttActive(false);
      try {
        const data = await refreshJoin();
        if (cancelled || !data) return;

        const wsUrl = publicLiveKitUrl(
          data.livekitUrl || process.env.NEXT_PUBLIC_LIVEKIT_URL || 'ws://localhost:7885',
        );
        const room = await connectLiveKitRoom(wsUrl, data.livekitToken, {
          signal: abort.signal,
          resilient: true,
        });
        if (cancelled) {
          await disconnectLiveKitRoom(room);
          return;
        }
        roomRef.current = room;
        setMonitorRoom(room);

        try {
          await room.localParticipant.setMicrophoneEnabled(false);
          await room.localParticipant.setCameraEnabled(false);
          await room.localParticipant.setScreenShareEnabled(false);
        } catch {
          /* ignore */
        }

        room.on(RoomEvent.TrackSubscribed, (track, pub) => {
          if (track.kind === Track.Kind.Audio) attachAudio(track, pub.trackSid);
          if (track.kind === Track.Kind.Video) attachVideo(track, pub.source);
          refreshLabels(room);
        });
        room.on(RoomEvent.TrackPublished, (_pub, participant) => {
          for (const pub of participant.trackPublications.values()) {
            ingestPublication(participant, pub);
          }
          refreshLabels(room);
        });
        room.on(RoomEvent.ParticipantConnected, () => syncRemotes(room));
        room.on(RoomEvent.ParticipantDisconnected, (participant) => {
          refreshLabels(room);
          if (participant.identity.startsWith('candidate-') || participant.identity.startsWith('ses_')) {
            pendingCamera.current = null;
            pendingScreen.current = null;
            setHasCamera(false);
            setHasScreen(false);
          }
        });
        room.on(RoomEvent.TrackUnsubscribed, (track, pub) => {
          refreshLabels(room);
          if (track.kind !== Track.Kind.Video) return;
          if (pub.source === Track.Source.ScreenShare) {
            pendingScreen.current = null;
            setHasScreen(false);
          } else if (pub.source === Track.Source.Camera) {
            pendingCamera.current = null;
            setHasCamera(false);
          }
        });
        room.on(RoomEvent.DataReceived, (payload, participant) => {
          const identity = participant?.identity ?? '';
          if (identity.startsWith('admin-') || identity.startsWith('agent-')) return;
          const dataMsg = parseProctorData(payload);
          if (!isProctorTelemetry(dataMsg)) return;
          setStrikeCount(dataMsg.strikeCount);
          setMaxStrikes(dataMsg.maxStrikes);
          setLookingAway(Boolean(dataMsg.lookingAway));
          setMediaOutage(Boolean(dataMsg.mediaOutage));
          setGraceSecondsLeft(Number(dataMsg.graceSecondsLeft) || 0);
          if (dataMsg.multiFace) {
            multiFaceCleanLatchRef.current = 0;
            const label =
              typeof dataMsg.multiFaceAt === 'string' && dataMsg.multiFaceAt
                ? dataMsg.multiFaceAt
                : formatClock(dataMsg.timestamp);
            setMultiFaceAt((prev) => prev ?? label);
            setMultiFaceDismissed(false);
          } else {
            multiFaceCleanLatchRef.current += 1;
            if (multiFaceCleanLatchRef.current >= 10) {
              setMultiFaceAt(null);
              setMultiFaceDismissed(false);
            }
          }
        });

        syncRemotes(room);
        window.setTimeout(() => {
          if (!cancelled && roomRef.current === room) syncRemotes(room);
        }, 800);
        pollId = setInterval(() => {
          if (!cancelled && roomRef.current === room) syncRemotes(room);
        }, 3000);

        setStatus('live');
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err instanceof Error ? err.message : String(err));
        }
      }
    })();

    return () => {
      cancelled = true;
      abort.abort();
      if (pollId) clearInterval(pollId);
      const activeRoom = roomRef.current;
      roomRef.current = null;
      setMonitorRoom(null);
      void disconnectLiveKitRoom(activeRoom);
    };
  }, [
    token,
    roundType,
    reconnectKey,
    refreshJoin,
    attachAudio,
    attachVideo,
    ingestPublication,
    refreshLabels,
    syncRemotes,
  ]);

  const rounds = join?.rounds ?? [];
  const title = useMemo(() => {
    const round = join?.roundType ?? roundType ?? 'interview';
    return String(round).replace(/_/g, ' ');
  }, [join?.roundType, roundType]);

  const candidateInRoom = useMemo(() => {
    if (hasCamera || hasScreen) return true;
    return remoteLabels.some((label) => {
      const id = label.split(' ')[0] ?? '';
      return id.startsWith('candidate-') || id.startsWith('ses_');
    });
  }, [hasCamera, hasScreen, remoteLabels]);

  candidateInRoomRef.current = candidateInRoom;

  // Elapsed / Flag clock only runs while the candidate is actually in the LiveKit room.
  useEffect(() => {
    const tick = () => {
      if (!candidateInRoomRef.current) {
        setElapsedLabel('--:--');
        return;
      }
      const started = sessionStartMsRef.current;
      if (!started) {
        setElapsedLabel('00:00');
        return;
      }
      setElapsedLabel(formatElapsed(Math.max(0, Math.floor((Date.now() - started) / 1000))));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [candidateInRoom]);

  // If candidate leaves mid-PTT, force release so we don't keep publishing into an empty room.
  useEffect(() => {
    if (!candidateInRoom && pttActiveRef.current) {
      void stopPtt();
    }
  }, [candidateInRoom, stopPtt]);

  const interventionsReady = status === 'live' && candidateInRoom;
  const candidateLabel = join?.candidateName?.trim() || 'Candidate';
  const showMultiFace = Boolean(multiFaceAt) && !multiFaceDismissed;
  const resumeUrl = join?.resumeUrl?.trim() || null;

  const linkLabel =
    status === 'live' && link.state !== 'connected'
      ? `Reconnecting · ${link.state}`
      : status === 'live' && !candidateInRoom
        ? 'Monitor connected · waiting for candidate'
        : status === 'live'
          ? `Live · ${remoteLabels.length} remote${remoteLabels.length === 1 ? '' : 's'}`
          : status === 'error'
            ? 'Connection error'
            : status === 'connecting'
              ? 'Connecting…'
              : 'Idle';

  return (
    <RecruitmentOpsShell>
      <div className="-mx-2 flex min-h-[calc(100vh-5rem)] flex-col gap-3 sm:-mx-0">
        {/* Top bar */}
        <header className="rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-4 py-3 shadow-sm sm:px-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
                    interventionsReady
                      ? 'bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/25'
                      : status === 'live'
                        ? 'bg-amber-500/15 text-amber-800 ring-1 ring-amber-500/25'
                        : 'bg-slate-500/10 text-slate-600 ring-1 ring-slate-500/15'
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      interventionsReady
                        ? 'animate-pulse bg-emerald-500'
                        : status === 'live'
                          ? 'animate-pulse bg-amber-500'
                          : 'bg-slate-400'
                    }`}
                  />
                  {interventionsReady ? 'Live session' : status === 'live' ? 'Waiting' : status}
                </span>
                <h1 className="truncate text-base font-bold tracking-tight text-[var(--assessment-on-surface)] sm:text-lg">
                  {candidateLabel}
                </h1>
                <span className="hidden text-[var(--assessment-outline)] sm:inline">·</span>
                <span className="text-xs font-medium capitalize text-[var(--assessment-on-surface-variant)]">
                  {title}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--assessment-surface-container)] px-2 py-1 font-mono text-xs font-semibold tabular-nums text-[var(--assessment-on-surface)]">
                  <svg className="h-3.5 w-3.5 text-[var(--assessment-on-surface-variant)]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {elapsedLabel}
                </span>
                {flagCount > 0 ? (
                  <span className="rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] font-bold text-rose-700 ring-1 ring-rose-500/20">
                    {flagCount} flagged
                  </span>
                ) : null}
                {evalStatus?.status === 'evaluating_code' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-bold text-sky-900 ring-1 ring-sky-500/25">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
                    AI Evaluation · {formatElapsed(evalStatus.eval_duration_sec)}
                    {evalStatus.fallback_active ? ' · fallback' : ''}
                  </span>
                ) : null}
                {evalStatus?.status === 'ready_for_interview' ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-bold text-emerald-800 ring-1 ring-emerald-500/25">
                    Ready for Defend
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${
                    strikeCount > 0
                      ? 'bg-amber-500/10 text-amber-900 ring-1 ring-amber-500/20'
                      : 'bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)]'
                  }`}
                >
                  Strikes {strikeCount}/{maxStrikes}
                </span>
                {showMultiFace ? (
                  <button
                    type="button"
                    onClick={() => setMultiFaceDismissed(true)}
                    className="inline-flex items-center gap-1.5 rounded-md bg-red-500/10 px-2 py-1 text-[11px] font-semibold text-red-800 ring-1 ring-red-500/25 transition hover:bg-red-500/15"
                    title="Dismiss"
                  >
                    Multi-face · {multiFaceAt}
                    <span className="opacity-60">×</span>
                  </button>
                ) : null}
                <span
                  className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold ${
                    lookingAway
                      ? 'bg-amber-500/10 text-amber-900 ring-1 ring-amber-500/20'
                      : 'bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)]'
                  }`}
                >
                  {lookingAway ? 'Looking away' : 'Gaze centered'}
                </span>
                {mediaOutage ? (
                  <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-semibold text-amber-900 ring-1 ring-amber-500/25">
                    Media outage
                    {graceSecondsLeft > 0 ? ` · ${formatElapsed(graceSecondsLeft)} left` : ''}
                  </span>
                ) : null}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-[var(--assessment-surface-container)] p-0.5 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                {(
                  [
                    ['split', 'Dual'],
                    ['screen', 'Screen'],
                    ['camera', 'Camera'],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={`rounded-[10px] px-3 py-1.5 transition ${
                      activeTab === key
                        ? 'bg-[var(--assessment-surface-container-lowest)] text-[var(--assessment-on-surface)] shadow-sm'
                        : 'hover:text-[var(--assessment-on-surface)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {rounds.length ? (
                <select
                  className="h-9 max-w-[11rem] truncate rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-2.5 text-xs font-medium text-[var(--assessment-on-surface)] outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/25"
                  value={roundType ?? join?.roundType ?? ''}
                  onChange={(e) => setRoundType(e.target.value || undefined)}
                >
                  {rounds.map((r) => (
                    <option key={r.round_type} value={r.round_type}>
                      {r.round_type.replace(/_/g, ' ')} ({r.status})
                    </option>
                  ))}
                </select>
              ) : null}

              <button
                type="button"
                disabled={!resumeUrl}
                onClick={() => setShowResume(true)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 text-xs font-semibold text-[var(--assessment-on-surface)] transition hover:bg-[var(--assessment-surface-container)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                <svg className="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Resume
              </button>

              {evalStatus?.can_force_advance ? (
                <button
                  type="button"
                  disabled={forceAdvanceBusy}
                  onClick={() => void onForceAdvance()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 text-xs font-bold text-amber-950 transition hover:bg-amber-100 disabled:opacity-50"
                  title="Skip stuck evaluation and start the Defend interview with locked fallback questions"
                >
                  {forceAdvanceBusy ? 'Advancing…' : '⚡ Force Advance'}
                </button>
              ) : null}

              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 text-xs font-semibold text-[var(--assessment-on-surface)] transition hover:bg-[var(--assessment-surface-container)]"
                onClick={() => {
                  const activeRoom = roomRef.current;
                  roomRef.current = null;
                  setMonitorRoom(null);
                  void disconnectLiveKitRoom(activeRoom);
                  setReconnectKey((k) => k + 1);
                }}
              >
                <svg className="h-3.5 w-3.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Refresh
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--assessment-outline-variant)]/70 pt-3">
            <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">{linkLabel}</p>
            {status === 'live' && !candidateInRoom ? (
              <p className="text-[11px] font-medium text-amber-800">
                Speak / Flag unlock when the candidate joins with camera or screen.
              </p>
            ) : null}
          </div>
        </header>

        {monitorRoom ? <LiveKitConnectionBanner link={link} onReconnectNow={reconnectNow} /> : null}

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}
        {pttError ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
            <span>{pttError}</span>
            <button type="button" className="shrink-0 text-xs font-bold underline" onClick={() => setPttError(null)}>
              Dismiss
            </button>
          </div>
        ) : null}
        {forceAdvanceError ? (
          <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-950">
            <span>{forceAdvanceError}</span>
            <button
              type="button"
              className="shrink-0 text-xs font-bold underline"
              onClick={() => setForceAdvanceError(null)}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {/* Feeds */}
        <div
          className={`grid min-h-0 flex-1 gap-3 ${
            activeTab === 'split' ? 'grid-cols-1 xl:grid-cols-2' : 'grid-cols-1'
          }`}
        >
          {(activeTab === 'split' || activeTab === 'camera') && (
            <section className="relative flex min-h-[220px] flex-col overflow-hidden rounded-2xl bg-[#0b1220] ring-1 ring-white/10 xl:min-h-[320px]">
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${hasCamera ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/90">Webcam</span>
                </div>
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm">
                  {hasCamera ? 'Signal live' : 'No signal'}
                </span>
              </div>
              <div className="relative flex flex-1 items-center justify-center">
                <video ref={setCameraEl} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-contain" />
                {!hasCamera ? (
                  <div className="relative z-[1] flex flex-col items-center gap-3 px-6 py-16 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                      <svg className="h-6 w-6 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-white/55">Waiting for candidate camera</p>
                  </div>
                ) : null}
              </div>
            </section>
          )}

          {(activeTab === 'split' || activeTab === 'screen') && (
            <section className="relative flex min-h-[220px] flex-col overflow-hidden rounded-2xl bg-[#0b1220] ring-1 ring-white/10 xl:min-h-[320px]">
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent px-4 pb-8 pt-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${hasScreen ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/90">Screen</span>
                </div>
                <span className="rounded-md bg-white/10 px-2 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm">
                  {hasScreen ? 'Sharing' : 'Pending'}
                </span>
              </div>
              <div className="relative flex flex-1 items-center justify-center">
                <video ref={setScreenEl} autoPlay playsInline muted className="absolute inset-0 h-full w-full object-contain" />
                {!hasScreen ? (
                  <div className="relative z-[1] flex flex-col items-center gap-3 px-6 py-16 text-center">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/5 ring-1 ring-white/10">
                      <svg className="h-6 w-6 text-white/40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <p className="text-sm font-medium text-white/55">Waiting for screen share</p>
                  </div>
                ) : null}
              </div>
            </section>
          )}
        </div>

        {/* Intervention dock */}
        <div
          className={`rounded-2xl border px-4 py-3 shadow-sm sm:px-5 ${
            pttActive
              ? 'border-rose-300/60 bg-rose-50'
              : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)]'
          }`}
        >
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!interventionsReady}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (!interventionsReady) return;
                  void startPtt();
                }}
                onMouseUp={() => void stopPtt()}
                onMouseLeave={() => {
                  if (pttActiveRef.current) void stopPtt();
                }}
                onTouchStart={(e) => {
                  e.preventDefault();
                  if (!interventionsReady) return;
                  void startPtt();
                }}
                onTouchEnd={() => void stopPtt()}
                className={`inline-flex h-12 min-w-[11rem] select-none items-center justify-center gap-2 rounded-2xl px-5 text-sm font-bold tracking-tight transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  pttActive
                    ? 'bg-rose-600 text-white shadow-lg shadow-rose-600/25'
                    : 'bg-[var(--assessment-on-surface)] text-white hover:opacity-90'
                }`}
              >
                <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 14a3 3 0 003-3V5a3 3 0 10-6 0v6a3 3 0 003 3zm5-3a5 5 0 01-10 0H5a7 7 0 0014 0h-2zM11 19v3h2v-3h-2z" />
                </svg>
                {pttActive ? 'Release to resume' : 'Hold to speak'}
              </button>

              <button
                type="button"
                disabled={flagBusy || !interventionsReady}
                onClick={() => void handleFlagMoment()}
                className={`inline-flex h-12 items-center gap-2 rounded-2xl border px-4 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                  flagFlash
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container)]'
                }`}
              >
                <svg className="h-4 w-4 text-rose-500" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M14.4 6L14 4H5v17h2v-7h5.6l.4 2h7V6h-5.6z" />
                </svg>
                {flagFlash ? flagFlash : `Flag moment · ${elapsedLabel}`}
              </button>
            </div>

            <p className={`text-xs ${pttActive ? 'font-semibold text-rose-800' : 'text-[var(--assessment-on-surface-variant)]'}`}>
              {pttActive
                ? 'Broadcasting to candidate · interview timer paused'
                : interventionsReady
                  ? 'Space = push-to-talk · Resume opens without pausing feeds'
                  : 'Controls unlock when candidate media appears'}
            </p>
          </div>
        </div>

        <div ref={audioHostRef} className="sr-only" aria-hidden />

        {join ? (
          <details
            className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] open:pb-3"
            open={showTechnicalDetails}
            onToggle={(e) => setShowTechnicalDetails((e.target as HTMLDetailsElement).open)}
          >
            <summary className="cursor-pointer list-none px-4 py-2.5 text-xs font-semibold text-[var(--assessment-on-surface-variant)] marker:content-none [&::-webkit-details-marker]:hidden">
              <span className="inline-flex w-full items-center justify-between gap-3">
                <span>
                  Diagnostics
                  <span className="ml-2 font-mono font-normal text-[10px] opacity-70">{join.roomName}</span>
                </span>
                <span className="text-[10px] uppercase tracking-wide opacity-60">
                  {showTechnicalDetails ? 'Hide' : 'Show'}
                </span>
              </span>
            </summary>
            <div className="space-y-2 border-t border-[var(--assessment-outline-variant)] px-4 pt-3 text-[11px] text-[var(--assessment-on-surface-variant)]">
              <div className="grid gap-2 sm:grid-cols-3">
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">Phase</div>
                  <div className="mt-0.5 font-mono text-[var(--assessment-on-surface)]">{join.currentPhase || 'N/A'}</div>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">Session</div>
                  <div className="mt-0.5 truncate font-mono text-[var(--assessment-on-surface)]" title={join.candidateToken}>
                    {join.candidateToken}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">Room</div>
                  <div className="mt-0.5 truncate font-mono text-[var(--assessment-on-surface)]" title={join.roomName}>
                    {join.roomName}
                  </div>
                </div>
              </div>
              <p className="font-mono text-[10px]">
                Online: {(join.participantsOnline ?? []).join(', ') || 'none'}
              </p>
              <p className="font-mono text-[10px]">
                Tracks: {remoteLabels.join(' · ') || 'none yet'}
              </p>
            </div>
          </details>
        ) : null}
      </div>

      {showResume ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-[#0b1220]/50 backdrop-blur-[2px]" onClick={() => setShowResume(false)}>
          <div
            className="flex h-full w-full max-w-xl flex-col border-l border-white/10 bg-[var(--assessment-surface-container-lowest)] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] px-5 py-4">
              <div>
                <h2 className="text-sm font-bold text-[var(--assessment-on-surface)]">Resume</h2>
                <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                  {candidateLabel} · feeds stay live
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowResume(false)}
                className="rounded-xl border border-[var(--assessment-outline-variant)] px-3 py-1.5 text-xs font-semibold text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container)]"
              >
                Close Esc
              </button>
            </div>
            <div className="min-h-0 flex-1 bg-[var(--assessment-surface-container)]">
              {resumeUrl ? (
                <iframe title="Candidate resume" src={resumeUrl} className="h-full w-full border-0" />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--assessment-on-surface-variant)]">
                  No resume on file.
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </RecruitmentOpsShell>
  );
}
