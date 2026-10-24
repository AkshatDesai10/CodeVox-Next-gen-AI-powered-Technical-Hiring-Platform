'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { NexusStatusBadge } from '@/modules/job-profiles/components/NexusStatusBadge';import { PipelineMiniBar } from '@/modules/job-profiles/components/PipelineMiniBar';
import { getJobProfile } from '@/modules/job-profiles/lib/job-profiles-api';

export function JobProfileOverviewPage() {
  const params = useParams();
  const id = String(params?.id ?? '');

  const detailQuery = useQuery({
    queryKey: ['job-profile', id],
    queryFn: () => getJobProfile(id),
  });

  if (detailQuery.isLoading) {
    return <p className="p-6 text-sm">Loading profile...</p>;
  }
  if (detailQuery.isError || !detailQuery.data) {
    return <p className="p-6 text-sm text-red-600">Failed to load profile.</p>;
  }

  const { profile, stages } = detailQuery.data;
  const segments = stages.map((s) => ({ label: s.name, count: 0 }));

  return (
    <div className="w-full space-y-6">        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link href="/assessments/job-profiles" className="text-sm text-[var(--assessment-on-surface-variant)]">
              ← Job Profiles
            </Link>
            <div className="mt-2 flex items-center gap-3">
              <h1 className="font-display-lg">{profile.title}</h1>
              <NexusStatusBadge status={profile.status} />
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              href={`/assessments/job-profiles/${id}/configure`}
              className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              Configure
            </Link>
            <Link
              href={`/assessments/recruitment/leads?course=${encodeURIComponent(profile?.title ?? '')}`}
              className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
            >
              Candidates
            </Link>
            <Link
              href={`/assessments/job-profiles/${id}/analytics`}
              className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
            >
              Analytics
            </Link>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="nexus-card p-5">
            <h2 className="font-headline-md mb-3">Pipeline</h2>
            <PipelineMiniBar segments={segments} total={1} />
            <ul className="mt-4 space-y-2 text-sm">
              {stages.map((s) => (
                <li key={s.id} className="flex justify-between">
                  <span>{s.name}</span>
                  <span className="font-mono-data text-xs uppercase">{s.mode}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="nexus-card p-5">
            <h2 className="font-headline-md mb-3">Details</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-[var(--assessment-on-surface-variant)]">Department</dt>
                <dd>{profile.department ?? '-'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--assessment-on-surface-variant)]">Openings</dt>
                <dd>{profile.openings_count}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--assessment-on-surface-variant)]">Apply link</dt>
                <dd>
                  <Link href={`/apply/${profile.slug}`} className="text-[var(--assessment-primary)]">
                    /apply/{profile.slug}
                  </Link>
                </dd>
              </div>
            </dl>
          </div>
        </div>
    </div>
  );
}