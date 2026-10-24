'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { listAssessmentCandidates, listAssessmentsAdmin } from '@/lib/assessments-api';
import { AssessmentStatusSelect } from '@/modules/assessments/components/AssessmentStatusSelect';
import { StatusBadge } from '@/modules/assessments/components/StatusBadge';

export function AssessmentListPage() {
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const queryClient = useQueryClient();

  const assessmentsQuery = useQuery({
    queryKey: ['assessment-list'],
    queryFn: async () => (await listAssessmentsAdmin()).data,
  });

  const candidatesQuery = useQuery({
    queryKey: ['assessment-candidates'],
    queryFn: async () => (await listAssessmentCandidates()).data,
  });

  const candidates = candidatesQuery.data ?? [];
  const activeCandidateId = selectedCandidateId || candidates[0]?.id || '';

  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.id === activeCandidateId),
    [activeCandidateId, candidates],
  );

  if (assessmentsQuery.isLoading || candidatesQuery.isLoading) {
    return <div>Loading assessments...</div>;
  }
  if (assessmentsQuery.error || candidatesQuery.error) {
    return <div className="text-red-600">Failed to load assessments.</div>;
  }

  const assessments = assessmentsQuery.data ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Assessments</h1>
        <p className="mt-2 text-[var(--assessment-on-surface-variant)]">
          Select a candidate, then start any published assessment.
        </p>
      </div>

      <div className="assessment-card flex flex-wrap items-end gap-4 p-5">
        <div className="min-w-[240px] flex-1">
          <label className="mb-1 block text-sm font-semibold">Candidate</label>
          <select
            value={activeCandidateId}
            onChange={(e) => setSelectedCandidateId(e.target.value)}
            className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
          >
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.firstName} {candidate.lastName ?? ''} ({candidate.email})
              </option>
            ))}
          </select>
        </div>
        {selectedCandidate ? (
          <Link
            href={`/assessments/candidate/${selectedCandidate.id}`}
            className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
          >
            Open candidate portal
          </Link>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {assessments.map((assessment) => (
          <div key={assessment.id} className="assessment-card p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">{assessment.title}</h2>
                <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
                  {assessment.description}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <StatusBadge status={assessment.status} />
                <AssessmentStatusSelect
                  assessmentId={assessment.id}
                  value={assessment.status}
                  onUpdated={() => void queryClient.invalidateQueries({ queryKey: ['assessment-list'] })}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex gap-4 text-sm text-[var(--assessment-on-surface-variant)]">
                <span>{assessment.durationMinutes} min</span>
                <span>{assessment.totalMarks} marks</span>
              </div>
              {activeCandidateId ? (
                assessment.status === 'PUBLISHED' ? (
                  <Link
                    href={`/assessments/candidate/${activeCandidateId}/${assessment.id}/start`}
                    className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white"
                  >
                    Start assessment
                  </Link>
                ) : (
                  <span className="text-sm text-[var(--assessment-on-surface-variant)]">
                    Publish to allow candidates to start
                  </span>
                )
              ) : (
                <span className="text-sm text-red-600">Add a candidate first</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
