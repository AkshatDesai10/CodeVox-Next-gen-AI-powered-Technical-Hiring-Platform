'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { listAssessmentCandidates } from '@/lib/assessments-api';
import { StatusBadge } from '@/modules/assessments/components/StatusBadge';

export function AssessmentCandidatesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['assessment-candidates'],
    queryFn: async () => (await listAssessmentCandidates()).data,
  });

  if (isLoading) return <div>Loading candidates...</div>;
  if (error) return <div className="text-red-600">Failed to load candidates.</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Candidates</h1>
        <p className="mt-2 text-[var(--assessment-on-surface-variant)]">
          Open a candidate portal to start assigned assessments.
        </p>
      </div>

      <div className="assessment-card overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--assessment-surface-container)] text-left">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Experience</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((candidate) => (
              <tr key={candidate.id} className="border-t border-[var(--assessment-outline-variant)]/30">
                <td className="px-4 py-3 font-medium">
                  {candidate.firstName} {candidate.lastName ?? ''}
                </td>
                <td className="px-4 py-3">{candidate.email}</td>
                <td className="px-4 py-3">{candidate.experienceYears ?? '-'} yrs</td>
                <td className="px-4 py-3">
                  <StatusBadge status={candidate.status} />
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/assessments/candidate/${candidate.id}`}
                    className="font-semibold text-[var(--assessment-primary)]"
                  >
                    Open Portal
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
