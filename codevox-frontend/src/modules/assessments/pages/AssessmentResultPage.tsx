'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import { StatusBadge } from '@/modules/assessments/components/StatusBadge';
import { getAssessmentResult } from '@/lib/assessments-api';
import { formatTimestampDateTimeDisplay } from '@/lib/date-format';

export function AssessmentResultPage({
  params,
}: {
  params: Promise<{ candidateId: string; candidateAssessmentId: string }>;
}) {
  const { candidateId, candidateAssessmentId } = use(params);
  const { data, isLoading, error } = useQuery({
    queryKey: ['assessment-result', candidateAssessmentId],
    queryFn: async () => (await getAssessmentResult(candidateAssessmentId)).data,
  });

  if (isLoading) return <div className="p-6">Loading result...</div>;
  if (error || !data) return <div className="p-6 text-red-600">Failed to load result.</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <Link href={`/assessments/candidate/${candidateId}`} className="text-sm font-semibold text-[var(--assessment-primary)]">
        ← Back to assignments
      </Link>

      <div className="assessment-card p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold">Assessment Result</h1>
            <p className="mt-2 text-[var(--assessment-on-surface-variant)]">
              Submitted at {data.submittedAt ? formatTimestampDateTimeDisplay(data.submittedAt) : '-'}
            </p>
          </div>
          <StatusBadge status={data.status} />
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-lg bg-[var(--assessment-surface-container)] p-4">
            <p className="text-sm text-[var(--assessment-on-surface-variant)]">Total Score</p>
            <p className="mt-2 text-3xl font-bold">
              {data.totalScore} / {data.totalMarks}
            </p>
          </div>
          <div className="rounded-lg bg-[var(--assessment-surface-container)] p-4">
            <p className="text-sm text-[var(--assessment-on-surface-variant)]">Pass Status</p>
            <p className="mt-2 text-2xl font-bold">{data.passed ? 'Passed' : 'Needs Review'}</p>
          </div>
          <div className="rounded-lg bg-[var(--assessment-surface-container)] p-4">
            <p className="text-sm text-[var(--assessment-on-surface-variant)]">Questions</p>
            <p className="mt-2 text-3xl font-bold">{data.breakdown.length}</p>
          </div>
        </div>
      </div>

      <div className="assessment-card overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--assessment-surface-container)] text-left">
            <tr>
              <th className="px-4 py-3">Question</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Score</th>
              <th className="px-4 py-3">Tests</th>
              <th className="px-4 py-3">Execution Time</th>
            </tr>
          </thead>
          <tbody>
            {data.breakdown.map((row) => (
              <tr key={row.questionId} className="border-t border-[var(--assessment-outline-variant)]/30">
                <td className="px-4 py-3 font-medium">{row.title}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={row.status} />
                </td>
                <td className="px-4 py-3">
                  {row.score} / {row.marks}
                </td>
                <td className="px-4 py-3">
                  {row.passedTestCases != null && row.totalTestCases != null
                    ? `${row.passedTestCases} / ${row.totalTestCases}`
                    : '-'}
                </td>
                <td className="px-4 py-3">{row.executionTime} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
