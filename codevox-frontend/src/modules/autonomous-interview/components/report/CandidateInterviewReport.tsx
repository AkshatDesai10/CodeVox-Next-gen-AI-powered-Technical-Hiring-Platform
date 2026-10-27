'use client';

import '@/modules/autonomous-interview/styles/interview-report.css';
import { useEffect, useMemo, useState } from 'react';
import type {
  HrVoiceAudit,
  InterviewReportEnrichment,
  InterviewSessionReport,
} from '@/modules/autonomous-interview/types/interview-report';
import { ReportExecutiveBanner } from '@/modules/autonomous-interview/components/report/ReportExecutiveBanner';
import { SkillAlignmentGrid } from '@/modules/autonomous-interview/components/report/SkillAlignmentGrid';
import { InterviewTranscriptTimeline } from '@/modules/autonomous-interview/components/report/InterviewTranscriptTimeline';
import { SandboxCodingReport } from '@/modules/autonomous-interview/components/report/SandboxCodingReport';
import { InterviewIntegritySection } from '@/modules/autonomous-interview/components/report/InterviewIntegritySection';
import {
  EvaluationMatrixTable,
  buildMatrixRows,
  scoreTone,
} from '@/modules/autonomous-interview/components/report/EvaluationMatrixTable';
import { BehaviouralHrReport } from '@/modules/autonomous-interview/components/report/BehaviouralHrReport';
import { AiScreeningSummaryPanel } from '@/modules/autonomous-interview/components/report/AiScreeningSummaryPanel';
import { CandidateSessionRecordingPanel } from '@/modules/autonomous-interview/components/report/CandidateSessionRecordingPanel';
import {
  DEPTH_SCORE_MAX,
  computeScorecard,
  findProctorTermination,
  isTurnSkipped,
  resolveInterviewReportKind,
} from '@/modules/autonomous-interview/utils/interview-report';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

type Props = {
  report: InterviewSessionReport;
  enrichment?: InterviewReportEnrichment | null;
  candidateName?: string | null;
};

type TabId = 'overview' | 'transcript' | 'scorecard' | 'coding' | 'recording' | 'integrity';

function KpiTile(props: { icon: string; label: string; value: string; hint?: string; tone?: 'warn' }) {
  return (
    <div className="assessment-card flex items-center gap-3 p-4">
      <span
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
          props.tone === 'warn'
            ? 'bg-amber-50 text-amber-600'
            : 'bg-[var(--assessment-primary-container)] text-[var(--assessment-primary)]'
        }`}
      >
        <AssessmentMaterialIcon name={props.icon} size={20} />
      </span>
      <div className="min-w-0">
        <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
          {props.label}
        </div>
        <div className="text-lg font-bold tabular-nums text-[var(--assessment-on-surface)]">{props.value}</div>
        {props.hint ? (
          <div className="truncate text-xs text-[var(--assessment-on-surface-variant)]">{props.hint}</div>
        ) : null}
      </div>
    </div>
  );
}

export function CandidateInterviewReport({ report, enrichment = null, candidateName }: Props) {
  const scorecard = useMemo(() => computeScorecard(report, enrichment), [report, enrichment]);
  const matrix = useMemo(() => buildMatrixRows(report, scorecard), [report, scorecard]);
  const hrAudit =
    enrichment?.hrVoiceAudit ??
    (report as InterviewSessionReport & { hr_voice_audit?: HrVoiceAudit }).hr_voice_audit ??
    null;
  const screeningAudit = enrichment?.screeningVoiceAudit ?? null;
  const screeningChecks = screeningAudit?.screeningResult?.checks ?? [];
  const recordingUrl = enrichment?.recordingUrl ?? null;
  const recordings = enrichment?.recordings ?? [];
  const displayName = candidateName || report.candidate_name || null;
  const reportKind = resolveInterviewReportKind(report, enrichment);
  const integrity = enrichment?.integrity ?? null;
  const sandbox = enrichment?.sandbox ?? null;

  const turns = report.turns ?? [];
  const skipped = turns.filter(isTurnSkipped).length;
  const alignment = report.resume_alignment;
  const verified = alignment?.verified?.length ?? 0;
  const claimed = alignment?.resume_skills?.length ?? report.resume_skills?.length ?? 0;
  const proctorTermination = findProctorTermination(enrichment);
  const isTerminated =
    Boolean(proctorTermination) ||
    (enrichment?.integrity?.proctor_summary as any)?.terminated_by === 'proctor' ||
    (integrity?.proctor_events?.some(
      (e) => e.event_type === 'media_permission_terminated' || e.event_type === 'focus_strike_terminated',
    ) ?? false);
  const cameraStrikes =
    integrity?.proctor_events?.filter((e) => e.event_type === 'media_permission_revoked').length ?? 0;
  const criticalFlags =
    integrity?.proctor_events?.filter(
      (e) => e.event_type === 'media_permission_terminated' || e.event_type === 'multi_face'
    ).length ?? 0;
  const focusLossCount =
    integrity?.proctor_events?.filter(
      (e) => e.event_type === 'window_blur' || e.event_type === 'tab_hidden'
    ).length ?? 0;

  const significantFlagCount = isTerminated
    ? 1
    : cameraStrikes > 0
      ? cameraStrikes
      : criticalFlags > 0
        ? criticalFlags
        : focusLossCount > 5
          ? focusLossCount
          : 0;

  const recruiterBookmarks = useMemo(() => {
    const events = integrity?.proctor_events ?? [];
    return events
      .filter((e) => e.event_type === 'admin_flagged_moment')
      .map((e) => {
        const payload = (e.payload ?? {}) as Record<string, unknown>;
        const timestampSeconds = Number(payload.timestamp_seconds ?? 0);
        const elapsedLabel =
          typeof payload.elapsed_label === 'string' && payload.elapsed_label
            ? payload.elapsed_label
            : `${String(Math.floor(timestampSeconds / 60)).padStart(2, '0')}:${String(
                timestampSeconds % 60,
              ).padStart(2, '0')}`;
        return { elapsedLabel, timestampSeconds: Number.isFinite(timestampSeconds) ? timestampSeconds : 0 };
      })
      .filter((b) => b.timestampSeconds >= 0);
  }, [integrity?.proctor_events]);

  const tabs = useMemo(() => {
    const list: Array<{ id: TabId; label: string; icon: string; badge?: number | string }> = [
      { id: 'overview', label: 'Overview', icon: 'dashboard' },
      { id: 'transcript', label: 'Transcript', icon: 'forum', badge: turns.length },
      { id: 'scorecard', label: 'Scorecard', icon: 'fact_check' },
    ];
    if (sandbox?.hasSubmission) list.push({ id: 'coding', label: 'Coding', icon: 'code' });
    if (recordingUrl || recordings.length) {
      list.push({ id: 'recording', label: 'Recording', icon: 'videocam', badge: recordings.length || undefined });
    }
    if (integrity) {
      list.push({ id: 'integrity', label: 'Integrity', icon: 'shield', badge: significantFlagCount || undefined });
    }
    return list;
  }, [turns.length, sandbox?.hasSubmission, recordingUrl, recordings.length, integrity, significantFlagCount]);

  const [tab, setTab] = useState<TabId>('overview');

  useEffect(() => {
    const fromHash = window.location.hash.replace('#', '') as TabId;
    if (tabs.some((t) => t.id === fromHash)) setTab(fromHash);
  }, [tabs]);

  const selectTab = (id: TabId) => {
    setTab(id);
    window.history.replaceState(null, '', `#${id}`);
  };

  return (
    <div className="space-y-6">
      <ReportExecutiveBanner report={report} candidateName={displayName} enrichment={enrichment} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          icon="speed"
          label="Depth score"
          value={`${report.depth_score ?? '—'} / ${DEPTH_SCORE_MAX}`}
          hint={report.covered_topics?.length ? `${report.covered_topics.length} topics covered` : undefined}
        />
        <KpiTile
          icon="forum"
          label="Questions"
          value={String(turns.length)}
          hint={skipped ? `${skipped} skipped` : 'None skipped'}
        />
        <KpiTile
          icon="verified"
          label="Skills verified"
          value={claimed ? `${verified}/${claimed}` : String(verified)}
          hint={alignment?.skipped_due_to_struggles?.length ? `${alignment.skipped_due_to_struggles.length} struggled` : undefined}
        />
        {integrity ? (
          <KpiTile
            icon="shield"
            label="Integrity"
            value={
              isTerminated
                ? 'Terminated'
                : cameraStrikes > 0
                  ? `${cameraStrikes} Strike${cameraStrikes > 1 ? 's' : ''}`
                  : criticalFlags > 0
                    ? 'Alert'
                    : focusLossCount > 5
                      ? `${focusLossCount} Focus Losses`
                      : 'Verified'
            }
            hint={
              isTerminated
                ? 'Interruption limit exceeded'
                : cameraStrikes > 0
                  ? 'Camera interruptions logged'
                  : integrity.identity_verified_at
                    ? 'Identity verified'
                    : 'Continuous monitoring active'
            }
            tone={isTerminated || cameraStrikes > 0 || criticalFlags > 0 ? 'warn' : undefined}
          />
        ) : sandbox?.hasSubmission ? (
          <KpiTile
            icon="code"
            label="Coding score"
            value={sandbox.attemptScore != null ? `${sandbox.attemptScore}%` : '—'}
            hint={sandbox.totalTestCases ? `${sandbox.passedTestCases}/${sandbox.totalTestCases} tests` : undefined}
          />
        ) : (
          <KpiTile icon="topic" label="Topics skipped" value={String(report.skipped_topics?.length ?? 0)} />
        )}
      </div>

      <div className="sticky top-0 z-20 -mx-1 flex flex-wrap items-center justify-between gap-2 bg-[var(--assessment-surface)] px-1 py-1">
        <div role="tablist" aria-label="Report sections" className="flex gap-1 overflow-x-auto rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-1">
          {tabs.map((t) => {
            const active = t.id === tab;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => selectTab(t.id)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                  active
                    ? 'bg-[var(--assessment-primary)] text-white shadow-sm'
                    : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container)]'
                }`}
              >
                <AssessmentMaterialIcon name={t.icon} size={18} />
                {t.label}
                {t.badge ? (
                  <span
                    className={`rounded-full px-1.5 text-[11px] ${
                      active ? 'bg-white/20 text-white' : 'bg-[var(--assessment-surface-container-high)]'
                    }`}
                  >
                    {t.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      {tab === 'overview' ? (
        <div className="space-y-6">
          {matrix.length ? (
            <section className="assessment-card p-5">
              <div className="mb-4 flex items-center justify-between gap-2">
                <h2 className="text-base font-bold text-[var(--assessment-on-surface)]">Competency breakdown</h2>
                <button
                  type="button"
                  onClick={() => selectTab('scorecard')}
                  className="text-sm font-semibold text-[var(--assessment-primary)] hover:underline"
                >
                  Full scorecard →
                </button>
              </div>
              <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
                {matrix.map((row) => {
                  const tone = scoreTone(row.score10);
                  return (
                    <div key={row.key}>
                      <div className="mb-1 flex justify-between gap-2 text-sm">
                        <span className="truncate font-medium text-[var(--assessment-on-surface)]">{row.competency}</span>
                        <span className={`font-semibold tabular-nums ${tone.text}`}>
                          {row.score10 != null ? row.score10.toFixed(1) : '—'}
                          <span className="font-normal text-[var(--assessment-on-surface-variant)]"> / 10</span>
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-[var(--assessment-surface-container-high)]">
                        <div
                          className={`h-full rounded-full ${tone.bar}`}
                          style={{ width: `${Math.min(100, Math.max(0, ((row.score10 ?? 0) / 10) * 100))}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          {alignment ? <SkillAlignmentGrid alignment={alignment} /> : null}

          {screeningAudit ? (
            <AiScreeningSummaryPanel
              analyzerStatus={screeningAudit.analyzerStatus}
              checks={screeningChecks}
              conversationState={screeningAudit.conversationState}
            />
          ) : null}
          {hrAudit ? <BehaviouralHrReport audit={hrAudit} /> : null}
        </div>
      ) : null}

      {tab === 'transcript' ? (
        <InterviewTranscriptTimeline
          turns={turns}
          sessionId={report.session_id}
          candidateName={displayName}
          reportKind={reportKind}
        />
      ) : null}

      {tab === 'scorecard' ? <EvaluationMatrixTable report={report} rows={scorecard} /> : null}

      {tab === 'coding' && sandbox?.hasSubmission ? (
        <SandboxCodingReport techStack={report.tech_stack} enrichment={enrichment} />
      ) : null}

      {tab === 'recording' ? (
        <CandidateSessionRecordingPanel
          recordingUrl={recordingUrl}
          recordings={recordings}
          sessionId={report.session_id}
          bookmarks={recruiterBookmarks}
        />
      ) : null}

      {tab === 'integrity' && integrity ? (
        <InterviewIntegritySection
          identityVerifiedAt={integrity.identity_verified_at}
          livenessVerifiedAt={integrity.liveness_verified_at}
          proctorSummary={integrity.proctor_summary}
          proctorEvents={integrity.proctor_events}
        />
      ) : null}
    </div>
  );
}
