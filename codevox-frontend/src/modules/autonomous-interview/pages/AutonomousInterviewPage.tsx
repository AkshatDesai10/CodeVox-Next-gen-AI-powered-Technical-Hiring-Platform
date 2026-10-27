'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { withBasePath } from '@/lib/with-base-path';
import {
  getAutonomousSession,
  initAutonomousSession,
} from '@/modules/autonomous-interview/lib/autonomous-interview-api';
import { useInterviewViewport, normalizeViewportPhase } from '@/modules/autonomous-interview/hooks/useInterviewViewport';
import { InterviewRoomProvider } from '@/modules/autonomous-interview/context/InterviewRoomContext';
import { LiveKitVoiceStagePanel } from '@/modules/autonomous-interview/components/LiveKitVoiceStagePanel';
import { VoiceStagePanel } from '@/modules/autonomous-interview/components/VoiceStagePanel';
import { SystemReadinessLobby } from '@/modules/job-profiles/components/SystemReadinessLobby';
import { releaseInterviewLeaveGuard } from '@/modules/autonomous-interview/lib/interview-leave-guard';

type Props = {
  candidateToken: string;
};

type VoiceTransport = 'livekit' | 'browser';

export function AutonomousInterviewPage({ candidateToken }: Props) {
  const searchParams = useSearchParams();

  // Persist portalToken in localStorage so "Return to portal" works even if URL param is lost
  const portalToken = (() => {
    const fromUrl = searchParams.get('portalToken');
    const key = `portalToken:${candidateToken}`;
    if (typeof window !== 'undefined') {
      if (fromUrl) {
        localStorage.setItem(key, fromUrl);
        return fromUrl;
      }
      return localStorage.getItem(key) ?? candidateToken;
    }
    return fromUrl ?? candidateToken;
  })();
  const portalHref = withBasePath(`/candidate/portal/${portalToken}`);

  const [session, setSession] = useState<Awaited<ReturnType<typeof getAutonomousSession>> | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const readinessKey = `interviewSystemReady:${candidateToken}`;
  const [systemReady, setSystemReady] = useState(false);
  const [referenceDescriptor, setReferenceDescriptor] = useState<number[] | null>(null);
  const [liveKitSessionActive, setLiveKitSessionActive] = useState(false);
  const [screenShareGranted, setScreenShareGranted] = useState(false);
  const [preAcquiredScreenTrack, setPreAcquiredScreenTrack] = useState<MediaStreamTrack | null>(null);
  const [voiceTransport] = useState<VoiceTransport>(() => {
    const mode = process.env.NEXT_PUBLIC_VOICE_TRANSPORT?.toLowerCase();
    if (mode === 'browser' || mode === 'livekit') return mode;
    return 'livekit';
  });
  const {
    phase: wsPhase,
    payload: wsPayload,
    setPhase,
    chatHistory,
    subPhase,
    proctorAlert,
    setProctorAlert,
  } = useInterviewViewport(candidateToken);

  useEffect(() => {
    try {
      setSystemReady(sessionStorage.getItem(readinessKey) === '1');
    } catch {
      setSystemReady(false);
    }
  }, [readinessKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const row = await getAutonomousSession(candidateToken);
        if (cancelled) return;
        setSession(row);
        // Hardware preflight is handled by SystemReadinessLobby below.
        if (row.referenceFaceDescriptor?.length === 128) {
          setReferenceDescriptor(row.referenceFaceDescriptor);
        }
        await initAutonomousSession(candidateToken);
        if (cancelled) return;
        if (voiceTransport === 'livekit' && row.currentPhase !== 'completed') {
          setLiveKitSessionActive(true);
        }
      } catch (err) {
        if (!cancelled) setLoadError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [candidateToken, voiceTransport]);

  useEffect(() => {
    if (!wsPhase) return;
    let cancelled = false;
    void getAutonomousSession(candidateToken).then((row) => {
      if (!cancelled) setSession(row);
    });
    return () => {
      cancelled = true;
    };
  }, [candidateToken, wsPhase]);

  const router = useRouter();

  const activePhase = normalizeViewportPhase(wsPhase ?? session?.currentPhase ?? 'ai_verbal');

  useEffect(() => {
    const submissionToken =
      typeof wsPayload?.submissionToken === 'string' ? wsPayload.submissionToken : null;
    const stageType = typeof wsPayload?.stageType === 'string' ? wsPayload.stageType : null;
    if (
      submissionToken &&
      (activePhase === 'assessing' ||
        (activePhase === 'completed' && stageType === 'project_interview'))
    ) {
      window.location.href = withBasePath(
        `/assessments/candidate/project-interview/${submissionToken}`,
      );
      return;
    }
    if (activePhase !== 'completed') return;
    // After a portal-linked session, return to the candidate dashboard.
    const linkedPortal =
      searchParams.get('portalToken') ||
      (typeof window !== 'undefined' ? localStorage.getItem(`portalToken:${candidateToken}`) : null);
    if (!linkedPortal) return;
    releaseInterviewLeaveGuard();
    window.location.href = withBasePath(`/candidate/portal/${linkedPortal}`);
  }, [activePhase, candidateToken, searchParams, wsPayload]);

  const showSandbox = false;
  const showCompleted = activePhase === 'completed';
  const buildMode =
    searchParams.get('bndPhase') === 'build' ||
    activePhase === 'bnd_assessment' ||
    session?.currentPhase === 'bnd_assessment';
  const isAiScreening =
    activePhase === 'ai_screening' || session?.currentPhase === 'ai_screening';
  const isDefendRound =
    searchParams.get('bndPhase') === 'defend' ||
    activePhase === 'bnd_interview' ||
    session?.currentPhase === 'bnd_interview';
  const isAiVerbal =
    activePhase === 'ai_verbal' || session?.currentPhase === 'ai_verbal';

  // AI Screening + Build + Defend + AI Verbal: camera and screen share mandatory across all rounds
  const forceCamera = buildMode || isAiScreening || isDefendRound || isAiVerbal;
  const forceScreenShare = buildMode || isAiScreening || isDefendRound || isAiVerbal;
  const stablePhase = isDefendRound
    ? 'bnd_interview'
    : buildMode
      ? 'bnd_assessment'
      : isAiScreening
        ? 'ai_screening'
        : 'ai_verbal';
  const roundKey = `${buildMode ? 'build' : 'interview'}:${stablePhase}`;
  const roundKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (roundKeyRef.current === null) {
      roundKeyRef.current = roundKey;
      return;
    }
    if (roundKeyRef.current === roundKey) return;
    roundKeyRef.current = roundKey;
    setScreenShareGranted(false);
    setPreAcquiredScreenTrack((current) => {
      current?.stop();
      return null;
    });
  }, [roundKey]);
  const buildLookupToken =
    searchParams.get('portalToken') ||
    (typeof window !== 'undefined'
      ? localStorage.getItem(`portalToken:${candidateToken}`)
      : null);
  const showVoiceFull =
    !showSandbox &&
    !showCompleted &&
    (buildMode ||
      activePhase === 'ai_verbal' ||
      activePhase === 'closing' ||
      activePhase === 'hr_verbal' ||
      activePhase === 'ai_screening' ||
      activePhase === 'bnd_assessment' ||
      activePhase === 'bnd_interview');
  const showVoiceCompact = showSandbox;
  const livekitEnabled =
    liveKitSessionActive &&
    voiceTransport === 'livekit' &&
    activePhase !== 'completed' &&
    (!forceScreenShare || screenShareGranted);

  const voicePhaseForPanel =
    buildMode || activePhase === 'bnd_assessment'
      ? 'bnd_assessment'
      : isDefendRound
        ? 'bnd_interview'
        : isAiScreening
          ? 'ai_screening'
          : activePhase === 'closing'
            ? 'closing'
            : activePhase === 'hr_verbal'
              ? 'hr_verbal'
              : 'ai_verbal';

  if (loadError) {
    return (
      <div className="assessments-root p-8 text-center text-red-600">
        Failed to load interview: {loadError}
      </div>
    );
  }

  if (!session) {
    return (
      <div className="assessments-root p-8 text-center text-sm text-gray-500">
        Loading interview...
      </div>
    );
  }

  const reqCamera = session.proctorConfig?.requireCameraForStart ?? true;

  // Meet/Zoom-style hardware + network preflight (replaces scattered device modals).
  // Full InterviewConsentGate (liveness/voice enroll) remains available but is not
  // forced here — lobby unlocks the room once cam/mic/network/(face) are ready.
  if (!systemReady && session.currentPhase !== 'completed') {
    return (
      <div className="assessments-root min-h-screen bg-[#090414]">
        <SystemReadinessLobby
          candidateName={session.candidateName ?? undefined}
          faceMode={reqCamera}
          startLabel="Start Interview"
          title="Interview system check"
          subtitle="Confirm camera, mic, and network before the live interview begins."
          onComplete={async () => {
            try {
              sessionStorage.setItem(readinessKey, '1');
            } catch {
              /* ignore */
            }
            setSystemReady(true);
          }}
        />
      </div>
    );
  }

  if (voiceTransport === 'browser' && showVoiceFull && !showCompleted) {
    const voicePhase = activePhase === 'hr_verbal' ? 'hr_verbal' : 'ai_verbal';
    return (
      <div className="assessments-root">
        <VoiceStagePanel
          visible
          candidateToken={candidateToken}
          techStack={session.techStack?.trim() || 'Interview'}
          phase={voicePhase}
          onPhaseChange={(p) => setPhase(p)}
        />
      </div>
    );
  }

  return (
    <InterviewRoomProvider
      candidateToken={candidateToken}
      enabled={livekitEnabled}
      mode={buildMode ? 'build' : 'interview'}
      forceCamera={forceCamera}
      forceScreenShare={forceScreenShare}
      initialScreenTrack={preAcquiredScreenTrack}
      phase={voicePhaseForPanel}
    >
      <div className="assessments-root flex h-screen min-h-0 flex-col overflow-hidden bg-[var(--assessment-surface)]">
        {voiceTransport === 'livekit' && (showVoiceFull || showVoiceCompact) ? (
          <div className={showVoiceFull ? 'flex min-h-0 flex-1 flex-col' : undefined}>
            <LiveKitVoiceStagePanel
              onForceExit={() => {
                releaseInterviewLeaveGuard();
                window.location.href = portalHref;
              }}
              visible
              compact={showVoiceCompact}
              screenShareGranted={screenShareGranted}
              setScreenShareGranted={setScreenShareGranted}
              setPreAcquiredScreenTrack={setPreAcquiredScreenTrack}
              candidateToken={candidateToken}
              techStack={session.techStack?.trim() || 'Interview'}
              phase={voicePhaseForPanel}
              buildMode={buildMode}
              buildLookupToken={buildLookupToken}
              subPhase={subPhase}
              liveChatHistory={chatHistory}
              referenceFaceDescriptor={referenceDescriptor}
              proctorConfig={session.proctorConfig}
              proctorWarning={proctorAlert}
              onProctorWarningDismiss={() => setProctorAlert(null)}
              onPhaseChange={(p) => setPhase(p)}
            />
          </div>
        ) : null}

        {showCompleted ? (
          !session.finalDecision ? (
            <div className="flex-1 flex items-center justify-center bg-slate-50 h-full overflow-y-auto">
              <div className="mx-auto max-w-2xl space-y-6 p-6 py-12 text-center w-full">
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-8">
                  <h1 className="text-2xl font-semibold text-emerald-900">Interview complete</h1>
                  <p className="mt-2 text-sm text-emerald-800">
                    Thank you for completing the interview. We&apos;ll get back to you once your assessment
                    has been evaluated. Returning you to the dashboard…
                  </p>
                  <div className="mt-8 flex justify-center">
                    <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
                  </div>
                </div>
              </div>
            </div>
          ) : session.finalDecision === 'AUTO_REJECT' ? (
            <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-y-auto">
              <div className="mx-auto max-w-4xl space-y-8 p-6 py-12 w-full mt-10 font-sans">
                <div className="bg-[#005ea2] text-white p-12 text-center rounded-sm shadow-sm w-full">
                  <h1 className="text-4xl font-semibold mb-4 tracking-tight">Assessment complete</h1>
                  <h2 className="text-2xl font-medium">Thank you!</h2>
                </div>
                <div className="px-2 text-gray-800 space-y-4">
                  <p className="text-[15px]">Unfortunately, your score did not meet the requirement to advance to the next stage of the process. We sincerely appreciate the time and effort you invested in this assessment.</p>
                  {!(session as any).isBehavioral && (
                    <div className="mt-6 rounded-xl border border-slate-200 bg-[var(--assessment-surface-container)] p-6 shadow-sm">
                      <p className="text-3xl font-black text-[var(--color-primary)] mb-2">{Math.round((session.stage1VoiceScore || 0) * 10)}%</p>
                      <p className="text-slate-600 font-medium">Required passing score: {Math.round(((session as any).thresholdInfo?.required_score || 7.5) * 10)}%</p>
                    </div>
                  )}
                  <div className="mt-6">
                    <a
                      href={portalHref}
                      className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
                    >
                      Return to portal
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ) : session.finalDecision === 'AUTO_PASS_TO_OFFER' ? (
            <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-y-auto">
              <div className="mx-auto max-w-4xl space-y-8 p-6 py-12 w-full mt-10 font-sans">
                <div className="bg-[#005ea2] text-white p-12 text-center rounded-sm shadow-sm w-full">
                  <h1 className="text-4xl font-semibold mb-4 tracking-tight">Congratulations!</h1>
                  <h2 className="text-2xl font-medium">You completed this round.</h2>
                </div>
                <div className="px-2 text-gray-800 space-y-4">
                  {!(session as any).isBehavioral && (
                    <div className="mt-6 rounded-xl border border-slate-200 bg-[var(--assessment-surface-container)] p-6 shadow-sm">
                      <p className="text-3xl font-black text-[var(--color-primary)] mb-2">{Math.round((session.stage1VoiceScore || 0) * 10)}%</p>
                      <p className="text-slate-600 font-medium">Your score for this round</p>
                    </div>
                  )}
                  <div className="mt-6">
                    <a
                      href={portalHref}
                      className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
                    >
                      Return to portal
                    </a>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col bg-slate-50 h-full overflow-y-auto">
              <div className="mx-auto max-w-4xl space-y-8 p-6 py-12 w-full mt-10 font-sans">
                <div className="bg-[#005ea2] text-white p-12 text-center rounded-sm shadow-sm w-full">
                  <h1 className="text-4xl font-semibold mb-4 tracking-tight">Assessment complete</h1>
                  <h2 className="text-2xl font-medium">Thank you!</h2>
                </div>
                <div className="px-2 text-gray-800 space-y-4">
                  <p className="text-[15px]">Your interview submission has been successfully recorded.</p>
                  <p className="text-[15px]">Please return to the portal to check your application status or continue to the next round.</p>
                  {!(session as any).isBehavioral && (
                    <div className="mt-6 rounded-xl border border-slate-200 bg-[var(--assessment-surface-container)] p-6 shadow-sm">
                      <p className="text-3xl font-black text-[var(--color-primary)] mb-2">{Math.round((session.stage1VoiceScore || 0) * 10)}%</p>
                      <p className="text-slate-600 font-medium">Your score for this round</p>
                    </div>
                  )}
                  <div className="mt-8">
                    <a
                      href={portalHref}
                      className="inline-flex items-center justify-center rounded-lg bg-blue-600 px-6 py-3 text-sm font-bold text-white shadow-sm hover:bg-blue-700"
                    >
                      Return to portal
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )
        ) : null}

        {!showVoiceFull && !showVoiceCompact && !showSandbox && !showCompleted ? (
          <div className="flex flex-1 items-center justify-center p-8 text-sm text-[var(--assessment-on-surface-variant)]">
            Preparing interview...
          </div>
        ) : null}
      </div>
    </InterviewRoomProvider>
  );
}


