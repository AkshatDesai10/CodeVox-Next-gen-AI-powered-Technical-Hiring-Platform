'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { CodeVoxRecruiterRoot } from '@/modules/job-profiles/components/CodeVoxRecruiterRoot';
import { applyToJobProfile, getPublicJobProfile } from '@/modules/job-profiles/lib/job-profiles-api';

export function PublicApplyPage() {
  const params = useParams();
  const router = useRouter();
  const slug = String(params?.slug ?? '');

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [experience, setExperience] = useState('');
  const [error, setError] = useState<string | null>(null);

  const profileQuery = useQuery({
    queryKey: ['public-job-profile', slug],
    queryFn: () => getPublicJobProfile(slug),
  });

  const applyMutation = useMutation({
    mutationFn: () =>
      applyToJobProfile(slug, {
        first_name: firstName,
        last_name: lastName || undefined,
        email,
        phone: phone || undefined,
        experience_years: experience ? Number(experience) : undefined,
        skills: profileQuery.data?.required_skills,
      }),
    onSuccess: (data) => router.push(data.interview_url),
    onError: (e: Error) => setError(e.message),
  });

  if (profileQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--assessment-surface,#f5f7fa)] p-6">
        <p className="text-sm">Loading role...</p>
      </div>
    );
  }

  if (profileQuery.isError || !profileQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--assessment-surface,#f5f7fa)] p-6">
        <p className="text-sm text-red-600">This role is not available.</p>
      </div>
    );
  }

  const profile = profileQuery.data;

  return (
    <CodeVoxRecruiterRoot>
      <div className="min-h-screen bg-[var(--assessment-surface,#f5f7fa)] px-4 py-10">
        <div className="mx-auto max-w-2xl space-y-6">
          <header className="text-center">
            <p className="font-label-caps text-[var(--assessment-primary)]">Apply now</p>
            <h1 className="font-display-lg mt-2">{profile.title}</h1>
            {profile.department ? (
              <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
                {profile.department}
                {profile.location_text ? ` | ${profile.location_text}` : ''}
              </p>
            ) : null}
          </header>

          {profile.candidate_facing_intro ? (
            <p className="text-center text-sm text-[var(--assessment-on-surface-variant)]">
              {profile.candidate_facing_intro}
            </p>
          ) : null}

          <div className="codevox-card p-6">
            <h2 className="font-headline-md mb-4">Your details</h2>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                applyMutation.mutate();
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-semibold">First name *</label>
                  <input
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-semibold">Last name</label>
                  <input
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold">Email *</label>
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold">Phone</label>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-semibold">Years of experience</label>
                <input
                  type="number"
                  min={0}
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                />
              </div>
              {error ? <p className="text-sm text-red-600">{error}</p> : null}
              <button
                type="submit"
                disabled={applyMutation.isPending}
                className="w-full rounded-lg bg-[var(--assessment-primary)] py-3 text-sm font-semibold text-white disabled:opacity-50"
              >
                {applyMutation.isPending ? 'Submitting...' : 'Apply & start interview'}
              </button>
            </form>
          </div>

          {profile.required_skills.length ? (
            <div className="codevox-card p-5">
              <h3 className="font-label-caps mb-2">Required skills</h3>
              <div className="flex flex-wrap gap-2">
                {profile.required_skills.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-[var(--assessment-surface-container)] px-3 py-1 text-xs font-semibold"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </CodeVoxRecruiterRoot>
  );
}
