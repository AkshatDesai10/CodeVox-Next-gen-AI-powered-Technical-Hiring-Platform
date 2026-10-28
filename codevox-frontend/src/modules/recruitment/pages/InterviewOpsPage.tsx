'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RecruitmentOpsShell } from '@/modules/recruitment/components/RecruitmentOpsShell';
import {
  getTodayInterviews,
  type RecruitmentInterviewItem,
} from '@/modules/recruitment/lib/recruitment-api';

export function InterviewOpsPage() {
  const [search, setSearch] = useState('');

  const todayQuery = useQuery({
    queryKey: ['recruitment-interviews-today'],
    queryFn: getTodayInterviews,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 8_000,
  });

  const today = todayQuery.data?.items ?? [];

  const candidates = useMemo(() => {
    const grouped = processInterviews(today);
    const q = search.trim().toLowerCase();
    if (!q) return grouped;
    return grouped.filter(
      (c) =>
        c.candidateName.toLowerCase().includes(q) ||
        c.jobProfile.toLowerCase().includes(q) ||
        c.leadId.toLowerCase().includes(q),
    );
  }, [today, search]);

  const todayLabel = formatDateDMY(new Date().toISOString());

  return (
    <RecruitmentOpsShell>
      <div className="flex flex-col gap-8 pb-12">
        <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="space-y-1">
            <h1 className="font-headline-lg text-[var(--assessment-on-background)]">
              Today&apos;s Interviews
            </h1>
            <p className="text-sm text-[var(--assessment-on-surface-variant)]">
              {todayLabel} • Monitor and manage candidates scheduled for today.
            </p>
          </div>
          <div className="relative w-full max-w-sm">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[var(--assessment-outline)]">
              search
            </span>
            <input
              className="w-full rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] py-2 pl-10 pr-4 text-sm shadow-sm outline-none transition-all focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
              placeholder="Search candidates or jobs..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </header>

        <section className="nexus-tonal-layer overflow-hidden rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] shadow-sm">
          {todayQuery.isLoading ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-[var(--assessment-on-surface-variant)]">
              <span className="material-symbols-outlined animate-spin text-4xl text-[var(--assessment-primary)]">
                progress_activity
              </span>
              <p className="text-sm font-medium">Loading today&apos;s schedule...</p>
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-4 py-20 text-[var(--assessment-on-surface-variant)]">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[var(--assessment-surface-container)]">
                <span className="material-symbols-outlined text-3xl">event_busy</span>
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold text-[var(--assessment-on-surface)]">No Interviews Today</h3>
                <p className="mt-1 text-sm">There are no candidates scheduled for today yet.</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[800px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)]">
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                      Candidate
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                      Job Profile
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                      Round Progress
                    </th>
                    <th className="px-6 py-4 text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                      Overall Status
                    </th>
                    <th className="px-6 py-4 text-right text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--assessment-outline-variant)]">
                  {candidates.map((c) => (
                    <CandidateRow key={c.leadId} candidate={c} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </RecruitmentOpsShell>
  );
}

function CandidateRow({ candidate: c }: { candidate: GroupedCandidate }) {
  const isAnyRoundLive = c.rounds.some((r) => r.status === 'live');
  const isAllCompleted = c.completedCount === c.totalCount && c.totalCount > 0;
  const activeRound =
    c.rounds.find((r) => r.status === 'live') ||
    c.rounds.find((r) => r.status === 'not_started') ||
    c.rounds.find((r) => r.status === 'upcoming') ||
    c.rounds[c.rounds.length - 1];
  const joinUrl = activeRound?.joinUrl;
  const monitorUrl = activeRound?.monitorUrl;

  const reportUrl = c.applicationId
    ? `/assessments/assessment-reports/${c.applicationId}`
    : c.inviteToken
    ? `/assessments/interview-reports/${encodeURIComponent(c.inviteToken)}`
    : null;

  let statusColor = 'bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface)]';
  if (isAllCompleted) {
    statusColor = 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30';
  } else if (isAnyRoundLive) {
    statusColor = 'bg-rose-950/40 text-rose-300 border border-rose-500/30';
  } else if (c.rounds.some((r) => r.status === 'no-show')) {
    statusColor = 'bg-rose-950/40 text-rose-300 border border-rose-500/30';
  }

  return (
    <tr className="group transition-colors hover:bg-[var(--assessment-surface-container-lowest)]">
      <td className="px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--assessment-primary)]/10 text-sm font-bold text-[var(--assessment-primary)]">
            {c.initials}
          </div>
          <div>
            <div className="font-semibold text-[var(--assessment-on-surface)]">{c.candidateName}</div>
            <div className="text-xs text-[var(--assessment-on-surface-variant)]">ID: {truncateId(c.leadId)}</div>
          </div>
        </div>
      </td>
      <td className="px-6 py-4">
        <span className="inline-flex items-center gap-1.5 rounded-md bg-[var(--assessment-surface-container-low)] px-2.5 py-1 text-xs font-medium text-[var(--assessment-on-surface)]">
          <span className="material-symbols-outlined text-[14px] text-[var(--assessment-on-surface-variant)]">work</span>
          {c.jobProfile}
        </span>
      </td>
      <td className="px-6 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {c.rounds.map((r, idx) => (
            <div key={r.id} className="flex items-center gap-2">
              <span className="flex items-center gap-1.5 text-xs font-medium text-[var(--assessment-on-surface)]">
                <span className="text-[var(--assessment-on-surface-variant)]">Round {idx + 1}</span>
                <span className="text-[var(--assessment-outline)]">—</span>
                {r.status === 'completed' && (
                  <span className="text-[10px] font-bold uppercase text-green-600">Completed</span>
                )}
                {r.status === 'live' && (
                  <span className="flex items-center gap-1 rounded-full bg-rose-950/50 border border-rose-500/30 px-1.5 py-0.5 font-bold text-rose-400">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-600"></span> Live
                  </span>
                )}
                {r.status === 'not_started' && (
                  <span className="text-[10px] font-bold uppercase text-sky-700">
                    Not started
                  </span>
                )}
                {r.status === 'upcoming' && (
                  <span className="text-[10px] font-bold uppercase text-[var(--assessment-outline)]">
                    Upcoming
                  </span>
                )}
                {r.status === 'no-show' && (
                  <span className="text-[10px] font-bold uppercase text-red-500">No-show</span>
                )}
              </span>
              {idx < c.rounds.length - 1 && (
                <span className="text-[var(--assessment-outline-variant)]">|</span>
              )}
            </div>
          ))}
        </div>
      </td>
      <td className="px-6 py-4">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusColor}`}>
          {c.overallStatusText}
        </span>
      </td>
      <td className="px-6 py-4 text-right">
        <div className="flex items-center justify-end gap-2">
          {isAnyRoundLive && monitorUrl && (
            <Link
              href={monitorUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-md transition-all hover:bg-rose-500 animate-pulse"
            >
              <span className="h-2 w-2 rounded-full bg-white" />
              <span className="material-symbols-outlined text-[16px]">visibility</span>
              Monitor Live
            </Link>
          )}

          {reportUrl && (isAllCompleted || c.completedCount > 0) && (
            <Link
              href={reportUrl}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--assessment-primary)] px-3.5 py-2 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-[var(--assessment-primary)]/90"
            >
              <span className="material-symbols-outlined text-[16px]">assessment</span>
              View Report
            </Link>
          )}

          {!isAnyRoundLive && !isAllCompleted && joinUrl && (
            <Link
              href={joinUrl}
              target={monitorUrl ? '_self' : '_blank'}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-xs font-bold uppercase tracking-wide text-white transition-colors hover:bg-[var(--assessment-primary)]/90"
            >
              <span className="material-symbols-outlined text-[16px]">
                {monitorUrl ? 'visibility' : 'videocam'}
              </span>
              {monitorUrl ? 'Monitor' : 'Join'}
            </Link>
          )}

          {!isAnyRoundLive && !reportUrl && !joinUrl && (
            <Link
              href={`/assessments/recruitment/interviews/${c.leadId}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--assessment-outline)] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--assessment-on-surface)] transition-colors hover:bg-[var(--assessment-surface-container-low)]"
            >
              Details
            </Link>
          )}
        </div>
      </td>
    </tr>
  );
}


// --- Data Processing Helpers ---

type GroupedCandidate = {
  leadId: string;
  applicationId?: string | null;
  inviteToken?: string | null;
  candidateName: string;
  initials: string;
  jobProfile: string;
  rounds: Array<{
    id: string;
    type: string;
    status: 'completed' | 'live' | 'not_started' | 'upcoming' | 'no-show';
    joinUrl: string | null;
    monitorUrl: string | null;
    originalStatus: string;
  }>;
  completedCount: number;
  totalCount: number;
  overallStatusText: string;
};

function getRoundStatus(row: RecruitmentInterviewItem) {
  const s = (row.effective_status ?? row.interview_status ?? '').toLowerCase();
  if (s.includes('no') && s.includes('show')) return 'no-show';
  if (s.includes('complete') || s.includes('result')) return 'completed';
  if (s.includes('progress') || s.includes('live')) return 'live';
  return 'upcoming';
}

function processInterviews(items: RecruitmentInterviewItem[]): GroupedCandidate[] {
  const grouped = new Map<string, GroupedCandidate>();
  // Preserve API newest-first order across groups.
  const order: string[] = [];

  for (const row of items) {
    const leadId = row.lead_id || row.id || 'unknown';
    const appId =
      row.application_id ??
      (row.lead_id?.startsWith('app:') ? row.lead_id.slice(4) : (row.lead_id?.startsWith('demo:') ? row.lead_id.slice(5) : null));

    let group = grouped.get(leadId);
    if (!group) {
      group = {
        leadId,
        applicationId: appId,
        inviteToken: row.invite_token ?? null,
        candidateName: row.candidate_name || 'Candidate',
        initials: candidateInitials(row.candidate_name),
        jobProfile: row.course_name || 'Interview',
        rounds: [],
        completedCount: 0,
        totalCount: 0,
        overallStatusText: '',
      };
      grouped.set(leadId, group);
      order.push(leadId);
    }

    const monitorToken = row.invite_token || null;
    const monitorUrl = monitorToken
      ? `/assessments/recruitment/monitor/${encodeURIComponent(monitorToken)}`
      : null;
    const joinUrl = monitorUrl || row.join_url || row.meeting_url || null;

    // Prefer real job-profile pipeline rounds when present (demo / magic-link portal).
    if (row.pipeline_rounds?.length && group.rounds.length === 0) {
      group.rounds = row.pipeline_rounds.map((r) => ({
        id: r.id,
        type: r.name || r.type || 'Round',
        status: r.status,
        joinUrl,
        monitorUrl,
        originalStatus: r.status,
      }));
      group.totalCount = row.rounds_total ?? row.pipeline_rounds.length;
      group.completedCount =
        row.rounds_completed ??
        row.pipeline_rounds.filter((r) => r.status === 'completed').length;
    } else if (!row.pipeline_rounds?.length) {
      group.rounds.push({
        id: row.interview_ref_id ?? row.overlay_id ?? row.id ?? Math.random().toString(),
        type: row.interview_type || 'Interview',
        status: getRoundStatus(row),
        joinUrl,
        monitorUrl,
        originalStatus: (row.effective_status ?? row.interview_status ?? 'Scheduled').toString(),
      });
    }
  }

  const result = order.map((id) => grouped.get(id)!).filter(Boolean);

  for (const candidate of result) {
    if (!candidate.totalCount) {
      candidate.totalCount = candidate.rounds.length;
      candidate.completedCount = candidate.rounds.filter((r) => r.status === 'completed').length;
    }

    if (candidate.completedCount === candidate.totalCount && candidate.totalCount > 0) {
      candidate.overallStatusText =
        candidate.totalCount === 1 ? 'Round Completed' : 'All Rounds Completed';
    } else {
      candidate.overallStatusText = `${candidate.completedCount} of ${candidate.totalCount} Completed`;
    }
  }

  return result;
}

function candidateInitials(name: string | null | undefined) {
  if (!name?.trim()) return '-';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

function formatDateDMY(value: string | null | undefined): string {
  if (!value) return '-';
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (isoMatch) {
    return `${Number(isoMatch[3])}/${Number(isoMatch[2])}/${isoMatch[1]}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

function truncateId(id: string) {
  if (id.length <= 8) return id;
  return `${id.slice(0, 4)}...${id.slice(-4)}`;
}
