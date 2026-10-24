'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { getInterviewReport } from '@/modules/autonomous-interview/lib/interview-report-api';
import { CandidateInterviewReport } from '@/modules/autonomous-interview/components/report/CandidateInterviewReport';
import type {
  InterviewReportResponse,
  InterviewSessionReport,
} from '@/modules/autonomous-interview/types/interview-report';
import fixtureReport from '@/modules/autonomous-interview/fixtures/rohit-sharma-php-report.json';

type Props = {
  token: string;
};

function devFixtureResponse(token: string): InterviewReportResponse | null {
  if (process.env.NODE_ENV !== 'development') return null;
  const report = fixtureReport as InterviewSessionReport;
  if (report.session_id !== token) return null;
  return {
    report,
    filename: 'rohit-sharma-php-report.json',
    enrichment: {
      recordingUrl: null,
      stage1VoiceScore: 5,
      submittedCode: `<?php\nfunction findDuplicateEmails(array $rows): array {\n    $seen = [];\n    $dupes = [];\n    foreach ($rows as $row) {\n        $email = strtolower(trim($row['email'] ?? ''));\n        if ($email === '') continue;\n        if (isset($seen[$email])) $dupes[] = $email;\n        $seen[$email] = true;\n    }\n    return array_values(array_unique($dupes));\n}`,
      codeQualityScore: 68,
      architecturalFlaws: ['missing_input_validation', 'no_prepared_statements'],
      currentPhase: 'completed',
      candidateAssessmentId: 'demo-assessment',
      finalDecision: 'UNDER_REVIEW',
      sandbox: {
        assessmentTitle: 'PHP Assessment',
        attemptScore: 72,
        submittedAt: report.finalized_at,
        language: 'PHP',
        sourceCode: `<?php\nfunction findDuplicateEmails(array $rows): array {\n    $seen = [];\n    $dupes = [];\n    foreach ($rows as $row) {\n        $email = strtolower(trim($row['email'] ?? ''));\n        if ($email === '') continue;\n        if (isset($seen[$email])) $dupes[] = $email;\n        $seen[$email] = true;\n    }\n    return array_values(array_unique($dupes));\n}`,
        codeQualityScore: 68,
        architecturalFlaws: ['missing_input_validation', 'no_prepared_statements'],
        passedTestCases: 8,
        totalTestCases: 10,
        submissions: [
          {
            questionId: '101',
            language: 'PHP',
            sourceCode: '<?php /* demo */',
            score: 72,
            executionTimeMs: 420,
            status: 'EVALUATED',
            passedTestCases: 8,
            totalTestCases: 10,
          },
        ],
        hasSubmission: true,
      },
    },
    versions: [
      {
        token: report.session_id,
        filename: 'rohit-sharma-php-report.json',
        finalizedAt: report.finalized_at,
        depthScore: report.depth_score,
        turnCount: report.turns.length,
        techStack: report.tech_stack,
        candidateName: 'Rohit Sharma',
      },
    ],
  };
}

export function InterviewReportDetailPage({ token }: Props) {
  const router = useRouter();
  const [selectedFilename, setSelectedFilename] = useState<string | undefined>();
  const [copied, setCopied] = useState(false);

  const { data, isLoading, error, isError } = useQuery({
    queryKey: ['interview-report', token, selectedFilename],
    queryFn: async () => (await getInterviewReport(token, selectedFilename)).data,
    retry: false,
  });

  const fallback = useMemo(() => (isError ? devFixtureResponse(token) : null), [isError, token]);

  const payload = data ?? fallback;

  if (isLoading && !fallback) {
    return (
      <div className="animate-pulse space-y-6" aria-busy="true" aria-label="Loading report">
        <div className="h-5 w-56 rounded bg-[var(--assessment-surface-container-high)]" />
        <div className="assessment-card h-44" />
        <div className="assessment-card h-24" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="assessment-card h-20" />
          ))}
        </div>
        <div className="assessment-card h-96" />
      </div>
    );
  }

  if (!payload) {
    return (
      <div className="space-y-4">
        <Link
          href="/assessments/interview-reports"
          className="text-sm font-semibold text-[var(--assessment-primary)]"
        >
          ← Back to reports
        </Link>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
          <p className="font-semibold">Interview report not available</p>
          <p className="mt-1 text-amber-900/90">
            No completed interview audit was found for this session. The candidate may still be in
            progress, or the interview ended before results were saved.
          </p>
          {error instanceof Error && error.message ? (
            <p className="mt-2 text-xs text-amber-800/80">{error.message}</p>
          ) : null}
        </div>
      </div>
    );
  }

  const versions = payload.versions ?? [];
  const activeVersion = versions.find(v => v.filename === (selectedFilename ?? payload.filename));
  const candidateName = activeVersion?.candidateName ?? versions[0]?.candidateName ?? null;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <button
            type="button"
            onClick={() => (window.history.length > 2 ? window.history.back() : router.push('/assessments/interview-reports'))}
            className="inline-flex items-center gap-1 font-semibold text-[var(--assessment-primary)] hover:underline"
          >
            <AssessmentMaterialIcon name="arrow_back" size={18} />
            Back
          </button>
          <AssessmentMaterialIcon name="chevron_right" size={18} className="text-[var(--assessment-on-surface-variant)]" />
          <Link href="/assessments/interview-reports" className="text-[var(--assessment-on-surface-variant)] hover:underline">
            Interview Reports
          </Link>
          {candidateName ? (
            <>
              <AssessmentMaterialIcon name="chevron_right" size={18} className="text-[var(--assessment-on-surface-variant)]" />
              <span className="truncate text-[var(--assessment-on-surface-variant)]">{candidateName}</span>
            </>
          ) : null}
        </nav>
        <div className="flex flex-wrap items-center gap-2">
          {versions.length > 1 ? (
            <label className="flex items-center gap-2 text-sm">
              <span className="text-[var(--assessment-on-surface-variant)]">Version</span>
              <select
                value={selectedFilename ?? payload.filename}
                onChange={(e) => setSelectedFilename(e.target.value)}
                className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-2 text-sm"
              >
                {versions.map((v) => (
                  <option key={v.filename} value={v.filename}>
                    {v.finalizedAt ? new Date(v.finalizedAt).toLocaleString() : v.filename}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-2 text-sm font-semibold text-[var(--assessment-on-surface)] transition hover:border-[var(--assessment-primary)] hover:text-[var(--assessment-primary)]"
          >
            <AssessmentMaterialIcon name={copied ? 'check' : 'link'} size={16} />
            {copied ? 'Link copied' : 'Copy link'}
          </button>
        </div>
      </div>

      {fallback && isError ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          API unavailable - showing local development fixture.
        </p>
      ) : null}

      <CandidateInterviewReport report={payload.report} enrichment={payload.enrichment} candidateName={candidateName} />
    </div>
  );
}
