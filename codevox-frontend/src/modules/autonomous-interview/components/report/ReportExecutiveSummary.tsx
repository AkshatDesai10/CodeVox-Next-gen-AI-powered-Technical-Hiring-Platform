'use client';

import { FileText } from 'lucide-react';
import type { InterviewReportEnrichment, InterviewSessionReport } from '@/modules/autonomous-interview/types/interview-report';
import {
  buildExecutiveSummary,
  deriveRecommendation,
} from '@/modules/autonomous-interview/utils/interview-report';

type Props = {
  report: InterviewSessionReport;
  enrichment?: InterviewReportEnrichment | null;
  candidateName?: string | null;
};

export function ReportExecutiveSummary({ report, enrichment = null, candidateName }: Props) {
  const recommendation = deriveRecommendation(report, enrichment);
  const summary = buildExecutiveSummary(
    report,
    recommendation,
    enrichment,
    candidateName || report.candidate_name,
  );

  return (
    <section className="rounded-md border border-[var(--color-primary)]/10 bg-[var(--color-primary-container)] p-5">
      <div className="flex gap-3">
        <FileText className="mt-0.5 h-5 w-5 shrink-0 text-[var(--assessment-primary)]" />
        <p className="text-sm leading-relaxed text-[var(--color-on-primary-container)]">{summary}</p>
      </div>
    </section>
  );
}
