'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use, useState } from 'react';
import { listCandidateAssignments, startAssessment } from '@/lib/assessments-api';
import { StatusBadge } from '@/modules/assessments/components/StatusBadge';
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

function actionFor(item: CandidateAssignmentDto, candidateId: string) {
  if (
    (item.status === 'SUBMITTED' || item.status === 'GRADED') &&
    item.candidateAssessmentId
  ) {
    return {
      href: `/assessments/candidate/${candidateId}/attempt/${item.candidateAssessmentId}/result`,
      label: 'View Result',
      mode: 'link' as const,
    };
  }
  if (item.status === 'IN_PROGRESS' && item.candidateAssessmentId) {
    return {
      href: `/assessments/candidate/${candidateId}/attempt/${item.candidateAssessmentId}`,
      label: 'Continue Workspace',
      mode: 'link' as const,
    };
  }
  return {
    href: `/assessments/candidate/${candidateId}/${item.assessmentId}/start`,
    label: 'Begin Attempt',
    mode: 'start' as const,
  };
}

export function CandidateAssignmentsPage({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  const { candidateId } = use(params);
  const router = useRouter();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['candidate-assignments', candidateId],
    queryFn: async () => {
      const response = await listCandidateAssignments(candidateId);
      return (response.data as Record<string, unknown>[]).map(normalizeAssignment);
    },
  });

  const items = data ?? [];

  async function handlePrimaryAction(item: CandidateAssignmentDto) {
    const action = actionFor(item, candidateId);
    setStartError(null);
    setStarting(true);
    try {
      if (action.mode === 'start') {
        const response = await startAssessment(candidateId, item.assessmentId);
        router.push(
          `/assessments/candidate/${candidateId}/attempt/${response.data.candidateAssessmentId}`,
        );
        return;
      }
      router.push(action.href);
    } catch (err) {
      setStartError(String(err));
    } finally {
      setStarting(false);
    }
  }

  if (isLoading) return <div className="p-6">Loading assessments...</div>;
  if (error) return <div className="p-6 text-red-600">Failed to load assessments.</div>;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-bold text-[var(--assessment-primary)]">My Assessments</h1>
        <p className="mt-2 text-[var(--assessment-on-surface-variant)]">
          Click <strong>Begin Attempt</strong> on any assessment to open the coding workspace.
        </p>
      </div>

      {items.length === 0 ? (
        <div className="assessment-card p-6 text-[var(--assessment-on-surface-variant)]">
          No published assessments are available right now.
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => {
            const action = actionFor(item, candidateId);
            const isSubmitted = item.status === 'SUBMITTED' || item.status === 'GRADED';

            return (
              <div key={item.assessmentId} className="assessment-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-semibold">{item.title}</h2>
                    <p className="mt-2 max-w-2xl text-sm text-[var(--assessment-on-surface-variant)]">
                      {item.description}
                    </p>
                    <div className="mt-3 flex gap-4 text-sm text-[var(--assessment-on-surface-variant)]">
                      <span>{item.durationMinutes} min</span>
                      <span>{item.totalMarks} marks</span>
                    </div>
                  </div>
                  <StatusBadge status={item.status} />
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  {isSubmitted ? (
                    <Link
                      href={action.href}
                      className="inline-flex rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] px-5 py-2.5 text-sm font-semibold text-white"
                    >
                      View Result →
                    </Link>
                  ) : item.status === 'IN_PROGRESS' && item.candidateAssessmentId ? (
                    <Link
                      href={action.href}
                      className="inline-flex rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] px-5 py-2.5 text-sm font-semibold text-white"
                    >
                      Continue Workspace →
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled={starting}
                      onClick={() => void handlePrimaryAction(item)}
                      className="inline-flex rounded-lg bg-[var(--color-primary)] hover:bg-[var(--color-primary-dark)] px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {starting ? 'Opening...' : 'Begin Attempt →'}
                    </button>
                  )}
                  <Link
                    href={`/assessments/candidate/${candidateId}/${item.assessmentId}/start`}
                    className="inline-flex rounded-lg border border-[var(--assessment-outline-variant)] px-5 py-2.5 text-sm font-semibold"
                  >
                    View details
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {startError ? <p className="text-sm text-red-600">{startError}</p> : null}
    </div>
  );
}
