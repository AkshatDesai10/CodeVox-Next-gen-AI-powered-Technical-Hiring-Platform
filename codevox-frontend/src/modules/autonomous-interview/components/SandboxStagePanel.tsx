'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RoomEvent, Track } from 'livekit-client';
import { CodingWorkspacePageContent } from '@/modules/assessments/pages/CodingWorkspacePage';
import {
  finalSubmitAutonomous,
  postInterviewProctorEvents,
} from '@/modules/autonomous-interview/lib/autonomous-interview-api';
import { getAssessmentAttempt } from '@/lib/assessments-api';
import { useOptionalInterviewRoom } from '@/modules/autonomous-interview/context/InterviewRoomContext';
import { useFocusIntegrity } from '@/modules/proctor/useFocusIntegrity';
import { useProctorEventBatch } from '@/modules/proctor/useProctorEventBatch';
import { useSessionProctor } from '@/modules/proctor/useSessionProctor';
import type { ProctorEventInput } from '@/modules/proctor/types';

const BULK_PASTE_CHAR_THRESHOLD = 400;

type Props = {
  candidateToken: string;
  candidateId: string;
  candidateAssessmentId: string;
  visible: boolean;
  referenceFaceDescriptor?: number[] | null;
  proctorConfig?: {
    faceCheckIntervalMs: number;
    faceMatchThreshold: number;
  };
};

export function SandboxStagePanel({
  candidateToken,
  candidateId,
  candidateAssessmentId,
  visible,
  referenceFaceDescriptor = null,
  proctorConfig,
}: Props) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const interviewRoom = useOptionalInterviewRoom();
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const { enqueue } = useProctorEventBatch(
    (events: ProctorEventInput[]) => postInterviewProctorEvents(candidateToken, events),
    visible,
  );

  const handleProctorEvent = useCallback(
    (event: ProctorEventInput) => {
      enqueue(event);
    },
    [enqueue],
  );

  useFocusIntegrity(visible, handleProctorEvent);

  const pipEnabled =
    visible &&
    Boolean(referenceFaceDescriptor?.length) &&
    Boolean(interviewRoom?.videoEnabled);

  useSessionProctor({
    enabled: pipEnabled,
    videoRef: pipVideoRef,
    referenceDescriptor: referenceFaceDescriptor,
    faceMatchThreshold: proctorConfig?.faceMatchThreshold ?? 0.55,
    checkIntervalMs: proctorConfig?.faceCheckIntervalMs ?? 5000,
    agentSpeaking: false,
    micEnabled: false,
    onEvent: handleProctorEvent,
  });

  useEffect(() => {
    const room = interviewRoom?.room;
    if (!room || !pipEnabled) return;

    const attachLocalVideo = () => {
      const pub = room.localParticipant.getTrackPublication(Track.Source.Camera);
      if (pub?.track && pipVideoRef.current) {
        pub.track.attach(pipVideoRef.current);
      }
    };

    attachLocalVideo();
    room.on(RoomEvent.LocalTrackPublished, attachLocalVideo);
    return () => {
      room.off(RoomEvent.LocalTrackPublished, attachLocalVideo);
    };
  }, [interviewRoom?.room, pipEnabled]);

  useEffect(() => {
    if (!visible) return;
    const root = containerRef.current;
    if (!root) return;

    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (text.length >= BULK_PASTE_CHAR_THRESHOLD) {
        handleProctorEvent({
          type: 'bulk_paste_suspected',
          severity: 'info',
          payload: { char_count: text.length },
        });
      }
    };

    root.addEventListener('paste', onPaste);
    return () => root.removeEventListener('paste', onPaste);
  }, [visible, handleProctorEvent]);

  if (!visible) return null;

  const handleFinalSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const attempt = (await getAssessmentAttempt(candidateAssessmentId)).data;
      const submission = attempt.submissions?.find((s) => s.sourceCode?.trim()) ??
        attempt.submissions?.[0];
      const sourceCode = submission?.sourceCode ?? '';
      const language = submission?.language ?? 'PYTHON';
      const result = await finalSubmitAutonomous({
        candidate_token: candidateToken,
        source_code: sourceCode,
        language,
      });
      await interviewRoom?.publishAssessmentComplete({
        code_quality_score: result.codeQualityScore as number | undefined,
        architectural_flaws: result.architecturalFlaws as string[] | undefined,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-2">
        <span className="text-sm font-semibold text-[var(--assessment-primary)]">
          Coding Sandbox
        </span>
        <button
          type="button"
          disabled={submitting}
          onClick={() => void handleFinalSubmit()}
          className="rounded-md bg-[var(--assessment-primary)] px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
        >
          {submitting ? 'Submitting...' : 'Final Submit'}
        </button>
      </div>
      {error ? (
        <p className="shrink-0 px-4 py-2 text-sm text-red-600">{error}</p>
      ) : null}
      {pipEnabled ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 overflow-hidden rounded-lg border-2 border-[var(--assessment-primary)] bg-black shadow-lg">
          <video
            ref={pipVideoRef}
            autoPlay
            muted
            playsInline
            className="h-24 w-32 object-cover"
          />
          <p className="bg-black/70 px-2 py-0.5 text-center text-[10px] text-white">
            Proctor camera
          </p>
        </div>
      ) : null}
      <div className="autonomous-sandbox-workspace flex min-h-0 flex-1 flex-col overflow-hidden">
        <CodingWorkspacePageContent
          candidateId={candidateId}
          candidateAssessmentId={candidateAssessmentId}
          embedded
        />
      </div>
    </div>
  );
}
