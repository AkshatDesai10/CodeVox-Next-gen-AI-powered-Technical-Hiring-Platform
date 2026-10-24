'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { getAssessmentReport } from '../lib/assessment-report-api';
import type {
  AssessmentStageReport,
  CodingStageReport,
  VerbalStageReport,
  AiScreeningStageReport,
} from '../types/assessment-report';
import { formatPct } from '../utils/format';
import { CandidateProfileHeader, ReportKpiStrip } from '../components/detail/CandidateProfileHeader';
import { CodingQuestionsTable } from '../components/detail/CodingQuestionsTable';
import {
  StageNavigator,
  StageStatusBadge,
  stageHasScore,
  stageIcon,
  stageSubtitle,
} from '../components/detail/StageNavigator';
import { VerbalStagePanel, AiScreeningStagePanel } from '../components/detail/StagePanels';
import { OverallEvaluationPanel } from '../components/detail/OverallEvaluationPanel';
import { AiEvaluationSynthesisCard, RawAiPayloadPanel } from '../components/AiEvaluationCard';

const VERBAL_STAGE_TYPES = new Set(['screening', 'ai_verbal', 'hr_verbal', 'project_interview']);

function interviewReportPathOf(stage: AssessmentStageReport): string | null {
  return 'interviewReportPath' in stage && typeof stage.interviewReportPath === 'string'
    ? stage.interviewReportPath || null
    : null;
}

function StageHeader(props: { stage: AssessmentStageReport; index: number; total: number }) {
  const { stage } = props;
  const reportPath = interviewReportPathOf(stage);
  return (
    <div className="assessment-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--assessment-primary-container)] text-[var(--assessment-primary)]">
            <AssessmentMaterialIcon name={stageIcon(stage)} size={22} />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
              Round {props.index + 1} of {props.total}
            </div>
            <h2 className="truncate text-lg font-bold text-[var(--assessment-on-surface)]">{stage.label}</h2>
            <div className="text-xs text-[var(--assessment-on-surface-variant)]">{stageSubtitle(stage)}</div>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <StageStatusBadge stage={stage} />
          {stageHasScore(stage) ? (
            <div className="text-right">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                Score
              </div>
              <div className="text-2xl font-bold tabular-nums text-[var(--assessment-on-surface)]">
                {formatPct(stage.scorePct)}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {reportPath ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-5 py-3">
          <span className="flex items-center gap-2 text-sm text-[var(--assessment-on-surface-variant)]">
            <AssessmentMaterialIcon name="description" size={18} className="text-[var(--assessment-primary)]" />
            Full transcript, scorecard, recording and integrity details for this round
          </span>
          <Link
            href={reportPath}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--assessment-primary)] px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
          >
            Open full interview report
            <AssessmentMaterialIcon name="arrow_forward" size={16} />
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function StageBody(props: { stage: AssessmentStageReport; applicationId: string }) {
  const { stage, applicationId } = props;
  if (stage.stageType === 'coding') return <CodingQuestionsTable stage={stage as CodingStageReport} />;
  if (stage.stageType === 'ai_screening') {
    return <AiScreeningStagePanel stage={stage as AiScreeningStageReport} />;
  }
  if (VERBAL_STAGE_TYPES.has(stage.stageType)) {
    return <VerbalStagePanel stage={stage as VerbalStageReport} applicationId={applicationId} />;
  }
  return (
    <div className="space-y-4">
      {'aiEvaluation' in stage ? <AiEvaluationSynthesisCard evaluation={stage.aiEvaluation} /> : null}
      {'rawAiPayload' in stage ? <RawAiPayloadPanel payload={stage.rawAiPayload} /> : null}
    </div>
  );
}

function ReportSkeleton() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading report">
      <div className="h-5 w-64 rounded bg-[var(--assessment-surface-container-high)]" />
      <div className="assessment-card h-48" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="assessment-card h-20" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="assessment-card h-72" />
        <div className="assessment-card h-96" />
      </div>
    </div>
  );
}

export function AssessmentReportDetailPage(props: {
  applicationId: string;
  initialStageType?: string | null;
}) {
  const { applicationId, initialStageType } = props;

  const query = useQuery({
    queryKey: ['assessment-report', applicationId],
    queryFn: () => getAssessmentReport(applicationId),
    refetchInterval: (q) => {
      const stages = q.state.data?.stages ?? [];
      return stages.some((s) => s.status === 'evaluating') ? 5000 : false;
    },
  });

  const stages = query.data?.stages ?? [];
  const [activeStageId, setActiveStageId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!stages.length) return;
    if (activeStageId && stages.some((s) => s.stageId === activeStageId)) return;
    if (initialStageType) {
      const preferred = stages.find((s) => s.stageType === initialStageType);
      if (preferred) {
        setActiveStageId(preferred.stageId);
        return;
      }
    }
    setActiveStageId(stages[0].stageId);
  }, [stages, activeStageId, initialStageType]);

  const activeIndex = useMemo(
    () => (activeStageId ? stages.findIndex((s) => s.stageId === activeStageId) : -1),
    [stages, activeStageId],
  );
  const active = activeIndex >= 0 ? stages[activeIndex] : null;

  const evaluating = stages.some((s) => s.status === 'evaluating');

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (query.isLoading) return <ReportSkeleton />;

  if (query.error || !query.data) {
    return (
      <div className="assessment-card mx-auto mt-6 max-w-lg p-8 text-center">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
          <AssessmentMaterialIcon name="error" size={24} />
        </span>
        <h2 className="mt-3 text-base font-bold text-[var(--assessment-on-surface)]">
          Failed to load assessment report
        </h2>
        <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
          The report could not be fetched. Check your connection and try again.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Link
            href="/assessments/assessment-reports"
            className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
          >
            Back to reports
          </Link>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const report = query.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link
            href="/assessments/assessment-reports"
            className="inline-flex items-center gap-1 font-semibold text-[var(--assessment-primary)] hover:underline"
          >
            <AssessmentMaterialIcon name="arrow_back" size={18} />
            Assessment Reports
          </Link>
          <AssessmentMaterialIcon
            name="chevron_right"
            size={18}
            className="text-[var(--assessment-on-surface-variant)]"
          />
          <span className="truncate text-[var(--assessment-on-surface-variant)]">{report.candidate.name}</span>
        </nav>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={copyShare}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-2 text-sm font-semibold text-[var(--assessment-on-surface)] transition hover:border-[var(--assessment-primary)] hover:text-[var(--assessment-primary)]"
          >
            <AssessmentMaterialIcon name={copied ? 'check' : 'link'} size={16} />
            {copied ? 'Link copied' : 'Copy share link'}
          </button>
          <button
            type="button"
            disabled
            title="Coming soon"
            className="inline-flex cursor-not-allowed items-center gap-2 rounded-lg bg-[var(--assessment-primary)] px-3 py-2 text-sm font-semibold text-white opacity-60"
          >
            <AssessmentMaterialIcon name="download" size={16} />
            Download PDF
          </button>
        </div>
      </div>

      {evaluating ? (
        <div className="flex items-center gap-3 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-sky-300 border-t-sky-700" />
          AI evaluation is still processing. This report refreshes automatically.
        </div>
      ) : null}

      <CandidateProfileHeader report={report} />
      <ReportKpiStrip report={report} />

      <OverallEvaluationPanel
        applicationId={applicationId}
        evaluation={report.overallEvaluation}
        canGenerate={
          report.application.status === 'completed' ||
          report.application.status === 'hired' ||
          report.application.status === 'rejected'
        }
      />

      {stages.length ? (
        <div className="grid items-start gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="lg:sticky lg:top-4">
            <StageNavigator stages={stages} activeStageId={activeStageId} onSelect={setActiveStageId} />
          </aside>
          <section className="min-w-0 space-y-4">
            {active ? (
              <>
                <StageHeader stage={active} index={activeIndex} total={stages.length} />
                <StageBody stage={active} applicationId={applicationId} />
              </>
            ) : null}
          </section>
        </div>
      ) : (
        <div className="assessment-card flex flex-col items-center gap-2 p-10 text-center">
          <AssessmentMaterialIcon
            name="inventory_2"
            size={32}
            className="text-[var(--assessment-on-surface-variant)]"
          />
          <div className="text-sm font-semibold text-[var(--assessment-on-surface)]">No rounds configured</div>
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            This job profile has no assessment stages yet.
          </p>
        </div>
      )}
    </div>
  );
}
