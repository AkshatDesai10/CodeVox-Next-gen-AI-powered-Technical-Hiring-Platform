'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import {
  getAssessmentQuestionsPreview,
  listCandidateAssignments,
  startAssessment,
} from '@/lib/assessments-api';
import { normalizeAssessmentQuestions } from '@/modules/assessments/utils/normalize-questions';
import type { CandidateAssignmentDto } from '@/types/assessments';

function normalizeAssignment(row: Record<string, unknown>): CandidateAssignmentDto {
  return {
    candidateAssessmentId:
      (row.candidateAssessmentId as string | null | undefined) ??
      (row.candidateassessmentid as string | null | undefined) ??
      null,
    status: String(row.status ?? 'NOT_ASSIGNED'),
    startedAt: (row.startedAt as string | null) ?? (row.started_at as string | null) ?? null,
    submittedAt:
      (row.submittedAt as string | null) ?? (row.submitted_at as string | null) ?? null,
    score: (row.score as string | null) ?? null,
    assessmentId: String(row.assessmentId ?? row.assessment_id ?? ''),
    title: String(row.title ?? ''),
    description: (row.description as string | null) ?? null,
    durationMinutes: Number(row.durationMinutes ?? row.duration_minutes ?? 0),
    totalMarks: Number(row.totalMarks ?? row.total_marks ?? 0),
  };
}

export function AssessmentStartPage({
  params,
}: {
  params: Promise<{ candidateId: string; assessmentId: string }>;
}) {
  const { candidateId, assessmentId } = use(params);
  const router = useRouter();

  const questionsQuery = useQuery({
    queryKey: ['assessment-questions-preview', assessmentId],
    queryFn: async () =>
      normalizeAssessmentQuestions(
        (await getAssessmentQuestionsPreview(assessmentId)).data,
      ),
  });

  const { data, isLoading, error } = useQuery({
    queryKey: ['candidate-assignment-start', candidateId, assessmentId],
    queryFn: async () => {
      const response = await listCandidateAssignments(candidateId);
      const rows = (response.data as Record<string, unknown>[]).map(normalizeAssignment);
      return (
        rows.find((item) => String(item.assessmentId) === String(assessmentId)) ?? null
      );
    },
  });

  const startMutation = useMutation({
    mutationFn: () => startAssessment(candidateId, assessmentId),
    onSuccess: (response) => {
      router.push(
        `/assessments/candidate/${candidateId}/attempt/${response.data.candidateAssessmentId}`,
      );
    },
  });

  const workspaceHref = data?.candidateAssessmentId
    ? `/assessments/candidate/${candidateId}/attempt/${data.candidateAssessmentId}`
    : null;

  const resultHref = data?.candidateAssessmentId
    ? `/assessments/candidate/${candidateId}/attempt/${data.candidateAssessmentId}/result`
    : null;

  if (isLoading || questionsQuery.isLoading) {
    return <div className="p-6">Loading assessment...</div>;
  }
  if (error || !data || questionsQuery.error) {
    return <div className="p-6 text-red-600">Assessment not found.</div>;
  }

  const questions = questionsQuery.data ?? [];
  const isSubmitted = data.status === 'SUBMITTED' || data.status === 'GRADED';
  const isInProgress = data.status === 'IN_PROGRESS';

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6 pb-28">
      <Link
        href={`/assessments/candidate/${candidateId}`}
        className="text-sm font-semibold text-[var(--assessment-primary)]"
      >
        ← Back to assignments
      </Link>

      <div className="assessment-card p-6">
        <h1 className="text-3xl font-bold">{data.title}</h1>
        <p className="mt-4 text-[var(--assessment-on-surface-variant)]">{data.description}</p>

        <div className="mt-6 space-y-2 text-sm">
          <p>
            <strong>Duration:</strong> {data.durationMinutes} minutes
          </p>
          <p>
            <strong>Total Marks:</strong> {data.totalMarks}
          </p>
          <p>
            <strong>Status:</strong> {data.status.replace('_', ' ')}
          </p>
        </div>

        {isSubmitted ? (
          <p className="mt-6 rounded-lg bg-amber-50 p-4 text-sm text-amber-900">
            This attempt is already submitted. You cannot start again.
          </p>
        ) : (
          <div className="mt-6 rounded-lg bg-[var(--assessment-surface-container)] p-4 text-sm">
            <h2 className="font-semibold">Instructions</h2>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--assessment-on-surface-variant)]">
              <li>Click the blue button below to open the coding workspace.</li>
              <li>Use Run to test your code before submitting.</li>
              <li>Use Next at the bottom to move between questions.</li>
            </ul>
          </div>
        )}

        {questions.length > 0 ? (
          <div className="mt-6">
            <h2 className="text-lg font-semibold">Questions ({questions.length})</h2>
            <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-[var(--assessment-on-surface-variant)]">
              {questions.map((question) => (
                <li key={question.id}>
                  <span className="font-medium text-[var(--assessment-on-surface)]">
                    {question.title}
                  </span>
                  <span className="ml-2 text-xs uppercase">
                    ({question.questionType}
                    {question.language ? ` | ${question.language}` : ''} | {question.marks} marks)
                  </span>
                  {question.description ? (
                    <p className="mt-1 max-w-2xl text-xs leading-5 opacity-90">
                      {question.description.slice(0, 220)}
                      {question.description.length > 220 ? '...' : ''}
                    </p>
                  ) : null}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <p className="mt-6 text-sm text-red-600">
            No questions are linked to this assessment yet.
          </p>
        )}

        <div className="mt-8 border-t border-[var(--assessment-outline-variant,#e5e7eb)]/40 pt-6">
          {isSubmitted && resultHref ? (
            <Link
              href={resultHref}
              className="inline-flex rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] px-6 py-3 text-sm font-semibold text-white"
            >
              View result →
            </Link>
          ) : isInProgress && workspaceHref ? (
            <Link
              href={workspaceHref}
              className="inline-flex rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] px-6 py-3 text-sm font-semibold text-white"
            >
              Continue to workspace →
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending || questions.length === 0}
              className="inline-flex rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {startMutation.isPending ? 'Opening workspace...' : 'Begin attempt →'}
            </button>
          )}
          {startMutation.error ? (
            <p className="mt-3 text-sm text-red-600">{String(startMutation.error)}</p>
          ) : null}
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-[var(--assessment-outline-variant,#e5e7eb)]/40 bg-[var(--assessment-surface-container)] px-4 py-4 shadow-[0_-8px_30px_rgba(15,23,42,0.08)]">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-[var(--assessment-on-surface-variant,#6b7280)]">
            {isSubmitted
              ? 'Attempt completed'
              : isInProgress
                ? 'Resume your coding attempt'
                : 'Ready to begin?'}
          </p>

          {isSubmitted && resultHref ? (
            <Link
              href={resultHref}
              className="rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] px-6 py-3 text-sm font-semibold text-white"
            >
              View result →
            </Link>
          ) : isInProgress && workspaceHref ? (
            <Link
              href={workspaceHref}
              className="rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] px-6 py-3 text-sm font-semibold text-white"
            >
              Continue to workspace →
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending || questions.length === 0}
              className="shrink-0 rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] px-6 py-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              {startMutation.isPending ? 'Opening workspace...' : 'Begin attempt →'}
            </button>
          )}
        </div>
        {startMutation.error ? (
          <p className="mx-auto mt-2 max-w-3xl text-sm text-red-600">
            {String(startMutation.error)}
          </p>
        ) : null}
      </div>
    </div>
  );
}
