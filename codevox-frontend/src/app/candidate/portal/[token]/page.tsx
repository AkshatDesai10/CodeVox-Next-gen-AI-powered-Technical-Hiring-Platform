'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { recruitmentApiBase } from '@/lib/recruitment-api-base';
import { withBasePath } from '@/lib/with-base-path';
import {
  getCandidateDashboard,
  saveCandidatePortalPreferences,
} from '@/lib/candidate-api';
import { getCandidateRuntimeConfig } from '@/modules/recruitment/lib/configurations-api';
import { applyRuntimeProctorConfig } from '@/modules/autonomous-interview/lib/runtime-proctor-config';
import { CandidatePortalOnboardingGate } from '@/modules/job-profiles/components/CandidatePortalOnboardingGate';
import { SystemReadinessLobby } from '@/modules/job-profiles/components/SystemReadinessLobby';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

interface StageDto {
  id: string;
  name: string;
  type: string;
  sortOrder: number;
  status: 'COMPLETED' | 'IN_PROGRESS' | 'LOCKED' | 'NOT_STARTED';
  description: string | null;
}

interface DashboardPayload {
  candidate: { id: string; name: string; email: string };
  application: {
    id: string;
    status: string;
    appliedAt: string;
    auto_action?: string | null;
  };
  interview_language?: 'en' | 'hi';
  guidelines_accepted?: boolean;
  identity?: {
    required: boolean;
    mode?: 'face' | 'permissions_only';
    consent_recorded: boolean;
    face_captured: boolean;
    complete: boolean;
    consent_text: string;
    face_photo_url?: string | null;
  };
  onboarding?: {
    needs_name: boolean;
    needs_resume: boolean;
    complete: boolean;
    assigned_slot_label?: string | null;
  };
  job: {
    id: string;
    title: string;
    department: string | null;
    location: string | null;
    responsibilities: string[] | null;
    requiredSkills: string[] | null;
    progressionMode?: string;
  };
  stages: StageDto[];
  resume_screening?: {
    status: string | null;
    score: number | null;
    confidence: number | null;
    summary: string | null;
    strengths: string[];
    gaps: string[];
    analyzed_at: string | null;
    error: string | null;
  } | null;
}

function getLaunchUrl(token: string, stage: StageDto) {
  const type = stage.type?.toLowerCase() || '';
  const name = stage.name?.toLowerCase() || '';
  if (type === 'ai_screening' || name.includes('screening')) {
    return `/autonomous-interview/${token}`;
  }
  if (type === 'ai_verbal' || type === 'ai_interview' || type === 'hr_verbal') {
    return `/autonomous-interview/${token}`;
  }
  if (type === 'coding' || type === 'coding_assessment') {
    return `/candidate/coding/${token}`;
  }
  if (type === 'mcq_assessment' || type === 'assessment') {
    return `/assessments/candidate/${token}`;
  }
  if (type === 'take_home') {
    return `/assessments/candidate/take-home/${token}`;
  }
  if (type === 'project_interview') {
    return `/assessments/candidate/project-interview/${token}`;
  }
  return '#';
}

function formatStageType(type: string, name?: string) {
  const n = (name || '').toLowerCase();
  const t = (type || '').toLowerCase();
  if (t === 'ai_screening' || t.includes('ai_screening') || n.includes('screening')) return 'AI Screening';
  if (t.includes('ai_verbal')) return 'AI Verbal Interview';
  if (t.includes('hr_verbal')) return 'HR Interview';
  if (t.includes('coding')) return 'Coding Assessment';
  if (t.includes('take_home')) return 'Take Home Assignment';
  if (t.includes('project_interview')) return 'Build & Defend';
  if (t.includes('mcq')) return 'MCQ Assessment';
  if (t.includes('custom') && !n.includes('screening')) return 'Custom Round';
  if (!type) return 'Round';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase());
}

function getRulesForStage(type: string, name?: string) {
  const t = type?.toLowerCase() || '';
  const n = (name || '').toLowerCase();

  if (t === 'ai_screening' || t.includes('ai_screening') || n.includes('screening')) {
    return [
      {
        id: 1,
        title: 'Environment & Setup',
        desc: 'Ensure a stable internet connection and a quiet, distraction-free environment.',
        tag: 'Required',
        tagColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      },
      {
        id: 2,
        title: 'Camera & Microphone Active',
        desc: 'Both camera and microphone are required for facial integrity checks and natural voice interaction.',
        tag: 'Mandatory',
        tagColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      },
      {
        id: 3,
        title: 'Autonomous Integrity Verification',
        desc: 'Answer autonomously. Do not switch tabs, consult notes, or use third-party AI assistance during the conversation.',
        tag: 'Strict Policy',
        tagColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      },
    ];
  }

  if (t.includes('coding')) {
    return [
      {
        id: 1,
        title: 'Environment & Device Setup',
        desc: 'Ensure you are in a quiet, well-lit room. A stable broadband connection, active webcam, and microphone are strictly mandatory.',
        tag: 'Strict Policy',
        tagColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      },
      {
        id: 2,
        title: 'Prohibited Resources & Tab Switching',
        desc: 'Tab-switching, secondary monitors, ChatGPT/Copilot, and copy-pasting code are strictly detected. Flagged attempts result in immediate disqualification.',
        tag: 'Auto Rejected',
        tagColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      },
      {
        id: 3,
        title: 'Audio & Visual Surveillance',
        desc: 'Maintain screen sharing and camera feed. Background voices, multiple faces, or unauthorized persons in the frame will invalidate the session.',
        tag: 'Proctored',
        tagColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      },
      {
        id: 4,
        title: 'Keystroke & Behavioral Tracking',
        desc: 'Automated keystroke dynamics and sandbox execution runtime analysis are active. All code must be authored inside the CodeVox editor.',
        tag: 'Live Tracking',
        tagColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      },
      {
        id: 5,
        title: 'Verification & Test Submission',
        desc: 'Run sample and hidden test cases before final submission. Review execution efficiency and edge cases carefully.',
        tag: 'Verification',
        tagColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      },
    ];
  }

  if (t.includes('take_home')) {
    return [
      {
        id: 1,
        title: 'Originality & Source Code Verification',
        desc: 'All submitted repositories and codebases are checked against open-source plagiarism and AI generative fingerprints.',
        tag: 'Strict Policy',
        tagColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      },
      {
        id: 2,
        title: 'Packaging & Documentation',
        desc: 'Provide an architecture breakdown, Docker/local setup guide, and clean commit history in your public repository.',
        tag: 'Required',
        tagColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      },
      {
        id: 3,
        title: 'Submission Deadline & Window',
        desc: 'The completion window begins as soon as you confirm start. Track your remaining time carefully.',
        tag: 'Monitored',
        tagColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      },
    ];
  }

  if (t.includes('project_interview')) {
    return [
      {
        id: 1,
        title: 'Single Project Lock-In',
        desc: 'Choose one project prompt from the options. Once confirmed, the project selection cannot be altered.',
        tag: 'Single Choice',
        tagColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      },
      {
        id: 2,
        title: 'Public Repository & Architecture',
        desc: 'Develop the solution independently and submit a valid GitHub repository with a README and instructions.',
        tag: 'Required',
        tagColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      },
      {
        id: 3,
        title: 'Autonomous Code Defense Follow-Up',
        desc: 'Once your repository is processed, an AI voice defense session will probe your architectural choices, libraries, and design trade-offs.',
        tag: 'Proctored',
        tagColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      },
      {
        id: 4,
        title: 'Technical Depth',
        desc: 'Expect targeted conceptual questions about your schemas, dependencies, logic patterns, and edge-case handling.',
        tag: 'Evaluation',
        tagColor: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
      },
    ];
  }

  if (t.includes('ai_verbal') || t.includes('ai_interview') || t.includes('hr_verbal')) {
    return [
      {
        id: 1,
        title: 'Stable Network & Quiet Environment',
        desc: 'Ensure a high-speed broadband connection and a quiet room. Weak network or ambient noise can disrupt real-time voice streaming.',
        tag: 'Mandatory',
        tagColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
      },
      {
        id: 2,
        title: 'Camera & Microphone Active',
        desc: 'Keep both camera and microphone enabled. Maintain direct gaze toward your screen and articulate your thoughts clearly.',
        tag: 'Required',
        tagColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      },
      {
        id: 3,
        title: 'Turn-Taking & Complete Listening',
        desc: 'Wait for the AI interviewer to finish speaking before you begin responding. Do not speak simultaneously to ensure clear transcription.',
        tag: 'Turn-Taking',
        tagColor: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
      },
      {
        id: 4,
        title: '3-Second Answer Completion & Pause Buffer',
        desc: 'After you stop speaking, the AI observes a 3-second pause buffer to confirm your answer has concluded. Keep pauses under 3 seconds to avoid premature progression.',
        tag: 'Pause Buffer',
        tagColor: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      },
    ];
  }

  return [
    {
      id: 1,
      title: 'Environment & Setup',
      desc: 'Ensure a stable connection and quiet environment for the duration of this round.',
      tag: 'Required',
      tagColor: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    },
    {
      id: 2,
      title: 'Autonomous Integrity',
      desc: 'Complete the evaluation independently without unauthorized third-party aids or external collaboration.',
      tag: 'Strict Policy',
      tagColor: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
    },
  ];
}

export default function CandidatePortalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams?: Promise<{ completed?: string }>;
}) {
  const { token } = use(params);
  const unwrappedSearch = searchParams ? use(searchParams) : {};
  const queryClient = useQueryClient();

  const [agreed, setAgreed] = useState(false);
  const [language, setLanguage] = useState<'en' | 'hi'>('en');
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [startingStage, setStartingStage] = useState<string | null>(null);
  const [activeRuleTab, setActiveRuleTab] = useState<string | null>(null);

  const devicesSessionKey = `portalDevicesVerified:${token}`;
  const [devicesVerified, setDevicesVerified] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['candidate-portal', token],
    queryFn: async () => {
      const response = await getCandidateDashboard(token);
      return response.data as DashboardPayload;
    },
    refetchInterval: (query) => {
      const status = query.state.data?.resume_screening?.status;
      return status === 'PENDING' ? 4000 : false;
    },
  });

  const runtimeQuery = useQuery({
    queryKey: ['candidate-runtime-config'],
    queryFn: getCandidateRuntimeConfig,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (runtimeQuery.data) applyRuntimeProctorConfig(runtimeQuery.data);
  }, [runtimeQuery.data]);

  useEffect(() => {
    try {
      setDevicesVerified(sessionStorage.getItem(devicesSessionKey) === '1');
    } catch {
      setDevicesVerified(false);
    }
  }, [devicesSessionKey]);

  useEffect(() => {
    if (!data) return;
    if (data.guidelines_accepted) setAgreed(true);
    if (data.interview_language === 'hi' || data.interview_language === 'en') {
      setLanguage(data.interview_language);
    }
  }, [data]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050B18] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#1685FF] border-t-transparent shadow-lg shadow-purple-500/20" />
          <span className="text-xs font-bold uppercase tracking-widest text-[#BAE6FD]">
            Loading Candidate Portal...
          </span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050B18] p-6 text-white">
        <div className="max-w-md rounded-2xl border border-red-500/20 bg-[#0B1930] p-8 text-center shadow-2xl">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 text-red-400">
            <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-extrabold text-white">Session Unavailable</h2>
          <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
            This assessment link may have expired or is invalid. Please contact the recruiting team if you believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  const identity = data.identity;
  const identityMode: 'face' | 'permissions_only' =
    identity?.mode ?? (identity?.required === false ? 'permissions_only' : 'face');
  const identityComplete = Boolean(identity?.complete);
  // Prefer runtime-config so FACE toggles apply immediately even if dashboard identity.mode is stale.
  const faceMode = runtimeQuery.data
    ? runtimeQuery.data.face === 'on'
    : identityMode === 'face';
  const needsFaceGate = faceMode && !identityComplete;
  const needsPermissionsGate = !faceMode && !devicesVerified;
  const needsIdentityGate = needsFaceGate || needsPermissionsGate;
  const gateBlockedLabel = faceMode ? 'System check required' : 'Device & network check required';
  const gateBlockedAlert = faceMode
    ? 'Please complete the system readiness lobby (camera, mic, network, and face) before starting a round.'
    : 'Please complete the system readiness lobby (camera, mic, and network) before starting a round.';

  const needsOnboarding = Boolean(data.onboarding && !data.onboarding.complete);

  if (needsOnboarding && data.onboarding) {
    return (
      <div className="min-h-screen bg-[#050B18] text-white font-sans">
        <CandidatePortalOnboardingGate
          token={token}
          jobTitle={data.job.title}
          email={data.candidate.email}
          needsName={data.onboarding.needs_name}
          needsResume={data.onboarding.needs_resume}
          assignedSlotLabel={data.onboarding.assigned_slot_label}
          initialName={data.candidate.name}
          onComplete={async () => {
            await queryClient.invalidateQueries({ queryKey: ['candidate-portal', token] });
            await refetch();
          }}
        />
      </div>
    );
  }

  const availableStage = data.stages.find((s) => s.status === 'IN_PROGRESS' || s.status === 'NOT_STARTED');
  const currentRuleTab = activeRuleTab || availableStage?.id || data.stages[0]?.id;
  const activeStage = data.stages.find((s) => s.id === currentRuleTab) || data.stages[0];
  const currentRules = activeStage ? getRulesForStage(activeStage.type, activeStage.name) : [];

  const eliminated =
    data.application.status === 'rejected' &&
    (data.application.auto_action === 'eliminated' || unwrappedSearch.completed === 'eliminated');

  if (eliminated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050B18] p-6 text-white font-sans">
        <div className="mx-auto max-w-xl rounded-3xl border border-red-500/20 bg-[#0B1930] p-10 text-center shadow-2xl">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">Assessment Concluded</h1>
          <h2 className="mt-2 text-lg font-medium text-[#BAE6FD]">Thank you for your time and participation</h2>
          <div className="mt-6 space-y-3 rounded-2xl border border-white/5 bg-[#050B18]/50 p-6 text-sm text-[var(--assessment-on-surface-variant)]">
            <p>
              Unfortunately, your score criteria in this assessment did not meet the advancement threshold for this role.
            </p>
            <p>We appreciate your dedication and wish you the very best in your future endeavors.</p>
          </div>
        </div>
      </div>
    );
  }

  const remainingRounds = data.stages.some(
    (s) => s.status === 'LOCKED' || s.status === 'NOT_STARTED' || s.status === 'IN_PROGRESS',
  );
  const allCompleted =
    !remainingRounds &&
    ((data.stages.length > 0 && data.stages.every((s) => s.status === 'COMPLETED')) ||
      data.application.status === 'rejected' ||
      (unwrappedSearch.completed === 'true' && data.stages.every((s) => s.status === 'COMPLETED')));

  if (allCompleted && identityComplete) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#050B18] p-6 text-white font-sans">
        <div className="mx-auto max-w-xl rounded-3xl border border-emerald-500/30 bg-[#0B1930] p-10 text-center shadow-2xl">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-400 shadow-lg shadow-emerald-500/20">
            <svg className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">All Rounds Complete!</h1>
          <h2 className="mt-2 text-lg font-medium text-[#34D399]">Your submission has been safely recorded</h2>
          <div className="mt-6 space-y-3 rounded-2xl border border-white/5 bg-[#050B18]/50 p-6 text-sm text-[#BAE6FD]">
            <p>All evaluation stages for this role have been finished successfully.</p>
            <p className="text-[var(--assessment-on-surface-variant)]">The talent team will review your proctoring logs and performance metrics and follow up via email.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="assessments-root min-h-screen bg-[#050B18] text-[#F8FAFC] font-sans selection:bg-[#1685FF]/30">
      {/* Unified Meet/Zoom-style system readiness lobby */}
      {needsIdentityGate ? (
        <SystemReadinessLobby
          portalToken={token}
          candidateName={data.candidate.name}
          faceMode={faceMode}
          consentText={
            identity?.consent_text ||
            'I consent to capture and store my facial photograph for identity verification and assessment integrity.'
          }
          consentAlreadyRecorded={Boolean(identity?.consent_recorded)}
          faceAlreadyCaptured={Boolean(identity?.face_captured)}
          startLabel="Enter Assessment Dashboard"
          title="System check"
          subtitle="Confirm camera, mic, and network before you enter — just like joining a video call."
          onComplete={async () => {
            if (!faceMode) {
              try {
                sessionStorage.setItem(devicesSessionKey, '1');
              } catch {
                /* ignore */
              }
              setDevicesVerified(true);
              return;
            }
            await queryClient.invalidateQueries({ queryKey: ['candidate-portal', token] });
            await refetch();
          }}
        />
      ) : null}

      <div className="mx-auto max-w-[1340px] p-6 lg:p-10 space-y-8">
        {/* Hero Header Card */}
        <div className="relative overflow-hidden rounded-3xl border border-[#293B57] bg-[#0B1930] p-8 lg:p-12 shadow-2xl backdrop-blur-md">
          {/* Ambient background glows */}
          <div className="pointer-events-none absolute -right-20 -top-20 h-96 w-96 rounded-full bg-[#1685FF]/20 blur-3xl" />
          <div className="pointer-events-none absolute right-1/3 -bottom-20 h-72 w-72 rounded-full bg-[#34D399]/10 blur-3xl" />

          <div className="relative z-10 flex flex-col md:flex-row items-start justify-between gap-8">
            <div className="flex flex-col sm:flex-row items-start gap-6">
              {identity?.face_photo_url ? (
                <div className="shrink-0 flex flex-col items-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={identity.face_photo_url}
                    alt={`${data.candidate.name} identity photo`}
                    className="h-24 w-24 lg:h-28 lg:w-28 rounded-2xl object-cover border-2 border-[#34D399] shadow-xl ring-4 ring-[#34D399]/20"
                  />
                  <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[#34D399]/10 border border-[#34D399]/30 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-[#34D399]">
                    <span className="h-1.5 w-1.5 rounded-full bg-[#34D399] animate-pulse" />
                    Verified
                  </div>
                </div>
              ) : null}

              <div>
                <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#1685FF]/20 border border-[#1685FF]/40 text-xs font-bold uppercase tracking-wider text-[#BAE6FD] mb-4">
                  <span className="h-2 w-2 rounded-full bg-[#34D399]" />
                  CodeVox Assessment Portal • ID: {data.application.id.slice(0, 8).toUpperCase()}
                </div>

                <h1 className="text-3xl lg:text-5xl font-black text-white tracking-tight">
                  Welcome, {data.candidate.name} 👋
                </h1>
                <h2 className="mt-2 text-xl lg:text-2xl font-bold text-[#38BDF8]">
                  {data.job.title}
                </h2>

                <div className="mt-5 flex flex-wrap gap-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#293B57] bg-[#050B18]/60 px-3.5 py-1.5 text-xs font-semibold text-[#BAE6FD]">
                    <svg className="h-3.5 w-3.5 text-[#1685FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    {data.job.department || 'Engineering'}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#293B57] bg-[#050B18]/60 px-3.5 py-1.5 text-xs font-semibold text-[#BAE6FD]">
                    <svg className="h-3.5 w-3.5 text-[#1685FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Full-Time
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#293B57] bg-[#050B18]/60 px-3.5 py-1.5 text-xs font-semibold text-[#BAE6FD]">
                    <svg className="h-3.5 w-3.5 text-[#1685FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    {data.job.location || 'Remote / Hybrid'}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-start md:items-end gap-3 shrink-0">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                {data.application.status === 'in_progress' ? 'IN PROGRESS' : data.application.status.replace('_', ' ').toUpperCase()}
              </div>
              <div className="text-xs font-medium text-[var(--assessment-on-surface-variant)]">
                Applied on {new Date(data.application.appliedAt).toLocaleDateString()}
              </div>

              {data.resume_screening ? (
                <div className="mt-3 w-full max-w-xs rounded-2xl border border-[#1685FF]/30 bg-[#050B18]/80 p-4 shadow-xl">
                  <div className="text-[10px] font-black uppercase tracking-wider text-[#38BDF8]">
                    Resume Match Score
                  </div>
                  {data.resume_screening.status === 'PENDING' ? (
                    <p className="mt-2 text-xs font-bold text-[#BAE6FD] animate-pulse">Analyzing resume...</p>
                  ) : data.resume_screening.score != null ? (
                    <>
                      <div className="mt-1 flex items-baseline gap-1.5">
                        <span className="text-3xl font-black text-white">
                          {Math.round(data.resume_screening.score)}
                        </span>
                        <span className="text-xs font-bold text-[var(--assessment-on-surface-variant)]">/ 100</span>
                      </div>
                      {data.resume_screening.summary ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-[var(--assessment-on-surface-variant)] line-clamp-2">
                          {data.resume_screening.summary}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 text-xs font-medium text-[var(--assessment-on-surface-variant)]">
                      {data.resume_screening.status === 'FAILED' ? 'Resume analysis failed' : 'Awaiting analysis'}
                    </p>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/* Language Selection Card */}
        <div className="rounded-2xl border border-[#293B57] bg-[#0B1930] p-6 shadow-xl">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-extrabold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-[#34D399]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
                </svg>
                Autonomous Interview Language
              </h2>
              <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                The AI conversational interviewer will communicate in your preferred dialect. English is the default setting.
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {([
                ['en', 'English'],
                ['hi', 'हिन्दी (Hindi)'],
              ] as const).map(([code, label]) => (
                <button
                  key={code}
                  type="button"
                  disabled={savingLanguage}
                  onClick={async () => {
                    if (code === language) return;
                    const prev = language;
                    setLanguage(code);
                    setSavingLanguage(true);
                    try {
                      await saveCandidatePortalPreferences(token, { interview_language: code });
                    } catch {
                      setLanguage(prev);
                      alert('Could not update interview language. Please try again.');
                    } finally {
                      setSavingLanguage(false);
                    }
                  }}
                  className={`rounded-xl px-4 py-2 text-xs font-extrabold transition-all border ${
                    language === code
                      ? 'bg-[#1685FF] text-white border-[#38BDF8] shadow-lg shadow-purple-500/20'
                      : 'bg-[#050B18] text-[#BAE6FD] border-[#293B57] hover:border-[#1685FF] hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main Content Split: Left Pipeline + Guidelines, Right Sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left Column: Guidelines & Stages Journey */}
          <div className="lg:col-span-8 space-y-8">
            {/* Elimination Round Warning Banner */}
            {data.job.progressionMode === 'elimination' && (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5 shadow-lg flex items-start gap-3">
                <svg className="h-6 w-6 text-amber-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <h4 className="text-sm font-black text-amber-300">Elimination Progression Mode Active</h4>
                  <p className="mt-1 text-xs text-amber-200/90 leading-relaxed font-medium">
                    You will only progress to subsequent assessment rounds if you achieve the required score cutoff in your current round. Falling below the threshold will result in disqualification.
                  </p>
                </div>
              </div>
            )}

            {/* Assessment Rules & Guidelines Section */}
            <div className="rounded-3xl border border-[#293B57] bg-[#0B1930] p-6 lg:p-8 shadow-xl relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl font-black text-white tracking-tight flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--assessment-primary)]/20 text-[var(--assessment-primary)] text-sm font-black">
                      <AssessmentMaterialIcon name="verified_user" size={18} />
                    </span>
                    Assessment Rules & Code of Conduct
                  </h2>
                  <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                    Review the strict integrity parameters enforced across each assessment stage.
                  </p>
                </div>

                {activeStage ? (
                  <span className="self-start sm:self-auto rounded-full bg-[#1685FF]/20 border border-[#1685FF]/40 px-3 py-1 text-[11px] font-black uppercase tracking-wider text-[#BAE6FD]">
                    Round {data.stages.findIndex((s) => s.id === activeStage.id) + 1}: {formatStageType(activeStage.type, activeStage.name)}
                  </span>
                ) : null}
              </div>

              {/* Stage Rules Selector Tabs */}
              {data.stages.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-6 border-b border-[#293B57] pb-4">
                  {data.stages.map((stage, idx) => {
                    const isActive = currentRuleTab === stage.id;
                    const isAvailable = stage.status === 'IN_PROGRESS' || stage.status === 'NOT_STARTED';
                    return (
                      <button
                        key={`tab-${stage.id}`}
                        onClick={() => setActiveRuleTab(stage.id)}
                        disabled={!isAvailable}
                        className={`rounded-xl px-3.5 py-2 text-xs font-extrabold transition-all border ${
                          isActive
                            ? 'bg-[#1685FF] text-white border-[#38BDF8] shadow-md shadow-purple-500/20'
                            : isAvailable
                            ? 'bg-[#050B18] text-[#BAE6FD] border-[#293B57] hover:border-[#1685FF]'
                            : 'bg-[#050B18]/40 text-[var(--assessment-on-surface-variant)]/40 border-transparent cursor-not-allowed'
                        }`}
                      >
                        Round {idx + 1}: {formatStageType(stage.type, stage.name)}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Rules List */}
              <div className="space-y-3">
                {currentRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 rounded-2xl border border-[#293B57]/60 bg-[#050B18]/70 p-4 transition-all hover:border-[#1685FF]/40"
                  >
                    <div className="flex items-start gap-3.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-[#1685FF]/20 border border-[#1685FF]/40 text-xs font-black text-[#34D399]">
                        {rule.id}
                      </div>
                      <div>
                        <h4 className="text-sm font-extrabold text-white">{rule.title}</h4>
                        <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)] leading-relaxed">{rule.desc}</p>
                      </div>
                    </div>
                    {rule.tag && (
                      <span className={`shrink-0 rounded-lg border px-2.5 py-1 text-[10px] font-black uppercase tracking-wider ${rule.tagColor}`}>
                        {rule.tag}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {/* Guidelines Acceptance Checkbox */}
              <div className="mt-6 rounded-2xl border border-[#1685FF]/40 bg-[#1685FF]/10 p-4 flex items-start gap-3 transition-colors hover:bg-[#1685FF]/15">
                <input
                  type="checkbox"
                  id="guidelines-consent"
                  checked={agreed}
                  disabled={Boolean(data.guidelines_accepted)}
                  onChange={async (e) => {
                    if (data.guidelines_accepted) return;
                    if (!e.target.checked) {
                      setAgreed(false);
                      return;
                    }
                    setAgreed(true);
                    try {
                      await saveCandidatePortalPreferences(token, { accept_guidelines: true });
                      await queryClient.invalidateQueries({ queryKey: ['candidate-portal', token] });
                    } catch {
                      setAgreed(false);
                      alert('Could not record your agreement. Please try again.');
                    }
                  }}
                  className="mt-0.5 h-5 w-5 rounded border-[#1685FF] bg-[#050B18] text-[#1685FF] focus:ring-[#1685FF] cursor-pointer disabled:cursor-default"
                />
                <label
                  htmlFor="guidelines-consent"
                  className="text-xs font-bold text-[#BAE6FD] leading-relaxed select-none cursor-pointer"
                >
                  {data.guidelines_accepted
                    ? 'You have already verified and accepted these proctoring rules. This integrity agreement is valid for all rounds.'
                    : 'I certify that I have read and agree to all proctoring guidelines. I understand that tab-switching, unauthorized assistance, or rule violations will result in automatic rejection.'}
                </label>
              </div>
            </div>

            {/* Application Pipeline Journey */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-black text-white tracking-tight">Application Stages</h3>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)] mt-0.5">Complete each evaluation stage sequentially.</p>
                </div>
              </div>

              <div className="space-y-4">
                {data.stages.map((stage, idx) => {
                  const isCompleted = stage.status === 'COMPLETED';
                  const isLocked = stage.status === 'LOCKED';
                  const isAvailable = stage.status === 'IN_PROGRESS' || stage.status === 'NOT_STARTED';

                  let statusBadgeBg = 'bg-[#050B18] text-[var(--assessment-on-surface-variant)] border-[#293B57]';
                  let statusText = stage.status.replace('_', ' ');
                  if (isCompleted) {
                    statusBadgeBg = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                    statusText = 'Completed';
                  } else if (isAvailable) {
                    statusBadgeBg = 'bg-[#1685FF]/20 text-[#34D399] border-[#1685FF]/40';
                    statusText = stage.status === 'IN_PROGRESS' ? 'In Progress' : 'Ready to Start';
                  }

                  return (
                    <div
                      key={stage.id}
                      className={`relative overflow-hidden rounded-2xl border transition-all ${
                        isAvailable
                          ? 'border-[#1685FF] bg-[#0B1930] shadow-xl shadow-purple-900/10'
                          : isCompleted
                          ? 'border-[#293B57]/80 bg-[#0B1930]/50'
                          : 'border-[#293B57]/40 bg-[#0B1930]/30 opacity-70'
                      } p-6`}
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-xl text-xs font-black ${
                              isCompleted
                                ? 'bg-emerald-500 text-black'
                                : isAvailable
                                ? 'bg-[#34D399] text-black ring-4 ring-[#34D399]/20'
                                : 'bg-[#2D1B69] text-[var(--assessment-on-surface-variant)]'
                            }`}
                          >
                            {isCompleted ? '✓' : idx + 1}
                          </div>
                          <div>
                            <span className="text-[10px] font-bold uppercase tracking-wider text-[#38BDF8]">
                              Round {idx + 1}
                            </span>
                            <h4 className="text-lg font-black text-white">{stage.name}</h4>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="rounded-lg border border-[#293B57] bg-[#050B18] px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-[#BAE6FD]">
                            {formatStageType(stage.type, stage.name)}
                          </span>
                          <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-black uppercase tracking-wider ${statusBadgeBg}`}>
                            {statusText}
                          </span>
                        </div>
                      </div>

                      {stage.description ? (
                        <p className="text-xs text-[var(--assessment-on-surface-variant)] leading-relaxed mb-6">
                          {stage.description}
                        </p>
                      ) : null}

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-[#293B57]/50">
                        <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[var(--assessment-on-surface-variant)]">
                          <span className="flex items-center gap-1.5 rounded-lg border border-[#293B57] bg-[#050B18] px-2.5 py-1">
                            <svg className="h-3.5 w-3.5 text-[#1685FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            Est. 30–45 mins
                          </span>
                          <span className="flex items-center gap-1.5 rounded-lg border border-[#293B57] bg-[#050B18] px-2.5 py-1">
                            <svg className="h-3.5 w-3.5 text-[#34D399]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            AI Proctoring Active
                          </span>
                        </div>

                        <div>
                          {isCompleted ? (
                            <span className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-2.5 text-xs font-bold text-emerald-400">
                              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                              Completed
                            </span>
                          ) : isLocked ? (
                            <button
                              disabled
                              className="rounded-xl border border-[#293B57] bg-[#050B18] px-6 py-2.5 text-xs font-bold text-[var(--assessment-on-surface-variant)]/60 cursor-not-allowed"
                            >
                              Locked
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={async (e) => {
                                e.preventDefault();
                                if (needsIdentityGate) {
                                  alert(gateBlockedAlert);
                                  return;
                                }
                                if (!agreed) {
                                  alert('You must read and agree to the Assessment Rules checklist before starting.');
                                  return;
                                }
                                try {
                                  setStartingStage(stage.id);
                                  const res = await fetch(
                                    `${recruitmentApiBase()}/api/candidate/portal/${token}/start`,
                                    {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ stageId: stage.id }),
                                    },
                                  );
                                  if (!res.ok) {
                                    const text = await res.text().catch(() => '');
                                    throw new Error(text || 'Failed to start stage');
                                  }
                                  const json = await res.json();
                                  if (json.data?.url) {
                                    if (json.data.token) {
                                      localStorage.setItem(`portalToken:${json.data.token}`, token);
                                    }
                                    window.location.href = withBasePath(json.data.url);
                                  }
                                } catch (err) {
                                  console.error(err);
                                  alert(err instanceof Error ? err.message : 'Error starting round');
                                } finally {
                                  setStartingStage(null);
                                }
                              }}
                              disabled={startingStage === stage.id || needsIdentityGate}
                              className={`group inline-flex items-center gap-2 rounded-xl px-7 py-3 text-xs font-black transition-all ${
                                agreed && !needsIdentityGate
                                  ? 'bg-[#34D399] text-black hover:bg-[#10B981] shadow-lg shadow-emerald-500/20 active:scale-95'
                                  : 'bg-[#050B18] text-[var(--assessment-on-surface-variant)] border border-[#293B57] cursor-not-allowed'
                              }`}
                            >
                              {startingStage === stage.id
                                ? 'Launching...'
                                : needsIdentityGate
                                ? gateBlockedLabel
                                : 'Start Round'}
                              <svg
                                className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Role Overview, Skills, Tips */}
          <div className="lg:col-span-4 space-y-6">
            {/* Role Overview */}
            <div className="rounded-3xl border border-[#293B57] bg-[#0B1930] p-6 shadow-xl">
              <div className="flex items-center gap-3 mb-4">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1685FF]/20 text-[#38BDF8]">
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-base font-extrabold text-white">Role Overview</h3>
              </div>

              {data.job.responsibilities && data.job.responsibilities.length > 0 ? (
                <div className="space-y-3">
                  <p className="text-xs text-[var(--assessment-on-surface-variant)] leading-relaxed">
                    As a {data.job.title}, you will be evaluated against the core responsibilities outlined below:
                  </p>
                  <ul className="space-y-2.5">
                    {data.job.responsibilities.map((resp, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-[#BAE6FD] leading-relaxed">
                        <span className="text-[#34D399] font-bold mt-0.5">•</span>
                        <span>{resp}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-xs italic text-[var(--assessment-on-surface-variant)]">No specific responsibilities specified for this role.</p>
              )}
            </div>

            {/* Required Skills */}
            {data.job.requiredSkills && data.job.requiredSkills.length > 0 && (
              <div className="rounded-3xl border border-[#293B57] bg-[#0B1930] p-6 shadow-xl">
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#34D399]/10 text-[#34D399]">
                    <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <h3 className="text-base font-extrabold text-white">Competencies & Skills</h3>
                </div>

                <div className="flex flex-wrap gap-2">
                  {data.job.requiredSkills.map((skill, i) => (
                    <span
                      key={i}
                      className="rounded-xl border border-[#293B57] bg-[#050B18] px-3 py-1.5 text-xs font-bold text-[#BAE6FD]"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Pro-Tips Card */}
            <div className="rounded-3xl border border-amber-500/20 bg-gradient-to-br from-amber-500/10 via-[#160A30] to-[#160A30] p-6 shadow-xl">
              <div className="flex items-center gap-2.5 mb-3">
                <span className="flex items-center text-[var(--color-primary)]"><AssessmentMaterialIcon name="lightbulb" size={20} /></span>
                <h3 className="text-sm font-extrabold text-amber-300">Candidate Pro-Tip</h3>
              </div>
              <p className="text-xs text-[#BAE6FD] leading-relaxed">
                Block uninterrupted time for Coding and AI Voice interview stages. Use headphones with a built-in microphone for clean audio fidelity, and keep an active window to prevent idle flags.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-12 pb-10 text-center text-xs text-[var(--assessment-on-surface-variant)]">
          Need technical assistance or accessibility accommodations?{' '}
          <a href="#" className="font-bold text-[#38BDF8] hover:text-[#34D399] underline transition-colors">
            Contact Support
          </a>
        </div>
      </div>
    </div>
  );
}
