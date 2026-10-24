'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { NexusStatusBadge } from '@/modules/job-profiles/components/NexusStatusBadge';
import { ProfileHealthGauge } from '@/modules/job-profiles/components/ProfileHealthGauge';
import {
  getExtendedJobProfileAnalytics,
  getJobProfile,
  getJobProfileAiInsights,
} from '@/modules/job-profiles/lib/job-profiles-api';

function healthLabel(score: number) {
  if (score >= 80) return 'OPTIMIZED';
  if (score >= 60) return 'HEALTHY';
  return 'NEEDS WORK';
}

type TimeRangeOption = '7' | '30' | '90' | 'all';

export function JobProfileAnalyticsPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [timeRange, setTimeRange] = useState<TimeRangeOption>('30');

  const profileQuery = useQuery({
    queryKey: ['job-profile', id],
    queryFn: () => getJobProfile(id),
  });

  const aiQuery = useQuery({
    queryKey: ['job-profile-ai-insights', id],
    queryFn: () => getJobProfileAiInsights(id),
  });

  const analyticsQuery = useQuery({
    queryKey: ['job-profile-analytics', id, timeRange],
    queryFn: () =>
      getExtendedJobProfileAnalytics(id, timeRange === 'all' ? null : Number(timeRange)),
  });

  if (profileQuery.isLoading || analyticsQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="flex items-center gap-2 text-sm text-[var(--assessment-on-surface-variant)]">
          <AssessmentMaterialIcon name="sync" size={20} className="animate-spin text-[var(--assessment-primary)]" />
          <span>Loading analytics & telemetry...</span>
        </div>
      </div>
    );
  }
  if (profileQuery.isError || analyticsQuery.isError || !profileQuery.data || !analyticsQuery.data) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-800">
        Failed to load analytics. Please refresh or try again.
      </div>
    );
  }

  const profile = profileQuery.data.profile;
  const analytics = analyticsQuery.data;
  const aiInsights = aiQuery.data;
  const healthScore = aiInsights?.health_score ?? analytics.health_score;
  const maxFunnel = Math.max(1, analytics.funnel[0]?.count ?? 1);
  const fairnessBuckets = aiInsights?.fairness?.buckets ?? [];
  const maxBucketScore = Math.max(1, ...fairnessBuckets.map((b) => b.avg_score));

  const compBenchmark = aiInsights?.compensation_benchmark as
    | { band_min?: number; band_max?: number; median?: number; percentile_25?: number; percentile_75?: number }
    | null
    | undefined;

  const location = [profile.department, profile.location_text || profile.location_mode]
    .filter(Boolean)
    .join(' - ');

  const assessmentMetrics = analytics.assessment_metrics;
  const totalBreaches = analytics.stage_sla?.reduce((acc, s) => acc + s.sla_breaches, 0) ?? 0;

  const timeRangeLabel =
    timeRange === 'all' ? 'All Time' : `Last ${timeRange} Days`;

  return (
    <>
      <div className="w-full space-y-6">
        {/* Top Header Row with Time-Range Filter */}
        <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
          <div>
            <div className="mb-2 flex items-center gap-3">
              <NexusStatusBadge status={profile.status} />
              <h2 className="font-display-lg">{profile.title}</h2>
            </div>
            <p className="text-sm text-[var(--assessment-on-surface-variant)]">
              Profile ID: #{profile.slug} - {location || 'No location'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Functional Time Range Filter */}
            <div className="flex items-center gap-1 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-1">
              {(['7', '30', '90', 'all'] as const).map((r) => {
                const active = timeRange === r;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setTimeRange(r)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                      active
                        ? 'bg-[var(--assessment-primary)] text-white shadow-sm'
                        : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-low)] hover:text-[var(--assessment-on-surface)]'
                    }`}
                  >
                    {r === 'all' ? 'All Time' : `${r}D`}
                  </button>
                );
              })}
            </div>

            <Link
              href={`/assessments/job-profiles/${id}/configure`}
              className="flex items-center gap-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3.5 py-2 text-sm font-semibold hover:bg-[var(--assessment-surface-container-high)] shadow-sm"
            >
              <AssessmentMaterialIcon name="edit" size={18} />
              Configure
            </Link>
            <Link
              href={`/assessments/job-profiles/${id}/preview`}
              className="flex items-center gap-2 rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90 shadow-sm"
            >
              <AssessmentMaterialIcon name="share" size={18} />
              Preview report
            </Link>
          </div>
        </div>

        {/* Assessment Performance & Proctoring Health (Item 3) */}
        {assessmentMetrics ? (
          <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--assessment-primary-container)] text-[var(--assessment-primary)]">
                  <AssessmentMaterialIcon name="verified_user" size={18} />
                </div>
                <div>
                  <h3 className="font-title-sm text-sm font-bold text-[var(--assessment-on-surface)]">
                    Assessment Performance & Proctoring Health
                  </h3>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                    Aggregated scores, candidate throughput & proctoring integrity ({timeRangeLabel})
                  </p>
                </div>
              </div>
              <span className="rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-3 py-0.5 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                {assessmentMetrics.total_interviews} Total Interview Session(s)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Tile 1: Voice / Verbal Defense Score */}
              <div className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-3.5">
                <div className="flex items-center justify-between text-xs text-[var(--assessment-on-surface-variant)] font-semibold uppercase tracking-wider">
                  <span>Voice Defense Avg</span>
                  <AssessmentMaterialIcon name="record_voice_over" size={16} className="text-blue-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-[var(--assessment-on-surface)]">
                    {assessmentMetrics.avg_voice_score != null
                      ? `${assessmentMetrics.avg_voice_score} / 10`
                      : '—'}
                  </span>
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                    {assessmentMetrics.avg_voice_score && assessmentMetrics.avg_voice_score >= 6
                      ? 'Solid'
                      : 'Evaluating'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                  AI interviewer verbal evaluation
                </p>
              </div>

              {/* Tile 2: Coding Quality Score */}
              <div className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-3.5">
                <div className="flex items-center justify-between text-xs text-[var(--assessment-on-surface-variant)] font-semibold uppercase tracking-wider">
                  <span>Coding Quality Avg</span>
                  <AssessmentMaterialIcon name="code" size={16} className="text-indigo-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-[var(--assessment-on-surface)]">
                    {assessmentMetrics.avg_coding_score != null
                      ? `${assessmentMetrics.avg_coding_score}%`
                      : '—'}
                  </span>
                  <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                    {assessmentMetrics.avg_coding_score != null ? 'Sandbox' : 'Not required'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                  Automated test case pass rate
                </p>
              </div>

              {/* Tile 3: Proctoring Integrity Rate */}
              <div className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-3.5">
                <div className="flex items-center justify-between text-xs text-[var(--assessment-on-surface-variant)] font-semibold uppercase tracking-wider">
                  <span>Proctoring Clean Rate</span>
                  <AssessmentMaterialIcon name="shield" size={16} className="text-emerald-600" />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-[var(--assessment-on-surface)]">
                    {assessmentMetrics.proctor_pass_rate_pct}%
                  </span>
                  <span
                    className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                      assessmentMetrics.proctor_pass_rate_pct >= 80
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {assessmentMetrics.proctor_pass_rate_pct >= 80 ? 'Optimal' : 'Flagged'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                  {assessmentMetrics.proctor_clean_count} sessions without termination
                </p>
              </div>

              {/* Tile 4: Proctoring Disqualifications & Strikes */}
              <div
                className={`rounded-lg border p-3.5 ${
                  assessmentMetrics.proctor_terminated_count > 0
                    ? 'border-red-200 bg-red-50/50'
                    : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]'
                }`}
              >
                <div className="flex items-center justify-between text-xs text-[var(--assessment-on-surface-variant)] font-semibold uppercase tracking-wider">
                  <span>Interruption Violations</span>
                  <AssessmentMaterialIcon
                    name="gavel"
                    size={16}
                    className={
                      assessmentMetrics.proctor_terminated_count > 0 ? 'text-red-600' : 'text-slate-400'
                    }
                  />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold font-mono text-[var(--assessment-on-surface)]">
                    {assessmentMetrics.proctor_terminated_count}
                  </span>
                  <span
                    className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                      assessmentMetrics.proctor_terminated_count > 0
                        ? 'bg-red-100 text-red-800'
                        : 'bg-emerald-100 text-emerald-800'
                    }`}
                  >
                    {assessmentMetrics.proctor_terminated_count > 0 ? 'Terminated' : 'Zero Breaches'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                  {assessmentMetrics.proctor_strike_count} camera disconnect strike(s) logged
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-12 gap-6">
          {/* Overall Profile Health */}
          <div className="col-span-12 flex flex-col justify-between rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 lg:col-span-4 shadow-sm">
            <div>
              <h3 className="font-title-sm mb-4">Overall profile health</h3>
              <ProfileHealthGauge score={healthScore} label={healthLabel(healthScore)} />
            </div>
            <div className="mt-6 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--assessment-on-surface-variant)]">Alignment score</span>
                <span className="font-mono-data text-[var(--assessment-primary)] font-bold">
                  {analytics.alignment_score}/100
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-[var(--assessment-on-surface-variant)]">Fairness index</span>
                <span className="font-mono-data text-[var(--assessment-primary)] font-bold">
                  {analytics.fairness_index}/100
                </span>
              </div>
            </div>
          </div>

          {/* AI Strategic Insights */}
          <div className="nexus-glass-ai col-span-12 rounded-xl p-6 lg:col-span-8 shadow-sm">
            <div className="mb-6 flex items-center gap-2">
              <AssessmentMaterialIcon name="auto_awesome" size={22} className="text-[var(--nexus-secondary)]" />
              <h3 className="font-title-sm text-[var(--nexus-on-secondary-container,#1e3a8a)]">
                AI strategic insights
              </h3>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {analytics.insights.slice(0, 2).map((insight) => (
                <div
                  key={insight.title}
                  className="rounded-lg border border-[var(--assessment-outline-variant)]/40 bg-[var(--assessment-surface-container)] p-4 shadow-xs"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <AssessmentMaterialIcon
                      name={insight.type === 'warning' ? 'warning' : 'info'}
                      size={18}
                      className={
                        insight.type === 'warning'
                          ? 'text-[var(--assessment-error,#dc2626)]'
                          : 'text-[var(--nexus-secondary)]'
                      }
                    />
                    <p className="text-sm font-semibold">{insight.title}</p>
                  </div>
                  <p className="mb-3 text-sm text-[var(--assessment-on-surface-variant)]">{insight.message}</p>
                  <Link
                    href={`/assessments/job-profiles/${id}/configure`}
                    className="font-label-caps text-[10px] uppercase text-[var(--assessment-primary)] hover:underline font-bold"
                  >
                    Take action →
                  </Link>
                </div>
              ))}
            </div>
            {analytics.insights[0] ? (
              <div className="mt-6 flex items-center gap-4 rounded-lg bg-[var(--nexus-secondary)]/10 p-4">
                <div className="rounded-lg bg-[var(--nexus-secondary)] p-2 text-white">
                  <AssessmentMaterialIcon name="trending_up" size={20} />
                </div>
                <p className="text-sm italic text-[var(--nexus-on-secondary-container,#1e3a8a)]">
                  &ldquo;{analytics.insights[0].message}&rdquo;
                </p>
              </div>
            ) : null}
          </div>

          {/* Funnel Conversion & Drop-off */}
          <div className="col-span-12 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 lg:col-span-7 shadow-sm">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="font-title-sm">Funnel conversion &amp; drop-off</h3>
                <p className="text-xs text-[var(--assessment-on-surface-variant)] mt-0.5">
                  Candidate volume across stages ({timeRangeLabel})
                </p>
              </div>
              <span className="rounded-lg bg-[var(--assessment-surface-container-low)] border border-[var(--assessment-outline-variant)] px-3 py-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                {timeRangeLabel}
              </span>
            </div>
            <div className="space-y-6">
              {analytics.funnel.map((stage, idx) => {
                const pct = maxFunnel ? Math.round((stage.count / maxFunnel) * 100) : 0;
                const prev = idx > 0 ? analytics.funnel[idx - 1]?.count ?? 0 : stage.count;
                const drop = prev > 0 && idx > 0 ? Math.round((1 - stage.count / prev) * 100) : 0;
                return (
                  <div key={stage.stage_id}>
                    <div className="mb-2 flex justify-between text-sm">
                      <span className="font-label-caps font-bold">
                        {idx + 1}. {stage.name.toUpperCase()}
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono-data text-xs font-semibold">
                          {stage.count} candidates ({pct}%)
                        </span>
                        {drop > 0 ? (
                          <span className="flex items-center text-xs font-bold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                            <AssessmentMaterialIcon name="arrow_downward" size={14} />
                            {drop}% drop
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div
                      className="nexus-pipeline-bar bg-[var(--assessment-primary)]"
                      style={{
                        width: `${Math.min(100, Math.max(4, pct))}%`,
                        opacity: 1 - idx * 0.15,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stage SLA & Pipeline Bottlenecks (Item 2) */}
          <div className="col-span-12 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 lg:col-span-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-title-sm text-sm font-bold text-[var(--assessment-on-surface)]">
                  Stage SLA &amp; Bottlenecks
                </h3>
                <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                  Threshold: {analytics.stall_threshold_days} days in stage
                </p>
              </div>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold border ${
                  totalBreaches > 0
                    ? 'bg-amber-50 text-amber-800 border-amber-200'
                    : 'bg-emerald-50 text-emerald-800 border-emerald-200'
                }`}
              >
                {totalBreaches > 0 ? `${totalBreaches} SLA Breached` : 'All On Track'}
              </span>
            </div>

            <div className="space-y-3 mt-4">
              {analytics.stage_sla && analytics.stage_sla.length > 0 ? (
                analytics.stage_sla.map((s) => (
                  <div
                    key={s.stage_id}
                    className="flex items-center justify-between p-3 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]"
                  >
                    <div>
                      <div className="text-xs font-bold text-[var(--assessment-on-surface)]">
                        {s.name}
                      </div>
                      <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                        {s.candidates} candidate(s) currently in stage
                      </div>
                    </div>
                    <div>
                      {s.sla_breaches > 0 ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">
                          <AssessmentMaterialIcon name="schedule" size={14} />
                          {s.sla_breaches} Stalled (&gt;{analytics.stall_threshold_days}d)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-full">
                          <AssessmentMaterialIcon name="check_circle" size={14} />
                          On Track
                        </span>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-4 text-center border border-dashed border-[var(--assessment-outline-variant)] rounded-lg text-xs text-[var(--assessment-on-surface-variant)]">
                  No stages configured for this profile.
                </div>
              )}
            </div>

            <div className="mt-4 rounded-lg border border-[var(--assessment-outline-variant)]/40 bg-[var(--assessment-surface-container)] p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-[var(--assessment-on-surface)]">
                <AssessmentMaterialIcon name="speed" size={16} className="text-[var(--assessment-primary)]" />
                <span>Pipeline Velocity</span>
              </div>
              <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)] leading-relaxed">
                Avg time-to-fill is{' '}
                <strong className="text-[var(--assessment-on-surface)]">
                  {analytics.time_to_fill_days != null ? `${analytics.time_to_fill_days} days` : 'not yet calculated'}
                </strong>
                . Candidates exceeding {analytics.stall_threshold_days} days without movement require recruiter review.
              </p>
            </div>
          </div>

          {/* Fairness Calibration */}
          <div className="col-span-12 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 lg:col-span-5 shadow-sm">
            <h3 className="font-title-sm mb-2">Fairness calibration</h3>
            <p className="mb-4 text-sm text-[var(--assessment-on-surface-variant)]">
              Score distribution by candidate cohorts to ensure equitable rubric performance.
            </p>
            <div className="flex h-40 items-end gap-2 px-2 pb-2">
              {fairnessBuckets.map((b, i) => (
                <div key={b.label} className="group relative flex-1">
                  <div
                    className="rounded-t-sm bg-[var(--assessment-primary)]"
                    style={{
                      height: `${Math.max(20, (b.avg_score / maxBucketScore) * 100)}%`,
                      opacity: 0.2 + i * 0.2,
                    }}
                  />
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 font-mono-data text-[10px] opacity-0 transition-opacity group-hover:opacity-100 font-bold">
                    {b.avg_score}
                  </div>
                </div>
              ))}
            </div>
            <div className="flex justify-between border-t border-[var(--assessment-outline-variant)] pt-2">
              {fairnessBuckets.map((b) => (
                <span key={b.label} className="font-label-caps text-[10px]">
                  {b.label}
                </span>
              ))}
            </div>
            <div className="mt-4 rounded-lg border border-[var(--assessment-outline-variant)]/30 bg-[var(--assessment-surface-container)] p-3">
              <div className="flex items-center gap-2 text-[var(--assessment-primary)]">
                <AssessmentMaterialIcon name="check_circle" size={18} />
                <p className="text-sm font-semibold">Variance within threshold</p>
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--assessment-on-surface-variant)]">
                {aiInsights?.fairness?.note ??
                  'Bias alert thresholds not met. Current rubric is performing equitably.'}
              </p>
            </div>
          </div>

          {/* Market Benchmark (Total Compensation) */}
          <div className="col-span-12 overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 lg:col-span-7 shadow-sm">
            <div className="flex flex-col items-center gap-8 md:flex-row">
              <div className="flex-1">
                <h3 className="font-title-sm mb-2">Market benchmark (total compensation)</h3>
                <p className="mb-6 text-sm text-[var(--assessment-on-surface-variant)]">
                  Current:{' '}
                  <span className="font-mono-data font-bold text-[var(--assessment-primary)]">
                    {profile.compensation_band_min != null && profile.compensation_band_max != null
                      ? `${profile.currency ?? ''} ${profile.compensation_band_min}k - ${profile.compensation_band_max}k`
                      : compBenchmark
                        ? `$${compBenchmark.band_min ?? '-'}k - $${compBenchmark.band_max ?? '-'}k`
                        : 'Not set'}
                  </span>
                </p>
                <div className="relative flex h-20 items-center rounded-lg bg-[var(--assessment-surface-container-low)] px-8">
                  <div className="absolute left-10 right-10 h-px bg-[var(--assessment-outline-variant)]" />
                  <div className="absolute left-[20%] flex flex-col items-center">
                    <div className="mb-1 h-6 w-px bg-[var(--assessment-outline-variant)]" />
                    <span className="font-mono-data text-[10px]">
                      {compBenchmark?.percentile_25 ?? profile.compensation_band_min ?? '-'}k
                    </span>
                    <span className="font-label-caps text-[8px] text-[var(--nexus-outline)]">25th</span>
                  </div>
                  <div className="absolute left-[50%] flex -translate-x-1/2 flex-col items-center">
                    <div className="mb-1 h-8 w-px bg-[var(--assessment-primary)]" />
                    <span className="font-mono-data text-[10px] font-bold text-[var(--assessment-primary)]">
                      {compBenchmark?.median ?? '-'}k
                    </span>
                    <span className="font-label-caps text-[8px] text-[var(--assessment-primary)]">Median</span>
                  </div>
                  <div className="absolute left-[80%] flex flex-col items-center">
                    <div className="mb-1 h-6 w-px bg-[var(--assessment-outline-variant)]" />
                    <span className="font-mono-data text-[10px]">
                      {compBenchmark?.percentile_75 ?? profile.compensation_band_max ?? '-'}k
                    </span>
                    <span className="font-label-caps text-[8px] text-[var(--nexus-outline)]">75th</span>
                  </div>
                  {profile.compensation_band_min != null && profile.compensation_band_max != null ? (
                    <div className="absolute left-[28%] h-4 w-[38%] rounded border-x-2 border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/20" />
                  ) : null}
                </div>
              </div>
              <div className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4 md:w-72">
                <h4 className="font-label-caps mb-3 font-bold text-xs">Pipeline Overview</h4>
                <ul className="space-y-3 text-sm">
                  <li className="flex justify-between">
                    <span className="text-[var(--assessment-on-surface-variant)] text-xs">Total Applications</span>
                    <span className="font-mono-data text-[var(--assessment-primary)] font-bold text-xs">
                      {analytics.totals.applications}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-[var(--assessment-on-surface-variant)] text-xs">Hired Candidates</span>
                    <span className="font-mono-data text-emerald-700 font-bold text-xs">
                      {analytics.totals.hired}
                    </span>
                  </li>
                  <li className="flex justify-between">
                    <span className="text-[var(--assessment-on-surface-variant)] text-xs">Avg. Time to Fill</span>
                    <span className="font-mono-data font-bold text-xs text-[var(--assessment-on-surface)]">
                      {analytics.time_to_fill_days != null ? `${analytics.time_to_fill_days} days` : '—'}
                    </span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="nexus-fab">
        <Link
          href={`/assessments/job-profiles/${id}/configure`}
          className="nexus-btn-primary flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-110"
        >
          <AssessmentMaterialIcon name="auto_awesome" size={28} />
        </Link>
      </div>
    </>
  );
}
