'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { useMemo, useState } from 'react';

type ProctorSummary = {
  total_events?: number;
  by_type?: Record<string, number>;
  critical_count?: number;
  warning_count?: number;
  last_event_at?: string | null;
  fraud_risk_score?: number;
};

type ProctorEvent = {
  event_type: string;
  severity: string;
  payload?: Record<string, unknown>;
  created_at?: string;
  client_ts?: number;
};

type Props = {
  identityVerifiedAt?: string | null;
  livenessVerifiedAt?: string | null;
  proctorSummary?: ProctorSummary | null;
  proctorEvents?: ProctorEvent[] | null;
  fraudRiskReviewThreshold?: number;
};

type EventCategory = 'key' | 'media' | 'focus' | 'presence' | 'all';

function getEventStyle(type: string): {
  icon: string;
  colorClass: string;
  bgClass: string;
  dotClass: string;
} {
  const t = type.toLowerCase();
  if (t === 'media_permission_terminated') {
    return {
      icon: 'gavel',
      colorClass: 'text-red-600',
      bgClass: 'bg-red-50 text-red-900 border-red-300 font-bold',
      dotClass: 'bg-red-600',
    };
  }
  if (t === 'media_permission_restored') {
    return {
      icon: 'check_circle',
      colorClass: 'text-emerald-600',
      bgClass: 'bg-emerald-50 text-emerald-800 border-emerald-200',
      dotClass: 'bg-emerald-500',
    };
  }
  if (t === 'media_permission_revoked' || t.includes('permission')) {
    return {
      icon: 'videocam_off',
      colorClass: 'text-amber-600',
      bgClass: 'bg-amber-50 text-amber-900 border-amber-200',
      dotClass: 'bg-amber-500',
    };
  }
  if (t === 'multi_face') {
    return {
      icon: 'groups',
      colorClass: 'text-red-600',
      bgClass: 'bg-red-50 text-red-900 border-red-200 font-semibold',
      dotClass: 'bg-red-600',
    };
  }
  if (t === 'face_absent') {
    return {
      icon: 'person_off',
      colorClass: 'text-amber-600',
      bgClass: 'bg-amber-50 text-amber-900 border-amber-200',
      dotClass: 'bg-amber-500',
    };
  }
  if (t === 'gaze_off_camera') {
    return {
      icon: 'visibility_off',
      colorClass: 'text-slate-600',
      bgClass: 'bg-slate-50 text-slate-800 border-slate-200',
      dotClass: 'bg-slate-500',
    };
  }
  if (t === 'window_blur' || t === 'tab_hidden') {
    return {
      icon: 'tab_unselected',
      colorClass: 'text-amber-600',
      bgClass: 'bg-amber-50 text-amber-800 border-amber-200',
      dotClass: 'bg-amber-500',
    };
  }
  if (t.includes('voice') || t.includes('audio')) {
    return {
      icon: 'record_voice_over',
      colorClass: 'text-blue-600',
      bgClass: 'bg-blue-50 text-blue-900 border-blue-200',
      dotClass: 'bg-blue-600',
    };
  }
  if (t.includes('livekit_disconnected')) {
    return {
      icon: 'wifi_off',
      colorClass: 'text-amber-600',
      bgClass: 'bg-amber-50 text-amber-800 border-amber-200',
      dotClass: 'bg-amber-500',
    };
  }
  if (t.includes('livekit')) {
    return {
      icon: 'stream',
      colorClass: 'text-[var(--assessment-primary)]',
      bgClass: 'bg-[var(--assessment-primary-container)]/60 text-[var(--assessment-on-primary-container)] border-[var(--assessment-primary)]/20',
      dotClass: 'bg-[var(--assessment-primary)]',
    };
  }
  return {
    icon: 'warning',
    colorClass: 'text-amber-600',
    bgClass: 'bg-amber-50 text-amber-800 border-amber-200',
    dotClass: 'bg-amber-500',
  };
}

function eventTitle(type: string, payload?: Record<string, unknown>): string {
  const t = type.toLowerCase();
  if (t === 'candidate_ended_interview') return 'Candidate pressed End Interview';
  if (t === 'media_permission_terminated') return 'Session Terminated: Strike Limit Exceeded';
  if (t === 'media_permission_restored') return 'Camera / Mic Feed Restored';
  if (t === 'media_permission_revoked') {
    const strike = payload?.strike ?? payload?.strikes;
    return typeof strike === 'number'
      ? `Camera / Mic Disconnected (Strike ${strike})`
      : 'Camera / Mic Disconnected (Strike Logged)';
  }
  if (t === 'window_blur') return 'Window Focus Lost';
  if (t === 'tab_hidden') return 'Browser Tab Switched / Hidden';
  if (t === 'face_absent') return 'Face Not Detected';
  if (t === 'multi_face') return 'Multiple Faces Detected';
  if (t === 'gaze_off_camera') return 'Gaze Shifted Off-Screen';
  if (t === 'extra_voice_suspected') return 'Secondary Voice Detected';
  if (t === 'livekit_disconnected') return 'WebRTC Stream Disconnected';
  if (t === 'livekit_agent_missing_restart') return 'Interviewer Audio Restored';
  if (t === 'livekit_join_via_candidate_ready' || t === 'livekit_join_via_init') return 'Candidate Joined Interview Room';
  if (t === 'livekit_join_before_screen_share') return 'Joined Room (Pre-Screen Share)';
  if (t === 'livekit_agent_started_after_screen_share') return 'Interviewer Audio Channel Started';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function eventDetail(evt: ProctorEvent): string {
  const details = evt.payload?.details;
  if (typeof details === 'string' && details.trim()) return details.trim();

  const t = evt.event_type.toLowerCase();
  if (t === 'candidate_ended_interview') {
    return 'The candidate confirmed End interview before the round finished.';
  }
  if (t === 'media_permission_terminated') {
    return evt.payload?.reason === 'max_strikes_exceeded'
      ? 'The session was terminated after reaching maximum allowed camera/mic disconnect strikes.'
      : 'The recovery window expired without restoring camera or microphone access.';
  }
  if (t === 'media_permission_revoked') {
    return 'Camera or microphone stream was interrupted. Disconnection strike recorded.';
  }
  if (t === 'media_permission_restored') {
    return 'Candidate reconnected required camera & microphone stream.';
  }
  if (t === 'window_blur') {
    return 'Candidate clicked away or shifted focus to another desktop application.';
  }
  if (t === 'tab_hidden') {
    return 'Candidate switched browser tabs or minimized the interview window.';
  }
  if (t === 'face_absent') {
    return 'Candidate moved outside the camera frame or camera lens was obstructed.';
  }
  if (t === 'multi_face') {
    return 'An additional person was detected in the camera frame.';
  }
  if (t === 'gaze_off_camera') {
    return 'Candidate was looking away from the screen for an extended period.';
  }
  if (t === 'extra_voice_suspected') {
    return 'Audio stream detected secondary or background speech.';
  }
  if (t === 'livekit_disconnected') {
    return 'Real-time media communication stream temporarily dropped.';
  }
  if (t.includes('livekit_join')) {
    return 'Connected to LiveKit autonomous interview workspace.';
  }
  if (t === 'livekit_agent_started_after_screen_share') {
    return 'AI Voice interviewer agent connected after screen share verified.';
  }
  return 'Telemetry signal recorded by proctoring engine.';
}

export function InterviewIntegritySection({
  identityVerifiedAt,
  livenessVerifiedAt,
  proctorSummary,
  proctorEvents = [],
}: Props) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeCategory, setActiveCategory] = useState<EventCategory>('key');
  const [showAllEvents, setShowAllEvents] = useState(false);

  const displayEvents = useMemo(() => proctorEvents ?? [], [proctorEvents]);

  // Derived metrics
  const mediaRevokedEvents = useMemo(
    () => displayEvents.filter((e) => e.event_type === 'media_permission_revoked'),
    [displayEvents]
  );
  const mediaTermination = useMemo(
    () => displayEvents.find((e) => e.event_type === 'media_permission_terminated'),
    [displayEvents]
  );
  const tabFocusEvents = useMemo(
    () => displayEvents.filter((e) => e.event_type === 'window_blur' || e.event_type === 'tab_hidden'),
    [displayEvents]
  );
  const presenceEvents = useMemo(
    () =>
      displayEvents.filter(
        (e) =>
          e.event_type === 'face_absent' ||
          e.event_type === 'multi_face' ||
          e.event_type === 'gaze_off_camera' ||
          e.event_type === 'extra_voice_suspected'
      ),
    [displayEvents]
  );
  const multiFaceEvents = useMemo(
    () => displayEvents.filter((e) => e.event_type === 'multi_face'),
    [displayEvents]
  );

  const cameraDropCount = mediaRevokedEvents.length;
  const tabFocusCount = tabFocusEvents.length;
  const presenceCount = presenceEvents.length;

  // Filtered chronology
  const filteredEvents = useMemo(() => {
    switch (activeCategory) {
      case 'media':
        return displayEvents.filter((e) => e.event_type.startsWith('media_permission'));
      case 'focus':
        return displayEvents.filter((e) => e.event_type === 'window_blur' || e.event_type === 'tab_hidden');
      case 'presence':
        return presenceEvents;
      case 'all':
        return displayEvents;
      case 'key':
      default:
        return displayEvents.filter(
          (e) =>
            e.event_type.startsWith('media_permission') ||
            e.event_type === 'multi_face' ||
            e.event_type === 'window_blur' ||
            e.event_type === 'tab_hidden' ||
            e.event_type === 'face_absent' ||
            e.severity === 'critical' ||
            e.severity === 'warning'
        );
    }
  }, [activeCategory, displayEvents, presenceEvents]);

  const visibleEvents = showAllEvents ? filteredEvents : filteredEvents.slice(0, 8);

  const isTerminated = !!mediaTermination;
  const isFlagged = !isTerminated && (cameraDropCount > 0 || multiFaceEvents.length > 0 || tabFocusCount > 5);

  const statusVerdict = isTerminated
    ? {
        label: 'Terminated (Policy Violation)',
        toneClass: 'text-red-800 bg-red-50 border-red-200',
        icon: 'gavel',
      }
    : isFlagged
      ? {
          label: 'Integrity Review Required',
          toneClass: 'text-amber-800 bg-amber-50 border-amber-200',
          icon: 'warning',
        }
      : {
          label: 'Continuous Integrity Verified',
          toneClass: 'text-emerald-800 bg-emerald-50 border-emerald-200',
          icon: 'verified_user',
        };

  return (
    <section
      className="bg-[var(--assessment-surface-container-lowest)] rounded-2xl border border-[var(--assessment-outline-variant)] shadow-sm overflow-hidden"
      id="proctoring-card"
    >
      {/* Header */}
      <div className="px-6 py-4 bg-[var(--assessment-surface-container-low)] border-b border-[var(--assessment-outline-variant)] flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[var(--assessment-primary-container)] text-[var(--assessment-primary)] flex items-center justify-center border border-[var(--assessment-primary)]/20 shadow-sm">
            <AssessmentMaterialIcon name="shield" size={22} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold text-[var(--assessment-on-surface)]">
                Integrity & Proctoring Signals
              </h2>
              <span
                className={`inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full border font-semibold ${statusVerdict.toneClass}`}
              >
                <AssessmentMaterialIcon name={statusVerdict.icon} size={14} />
                {statusVerdict.label}
              </span>
            </div>
            <p className="text-xs text-[var(--assessment-on-surface-variant)] mt-0.5">
              Continuous camera feed, window focus detection & workspace perimeter monitoring
            </p>
          </div>
        </div>

        <button
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] hover:bg-[var(--assessment-surface-container)] text-xs font-semibold text-[var(--assessment-on-surface)] transition shadow-sm"
          onClick={() => setIsExpanded(!isExpanded)}
          type="button"
        >
          <span>{isExpanded ? 'Hide details' : 'Show details'}</span>
          <AssessmentMaterialIcon
            name="expand_less"
            size={16}
            className={`transition-transform duration-200 ${isExpanded ? '' : 'rotate-180'}`}
          />
        </button>
      </div>

      {isExpanded && (
        <div className="p-6 space-y-6" id="proctoring-content">
          {/* Top Metric Cards: Real dynamic signals */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Card 1: Camera Disconnects / Strikes */}
            <div
              className={`p-4 rounded-xl border flex flex-col justify-between transition-all ${
                isTerminated
                  ? 'bg-red-50/80 border-red-200 text-red-950'
                  : cameraDropCount > 0
                    ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                    : 'bg-[var(--assessment-surface-container-low)] border-[var(--assessment-outline-variant)] text-[var(--assessment-on-surface)]'
              }`}
            >
              <div className="flex items-center justify-between text-[var(--assessment-on-surface-variant)]">
                <span className="text-xs font-semibold uppercase tracking-wider">Camera Drops (Strikes)</span>
                <AssessmentMaterialIcon
                  name="videocam"
                  size={18}
                  className={
                    isTerminated
                      ? 'text-red-600'
                      : cameraDropCount > 0
                        ? 'text-amber-600'
                        : 'text-emerald-600'
                  }
                />
              </div>
              <div className="mt-2.5 flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono">
                  {cameraDropCount}
                </span>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    isTerminated
                      ? 'bg-red-100 text-red-800'
                      : cameraDropCount > 0
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {isTerminated ? 'Terminated' : cameraDropCount > 0 ? 'Logged' : 'No Drops'}
                </span>
              </div>
              <span className="text-xs text-[var(--assessment-on-surface-variant)] mt-1.5">
                {isTerminated
                  ? 'Limit reached, session closed'
                  : cameraDropCount > 0
                    ? `${cameraDropCount} interruption(s) during session`
                    : 'Continuous video feed maintained'}
              </span>
            </div>

            {/* Card 2: Tab & Window Focus */}
            <div
              className={`p-4 rounded-xl border flex flex-col justify-between transition-all ${
                tabFocusCount > 5
                  ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                  : 'bg-[var(--assessment-surface-container-low)] border-[var(--assessment-outline-variant)] text-[var(--assessment-on-surface)]'
              }`}
            >
              <div className="flex items-center justify-between text-[var(--assessment-on-surface-variant)]">
                <span className="text-xs font-semibold uppercase tracking-wider">Tab / Window Focus Lost</span>
                <AssessmentMaterialIcon
                  name="tab_unselected"
                  size={18}
                  className={tabFocusCount > 5 ? 'text-amber-600' : 'text-slate-500'}
                />
              </div>
              <div className="mt-2.5 flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono">
                  {tabFocusCount}
                </span>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    tabFocusCount > 5
                      ? 'bg-amber-100 text-amber-800'
                      : tabFocusCount > 0
                        ? 'bg-slate-200 text-slate-800'
                        : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {tabFocusCount > 5 ? 'Frequent' : tabFocusCount > 0 ? 'Low' : 'Continuous'}
                </span>
              </div>
              <span className="text-xs text-[var(--assessment-on-surface-variant)] mt-1.5">
                {tabFocusCount > 0
                  ? 'Navigated away or clicked out of window'
                  : 'Candidate stayed in assessment window'}
              </span>
            </div>

            {/* Card 3: Presence & Face Signals */}
            <div
              className={`p-4 rounded-xl border flex flex-col justify-between transition-all ${
                multiFaceEvents.length > 0
                  ? 'bg-red-50/80 border-red-200 text-red-950'
                  : presenceCount > 5
                    ? 'bg-amber-50/70 border-amber-200 text-amber-950'
                    : 'bg-[var(--assessment-surface-container-low)] border-[var(--assessment-outline-variant)] text-[var(--assessment-on-surface)]'
              }`}
            >
              <div className="flex items-center justify-between text-[var(--assessment-on-surface-variant)]">
                <span className="text-xs font-semibold uppercase tracking-wider">Presence & Face Signals</span>
                <AssessmentMaterialIcon
                  name={multiFaceEvents.length > 0 ? 'groups' : 'face'}
                  size={18}
                  className={
                    multiFaceEvents.length > 0
                      ? 'text-red-600'
                      : presenceCount > 5
                        ? 'text-amber-600'
                        : 'text-emerald-600'
                  }
                />
              </div>
              <div className="mt-2.5 flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono">
                  {multiFaceEvents.length > 0 ? multiFaceEvents.length : presenceCount}
                </span>
                <span
                  className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                    multiFaceEvents.length > 0
                      ? 'bg-red-100 text-red-800'
                      : presenceCount > 5
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-emerald-100 text-emerald-800'
                  }`}
                >
                  {multiFaceEvents.length > 0
                    ? 'Multi-Face Flag'
                    : presenceCount > 5
                      ? 'Anomalies'
                      : 'Clear'}
                </span>
              </div>
              <span className="text-xs text-[var(--assessment-on-surface-variant)] mt-1.5">
                {multiFaceEvents.length > 0
                  ? 'Multiple persons detected in camera frame'
                  : presenceCount > 0
                    ? `${presenceCount} face absent or gaze shifts logged`
                    : 'Candidate face continuously verified'}
              </span>
            </div>

            {/* Card 4: Total Telemetry Events */}
            <div className="p-4 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] flex flex-col justify-between">
              <div className="flex items-center justify-between text-[var(--assessment-on-surface-variant)]">
                <span className="text-xs font-semibold uppercase tracking-wider">Proctor Telemetry Stream</span>
                <AssessmentMaterialIcon
                  name="analytics"
                  size={18}
                  className="text-[var(--assessment-primary)]"
                />
              </div>
              <div className="mt-2.5 flex items-baseline gap-2">
                <span className="text-2xl font-bold font-mono text-[var(--assessment-on-surface)]">
                  {displayEvents.length}
                </span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-[var(--assessment-primary-container)] text-[var(--assessment-primary)]">
                  Raw Events
                </span>
              </div>
              <span className="text-xs text-[var(--assessment-on-surface-variant)] mt-1.5">
                Audit trail logged with ISO timestamps
              </span>
            </div>
          </div>

          {/* Main 2-column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2">
            {/* Panel A: Session Integrity & Monitored Feeds */}
            <div className="lg:col-span-4 space-y-4 border-b lg:border-b-0 lg:border-r border-[var(--assessment-outline-variant)] pb-6 lg:pb-0 lg:pr-6">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                  Session & Feeds Monitored
                </span>
                <span className="text-xs font-mono text-[var(--assessment-on-surface-variant)]">
                  {displayEvents.length > 0 ? 'Active Stream' : 'Completed'}
                </span>
              </div>

              <div className="space-y-2.5">
                {/* Feed 1: Video Camera */}
                <div
                  className={`p-3.5 rounded-xl border flex items-center justify-between transition-all ${
                    cameraDropCount > 0
                      ? 'bg-amber-50/50 border-amber-200'
                      : 'bg-[var(--assessment-surface-container-low)] border-[var(--assessment-outline-variant)]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${
                        cameraDropCount > 0 ? 'bg-amber-500' : 'bg-emerald-600'
                      }`}
                    >
                      <AssessmentMaterialIcon name="videocam" size={18} />
                    </span>
                    <div>
                      <div className="text-xs font-bold text-[var(--assessment-on-surface)]">
                        Camera Feed
                      </div>
                      <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                        {cameraDropCount > 0
                          ? `${cameraDropCount} disconnect interruption(s)`
                          : 'Continuous video capture verified'}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                      cameraDropCount > 0
                        ? 'text-amber-800 bg-amber-100'
                        : 'text-emerald-800 bg-emerald-100'
                    }`}
                  >
                    {cameraDropCount > 0 ? `${cameraDropCount} Drop(s)` : 'Normal'}
                  </span>
                </div>

                {/* Feed 2: Audio Microphone */}
                <div className="p-3.5 rounded-xl border bg-[var(--assessment-surface-container-low)] border-[var(--assessment-outline-variant)] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white bg-emerald-600 shadow-sm">
                      <AssessmentMaterialIcon name="mic" size={18} />
                    </span>
                    <div>
                      <div className="text-xs font-bold text-[var(--assessment-on-surface)]">
                        Audio Microphone Feed
                      </div>
                      <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                        Continuous voice transcription & clarity
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md">
                    Active
                  </span>
                </div>

                {/* Feed 3: Window & Focus Guard */}
                <div
                  className={`p-3.5 rounded-xl border flex items-center justify-between transition-all ${
                    tabFocusCount > 0
                      ? 'bg-amber-50/50 border-amber-200'
                      : 'bg-[var(--assessment-surface-container-low)] border-[var(--assessment-outline-variant)]'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`w-8 h-8 rounded-lg flex items-center justify-center text-white shadow-sm ${
                        tabFocusCount > 5
                          ? 'bg-amber-500'
                          : tabFocusCount > 0
                            ? 'bg-slate-500'
                            : 'bg-emerald-600'
                      }`}
                    >
                      <AssessmentMaterialIcon name="tab" size={18} />
                    </span>
                    <div>
                      <div className="text-xs font-bold text-[var(--assessment-on-surface)]">
                        Workspace Focus Guard
                      </div>
                      <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                        {tabFocusCount > 0
                          ? `${tabFocusCount} window blur / tab events`
                          : 'Continuous focus on assessment'}
                      </div>
                    </div>
                  </div>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-md ${
                      tabFocusCount > 5
                        ? 'text-amber-800 bg-amber-100'
                        : tabFocusCount > 0
                          ? 'text-slate-800 bg-slate-200'
                          : 'text-emerald-800 bg-emerald-100'
                    }`}
                  >
                    {tabFocusCount > 0 ? `${tabFocusCount} blur(s)` : 'Locked'}
                  </span>
                </div>

                {/* Feed 4: Candidate Check-in / Token Verification */}
                <div className="p-3.5 rounded-xl border bg-[var(--assessment-surface-container-low)] border-[var(--assessment-outline-variant)] flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <span className="w-8 h-8 rounded-lg flex items-center justify-center text-white bg-[var(--assessment-primary)] shadow-sm">
                      <AssessmentMaterialIcon name="verified" size={18} />
                    </span>
                    <div>
                      <div className="text-xs font-bold text-[var(--assessment-on-surface)]">
                        Candidate Check-in
                      </div>
                      <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                        {identityVerifiedAt
                          ? `Verified: ${new Date(identityVerifiedAt).toLocaleDateString()}`
                          : 'Authenticated candidate session'}
                      </div>
                    </div>
                  </div>
                  <span className="text-[11px] font-bold text-[var(--assessment-primary)] bg-[var(--assessment-primary-container)] px-2 py-0.5 rounded-md">
                    Verified
                  </span>
                </div>
              </div>

              {/* Informational Guidance Box */}
              <div className="bg-[var(--assessment-surface-container-low)] rounded-xl p-3.5 border border-[var(--assessment-outline-variant)] text-xs text-[var(--assessment-on-surface-variant)] flex items-start gap-2.5">
                <span className="mt-0.5 text-[var(--assessment-primary)]">
                  <AssessmentMaterialIcon name="info" size={16} />
                </span>
                <span className="leading-relaxed">
                  {isTerminated
                    ? 'Session was terminated automatically after candidate reached the maximum allowed camera/mic disconnect strikes.'
                    : isFlagged
                      ? 'Violations recorded. You can inspect the chronological audit trail or override the final decision from the candidate header.'
                      : 'All proctoring feeds operated within normal thresholds with zero critical anomalies.'}
                </span>
              </div>
            </div>

            {/* Panel B: Filtered Event Timeline */}
            <div className="lg:col-span-8 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                    Proctor Events Chronology
                  </span>
                  <span className="text-xs text-[var(--assessment-on-surface-variant)]">
                    ({filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'})
                  </span>
                </div>

                {/* Filter Pills with matching Assessment theme */}
                <div className="flex items-center gap-1 bg-[var(--assessment-surface-container)] p-1 rounded-xl border border-[var(--assessment-outline-variant)] flex-wrap">
                  <button
                    type="button"
                    onClick={() => setActiveCategory('key')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      activeCategory === 'key'
                        ? 'bg-[var(--assessment-primary)] text-white shadow-sm'
                        : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container-low)]'
                    }`}
                  >
                    Key Events
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCategory('media')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      activeCategory === 'media'
                        ? 'bg-[var(--assessment-primary)] text-white shadow-sm'
                        : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container-low)]'
                    }`}
                  >
                    <span>Camera / Mic</span>
                    {cameraDropCount > 0 && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                          activeCategory === 'media'
                            ? 'bg-white/20 text-white'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {cameraDropCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCategory('focus')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      activeCategory === 'focus'
                        ? 'bg-[var(--assessment-primary)] text-white shadow-sm'
                        : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container-low)]'
                    }`}
                  >
                    <span>Focus / Tabs</span>
                    {tabFocusCount > 0 && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                          activeCategory === 'focus'
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-200 text-slate-800'
                        }`}
                      >
                        {tabFocusCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCategory('presence')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${
                      activeCategory === 'presence'
                        ? 'bg-[var(--assessment-primary)] text-white shadow-sm'
                        : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container-low)]'
                    }`}
                  >
                    <span>Presence</span>
                    {presenceCount > 0 && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                          activeCategory === 'presence'
                            ? 'bg-white/20 text-white'
                            : 'bg-slate-200 text-slate-800'
                        }`}
                      >
                        {presenceCount}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveCategory('all')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                      activeCategory === 'all'
                        ? 'bg-[var(--assessment-primary)] text-white shadow-sm'
                        : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container-low)]'
                    }`}
                  >
                    All Raw Logs
                  </button>
                </div>
              </div>

              {/* Event List */}
              <div className="space-y-2">
                {visibleEvents.length > 0 ? (
                  visibleEvents.map((evt, idx) => {
                    const style = getEventStyle(evt.event_type);
                    let timeStr = 'Time unavailable';
                    if (evt.created_at) {
                      const dt = new Date(evt.created_at);
                      if (!Number.isNaN(dt.getTime())) {
                        timeStr = `${dt.getHours().toString().padStart(2, '0')}:${dt
                          .getMinutes()
                          .toString()
                          .padStart(2, '0')}:${dt.getSeconds().toString().padStart(2, '0')}`;
                      }
                    }

                    return (
                      <div
                        key={idx}
                        className={`flex items-start sm:items-center justify-between p-3 rounded-xl border transition-colors flex-col sm:flex-row gap-2 ${
                          evt.event_type === 'media_permission_terminated'
                            ? 'border-red-300 bg-red-50/60'
                            : evt.event_type === 'media_permission_revoked'
                              ? 'border-amber-300 bg-amber-50/50'
                              : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] hover:bg-[var(--assessment-surface-container-low)]'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="font-mono text-[var(--assessment-on-surface-variant)] bg-[var(--assessment-surface-container-high)]/70 px-2 py-0.5 rounded text-xs shrink-0">
                            {timeStr}
                          </span>
                          <span className={`${style.colorClass} shrink-0`}>
                            <AssessmentMaterialIcon name={style.icon} size={18} />
                          </span>
                          <div className="min-w-0">
                            <span className="text-xs font-semibold text-[var(--assessment-on-surface)] block sm:inline">
                              {eventTitle(evt.event_type, evt.payload)}
                            </span>
                            <span className="text-xs text-[var(--assessment-on-surface-variant)] block sm:hidden">
                              {eventDetail(evt)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                          <span className="text-xs text-[var(--assessment-on-surface-variant)] hidden md:inline-block max-w-xs truncate text-right">
                            {eventDetail(evt)}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border text-[11px] font-bold uppercase ${style.bgClass}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${style.dotClass}`} />
                            {evt.severity}
                          </span>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="p-8 text-center border border-dashed border-[var(--assessment-outline-variant)] rounded-2xl bg-[var(--assessment-surface-container-low)]">
                    <AssessmentMaterialIcon
                      name="check_circle"
                      size={32}
                      className="text-emerald-600 mx-auto mb-2"
                    />
                    <p className="text-sm font-semibold text-[var(--assessment-on-surface)]">
                      No events found in this category.
                    </p>
                    <p className="text-xs text-[var(--assessment-on-surface-variant)] mt-1">
                      Candidate operated within normal parameters with zero recorded incidents.
                    </p>
                  </div>
                )}
              </div>

              {/* Show All / Show Less Toggle */}
              {filteredEvents.length > 8 && (
                <div className="pt-2 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setShowAllEvents(!showAllEvents)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] hover:bg-[var(--assessment-surface-container-low)] text-xs font-semibold text-[var(--assessment-primary)] transition shadow-sm"
                  >
                    <span>
                      {showAllEvents
                        ? 'Show fewer events'
                        : `Show all ${filteredEvents.length} events`}
                    </span>
                    <AssessmentMaterialIcon
                      name={showAllEvents ? 'expand_less' : 'expand_more'}
                      size={16}
                    />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
