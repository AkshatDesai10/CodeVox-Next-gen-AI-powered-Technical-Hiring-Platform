'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { getAssessmentDashboardSummary } from '@/lib/assessments-api';
import { getJobProfilesDashboardStats } from '@/modules/job-profiles/lib/job-profiles-api';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

export function AssessmentDashboardPage() {
  const statsQuery = useQuery({
    queryKey: ['job-profiles-dashboard-stats'],
    queryFn: getJobProfilesDashboardStats,
    refetchInterval: 10000,
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['assessment-dashboard-summary'],
    queryFn: async () => (await getAssessmentDashboardSummary()).data,
    refetchInterval: 10000,
  });

  if (isLoading) {
    return <div className="text-[#A5ABC3]">Loading dashboard…</div>;
  }
  if (error) {
    return <div className="text-[#fb7185]">Server Error — Contact Administrator</div>;
  }

  const cards = [
    {
      label: 'Candidates',
      value: data?.candidateCount ?? 0,
      icon: 'groups',
      href: '/assessments/recruitment/leads',
      subtext: 'Registered pipeline',
    },
    {
      label: 'Job Profiles',
      value: data?.assessmentCount ?? 0,
      icon: 'work',
      href: '/assessments/job-profiles',
      subtext: 'Active evaluation setups',
    },
    {
      label: 'Active Attempts',
      value: data?.activeAttempts ?? 0,
      icon: 'pending_actions',
      href: '/assessments/assessment-reports',
      subtext: 'In-progress evaluations',
    },
    {
      label: 'Completed',
      value: data?.completedAttempts ?? 0,
      icon: 'task_alt',
      href: '/assessments/assessment-reports',
      subtext: 'Graded attempts',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#E8C987]">Overview</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">
            Admin <span className="cvx-text-gradient">Dashboard</span>
          </h1>
          <p className="mt-1 text-sm text-[#A5ABC3]">
            Monitor pipelines, live interviews, and evaluation outcomes in real time.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/assessments/assessment-reports" className="cvx-btn-primary">
            <AssessmentMaterialIcon name="bar_chart" size={16} />
            Assessment Reports
          </Link>
          <Link href="/assessments/job-profiles" className="cvx-btn-ghost">
            <AssessmentMaterialIcon name="work" size={16} />
            Job Profiles
          </Link>
          <Link href="/assessments/job-profiles/problem-bank" className="cvx-btn-ghost">
            <AssessmentMaterialIcon name="code" size={16} />
            Problem Bank
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="assessment-card group block cursor-pointer p-5"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[#A5ABC3]">{card.label}</p>
                <p className="mt-2 text-3xl font-bold text-white transition-colors group-hover:text-[#BAE6FD]">
                  {card.value}
                </p>
                <p className="mt-1 text-[11px] text-[#6B7192]">{card.subtext}</p>
              </div>
              <div className="rounded-xl bg-[rgba(99,102,241,0.15)] p-2.5 text-[#BAE6FD] transition-transform group-hover:scale-105">
                <AssessmentMaterialIcon name={card.icon} size={28} />
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* --- DYNAMIC WIDGETS --- */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 mt-8">
          {/* Widget 1: Problem Bank Analytics */}
          <div className="assessment-card p-6 border-l-4 border-l-[var(--assessment-primary)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-label-caps text-[var(--assessment-on-surface)]">
                Problem Bank Health
              </h3>
              <AssessmentMaterialIcon name="database" size={20} className="text-[var(--assessment-on-surface-variant)]" />
            </div>
            
            <div className="flex gap-8 mb-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7192]">Draft</p>
                <p className="font-display-lg text-2xl text-[var(--assessment-on-surface)] font-bold">{(statsQuery.data?.problemBank?.totalDraft || 0)}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7192]">Published</p>
                <p className="font-display-lg text-2xl text-[var(--assessment-primary)] font-bold">{(statsQuery.data?.problemBank?.totalPublished || 0)}</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-[#6B7192]">Coding vs Database</span>
                <span className="font-bold">{(statsQuery.data?.problemBank?.codingProblems || 0)} / {(statsQuery.data?.problemBank?.databaseProblems || 0)}</span>
              </div>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div className="bg-[#6366F1] transition-all" style={{ width: `${((statsQuery.data?.problemBank?.codingProblems || 0) / (((statsQuery.data?.problemBank?.codingProblems || 0) + (statsQuery.data?.problemBank?.databaseProblems || 0)) || 1)) * 100}%` }}></div>
                <div className="bg-[#E8C987] transition-all" style={{ width: `${((statsQuery.data?.problemBank?.databaseProblems || 0) / (((statsQuery.data?.problemBank?.codingProblems || 0) + (statsQuery.data?.problemBank?.databaseProblems || 0)) || 1)) * 100}%` }}></div>
              </div>
            </div>
          </div>

          {/* Widget 2: Integrity Alerts */}
          <div className="assessment-card p-6 border-l-4 border-l-[var(--assessment-error,#dc2626)]">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 font-label-caps text-[var(--assessment-on-surface)]">
                Live Integrity Monitor
                <span className="relative flex h-2 w-2 ml-1">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75"></span>
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500"></span>
                </span>
              </h3>
              <AssessmentMaterialIcon name="security" size={20} className="text-[var(--assessment-on-surface-variant)]" />
            </div>
            
            <div className="flex justify-between mb-6">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7192]">Active Tests</p>
                <p className="font-display-lg text-2xl text-[var(--assessment-on-surface)] font-bold">{data?.integrity?.activeTests ?? data?.activeAttempts ?? 0}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7192]">Flagged</p>
                <p className="font-display-lg text-2xl text-[var(--assessment-error,#dc2626)] font-bold">{data?.integrity?.flaggedCandidates ?? 0}</p>
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7192]">Trust Score</p>
                <p className="font-display-lg text-2xl text-[#00897b] font-bold">{data?.integrity?.averageTrustScore ?? 100}%</p>
              </div>
            </div>

            {(data?.integrity?.flaggedCandidates ?? 0) > 0 ? (
              <div className="flex items-center gap-2 text-xs text-[var(--assessment-error,#dc2626)]">
                <AssessmentMaterialIcon name="warning" size={16} />
                {data?.integrity?.flaggedCandidates} integrity {data?.integrity?.flaggedCandidates === 1 ? 'flag' : 'flags'} in the last 7 days
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-[#00897b]">
                <AssessmentMaterialIcon name="check_circle" size={16} />
                No integrity flags in the last 7 days
              </div>
            )}
          </div>
        </div>
      {/* --- END DYNAMIC WIDGETS --- */}

      {/* --- Dashboard Analytics & Activities --- */}
      <div className="grid gap-6 xl:grid-cols-3 mt-8">
        
        {/* Left Column (Span 2): Weekly Chart & Recent Assessments */}
        <div className="xl:col-span-2 space-y-6">
          
          {/* 1. Bar Chart */}
          <div className="assessment-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-[var(--assessment-primary)] flex items-center gap-2">
                  <AssessmentMaterialIcon name="bar_chart" size={20} />
                  Assessments Conducted This Week
                </h2>
                <p className="text-xs text-[var(--assessment-on-surface-variant)] mt-0.5">
                  Real-time count of candidates assessed over the last 7 days.
                </p>
              </div>
              {(() => {
                const totalConducted = (data?.chartData || []).reduce((sum, d) => sum + (d.count || 0), 0);
                return (
                  <span className="text-xs font-bold px-3 py-1.5 rounded-full bg-[var(--assessment-primary)]/10 text-[var(--assessment-primary)] border border-[var(--assessment-primary)]/20 shadow-sm">
                    {totalConducted} Candidates Assessed
                  </span>
                );
              })()}
            </div>

            {/* CSS-based Bar Chart with Permanent Count Labels */}
            <div className="flex h-44 items-end justify-between border-b border-white/10 pb-2 pt-6">
              {(() => {
                const chartData = data?.chartData || [];
                if (chartData.length === 0) {
                  return <div className="w-full pb-4 text-center text-sm text-[#6B7192]">No data available</div>;
                }
                const maxCount = Math.max(...chartData.map((d) => d.count), 1);

                return chartData.map((d, i) => {
                  const heightPercent = d.count > 0 ? 15 + (d.count / maxCount) * 85 : 0;
                  return (
                    <div
                      key={i}
                      className="relative flex h-full w-1/12 flex-col items-center justify-end"
                    >
                      <span
                        className={`mb-1.5 rounded-md px-2 py-0.5 text-xs font-bold ${
                          d.count > 0
                            ? 'bg-[rgba(99,102,241,0.18)] text-[#BAE6FD] ring-1 ring-[rgba(99,102,241,0.3)]'
                            : 'bg-white/5 text-[#6B7192]'
                        }`}
                      >
                        {d.count}
                      </span>
                      <div
                        className={`w-full rounded-t-md transition-all ${
                          d.count > 0
                            ? 'bg-gradient-to-t from-[#6366F1] to-[#67E8F9] shadow-[0_0_16px_rgba(99,102,241,0.35)]'
                            : 'bg-white/10'
                        }`}
                        style={{ height: d.count > 0 ? `${heightPercent}%` : '4px' }}
                      />
                    </div>
                  );
                });
              })()}
            </div>

            {/* Day and Date Labels Row - Permanently Visible Below Chart */}
            <div className="flex justify-between pt-2.5">
              {(() => {
                const chartData = data?.chartData || [];
                const formatDateLabel = (dateStr?: string) => {
                  if (!dateStr) return '';
                  const parts = dateStr.split('-');
                  if (parts.length === 3) {
                    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const m = parseInt(parts[1], 10) - 1;
                    const dayNum = parseInt(parts[2], 10);
                    return `${dayNum} ${months[m] || ''}`;
                  }
                  return dateStr;
                };

                return chartData.map((d, i) => (
                  <div key={i} className="flex flex-col items-center w-1/12 text-center">
                    <span className="text-xs font-semibold text-[#A5ABC3]">{d.day}</span>
                    {d.date && (
                      <span className="mt-0.5 whitespace-nowrap text-[10px] text-[#6B7192]">
                        {formatDateLabel(d.date)}
                      </span>
                    )}
                  </div>
                ));
              })()}
            </div>
          </div>

          {/* 2. Recent Assessments Table */}
          <div className="assessment-card overflow-hidden p-0">
            <div className="flex items-center justify-between border-b border-white/8 bg-white/[0.02] p-5">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                  <AssessmentMaterialIcon name="history" size={20} />
                  Recent Evaluations
                </h2>
                <p className="mt-0.5 text-xs text-[#6B7192]">
                  Candidates evaluated across assessment and interview stages
                </p>
              </div>
              <Link
                href="/assessments/assessment-reports"
                className="flex items-center gap-1 text-sm font-medium text-[#BAE6FD] hover:text-[#67E8F9]"
              >
                View All Reports →
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-white/[0.03] font-medium text-[#A5ABC3]">
                  <tr>
                    <th className="px-5 py-3">Candidate</th>
                    <th className="px-5 py-3">Role Applied</th>
                    <th className="px-5 py-3">Decision</th>
                    <th className="px-5 py-3">Overall Score</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8">
                  {data?.recentActivity?.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-5 py-8 text-center text-[#6B7192]">
                        No recent assessments found.
                      </td>
                    </tr>
                  ) : (
                    (data?.recentActivity || []).map((row, i) => {
                      const scoreNum = Number(row.score);
                      const rec = row.recommendation ? row.recommendation.toLowerCase() : '';
                      const isStrongHire = rec.includes('strong');
                      const isHire =
                        rec.includes('hire') && !rec.includes('do_not') && !rec.includes('reject');

                      return (
                        <tr key={i} className="transition-colors hover:bg-white/[0.03]">
                          <td className="px-5 py-3 font-medium text-white">
                            <div className="flex items-center gap-2.5">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[rgba(99,102,241,0.18)] text-xs font-bold text-[#BAE6FD]">
                                {row.name?.charAt(0) || 'C'}
                              </div>
                              <span>{row.name}</span>
                            </div>
                          </td>
                          <td className="px-5 py-3 text-[#A5ABC3]">{row.role}</td>
                          <td className="px-5 py-3">
                            {row.recommendation ? (
                              <span
                                className={`inline-flex items-center rounded-lg px-2 py-0.5 text-[11px] font-semibold ${
                                  isStrongHire
                                    ? 'bg-[rgba(16,185,129,0.14)] text-[#34d399]'
                                    : isHire
                                      ? 'bg-[rgba(99,102,241,0.18)] text-[#c7d2fe]'
                                      : 'bg-[rgba(245,158,11,0.14)] text-[#fbbf24]'
                                }`}
                              >
                                {row.recommendation.replace(/_/g, ' ')}
                              </span>
                            ) : (
                              <span className="text-xs text-[#6B7192]">Under Review</span>
                            )}
                          </td>
                          <td className="px-5 py-3">
                            <span
                              className={`rounded-lg px-2 py-1 text-xs font-bold ${
                                scoreNum >= 75
                                  ? 'bg-[rgba(16,185,129,0.14)] text-[#34d399]'
                                  : scoreNum >= 50
                                    ? 'bg-[rgba(245,158,11,0.14)] text-[#fbbf24]'
                                    : 'bg-[rgba(244,63,94,0.14)] text-[#fb7185]'
                              }`}
                            >
                              {scoreNum.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-5 py-3 text-right">
                            <Link
                              href="/assessments/assessment-reports"
                              className="inline-block rounded-lg bg-white/5 px-2.5 py-1 text-xs font-semibold text-[#A5ABC3] transition-colors hover:bg-[rgba(99,102,241,0.25)] hover:text-white"
                            >
                              Report
                            </Link>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Right Column (Span 1): Top Performers & Real Insights */}
        <div className="space-y-6">
          
          {/* 3. Top Performers Leaderboard */}
          <div className="assessment-card border-t-2 border-t-[#6366F1] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
                <AssessmentMaterialIcon name="workspace_premium" size={20} className="text-[#E8C987]" />
                Top Candidates
              </h2>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7192]">
                By Score
              </span>
            </div>
            <div className="space-y-3">
              {data?.topPerformers?.length === 0 ? (
                <div className="py-6 text-center text-sm text-[#6B7192]">No graded candidates yet.</div>
              ) : (
                (data?.topPerformers || []).map((cand, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] p-3 transition-all hover:border-[#6366F1]/35"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${
                          i === 0
                            ? 'bg-[rgba(232,201,135,0.18)] text-[#E8C987] ring-1 ring-[#E8C987]/30'
                            : i === 1
                              ? 'bg-white/10 text-[#A5ABC3]'
                              : i === 2
                                ? 'bg-[rgba(245,158,11,0.14)] text-[#fbbf24]'
                                : 'bg-[rgba(99,102,241,0.18)] text-[#BAE6FD]'
                        }`}
                      >
                        #{i + 1}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{cand.name}</p>
                        <p className="text-xs text-[#6B7192]">{cand.role}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-bold text-[#67E8F9]">
                        {Number(cand.score).toFixed(1)}%
                      </div>
                      {cand.recommendation && (
                        <div className="text-[10px] capitalize text-[#6B7192]">
                          {cand.recommendation.replace(/_/g, ' ')}
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="assessment-card bg-gradient-to-br from-[#171933] to-[#0F1020] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-white">
              <AssessmentMaterialIcon name="insights" size={18} className="text-[#BAE6FD]" />
              Evaluation Cohort Insights
            </h2>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7192]">
                  Avg Cohort Score
                </p>
                <p className="mt-1 text-xl font-bold text-white">
                  {data?.reportsInsights?.avgCohortScorePct != null
                    ? `${data.reportsInsights.avgCohortScorePct}%`
                    : 'N/A'}
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7192]">
                  Strong Hires
                </p>
                <p className="mt-1 text-xl font-bold text-[#34d399]">
                  {data?.reportsInsights?.strongHireCount ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7192]">
                  Pending Review
                </p>
                <p className="mt-1 text-xl font-bold text-[#fbbf24]">
                  {data?.reportsInsights?.pendingReviewCount ?? 0}
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[#6B7192]">
                  Total Evaluations
                </p>
                <p className="mt-1 text-xl font-bold text-[#BAE6FD]">
                  {data?.completedAttempts ?? 0}
                </p>
              </div>
            </div>
            <Link
              href="/assessments/assessment-reports"
              className="cvx-btn-ghost flex w-full items-center justify-center gap-1.5 py-2 text-xs"
            >
              Open Assessment Reports
              <AssessmentMaterialIcon name="arrow_forward" size={14} />
            </Link>
          </div>

        </div>

      </div>
    </div>
  );
}
