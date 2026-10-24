'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createDemoApplication } from '@/lib/candidate-api';
import { recruitmentApiBase } from '@/lib/recruitment-api-base';

export default function CandidatePortalDemoPage() {
  const [jobProfileId, setJobProfileId] = useState('');
  const [candidateName, setCandidateName] = useState('');
  const [candidateEmail, setCandidateEmail] = useState('');
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const { data: profilesResponse, isLoading: isLoadingProfiles } = useQuery({
    queryKey: ['demo-job-profiles-public'],
    queryFn: async () => {
      const res = await fetch(`${recruitmentApiBase()}/api/job-profiles/public/list`);
      if (!res.ok) throw new Error('Failed to load job profiles');
      const json = await res.json();
      return json.data as { items: { id: string; title: string }[] };
    },
  });

  const profiles = profilesResponse?.items || [];

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await createDemoApplication(jobProfileId, candidateName, candidateEmail, resumeFile);
      if (res.data?.data?.token || res.data?.token) {
        const token = res.data?.data?.token || res.data?.token;
        router.push(`/candidate/portal/${token}`);
      }
    } catch (err: any) {
      setError(err?.response?.data?.message || err.message || 'Failed to create demo application');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md p-8 mt-12 border rounded-xl shadow-sm bg-[var(--assessment-surface-container)]">
      <h1 className="text-2xl font-bold mb-6 text-gray-900">Demo Candidate Testing</h1>

      <form onSubmit={handleGenerate} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Candidate Name
          </label>
          <input
            type="text"
            value={candidateName}
            onChange={(e) => setCandidateName(e.target.value)}
            placeholder="e.g. John Doe"
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Candidate Email
          </label>
          <input
            type="email"
            value={candidateEmail}
            onChange={(e) => setCandidateEmail(e.target.value)}
            placeholder="e.g. john@example.com"
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Resume (Optional)
          </label>
          <input
            type="file"
            accept=".pdf,.doc,.docx"
            onChange={(e) => setResumeFile(e.target.files?.[0] || null)}
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
          />
          <p className="text-xs text-gray-500 mt-1">
            Upload a mock resume to test AI round dynamic questions.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Job Profile
          </label>
          <select
            value={jobProfileId}
            onChange={(e) => setJobProfileId(e.target.value)}
            className="w-full px-4 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
            required
            disabled={isLoadingProfiles}
          >
            <option value="" disabled>
              {isLoadingProfiles ? 'Loading job profiles...' : 'Select a Job Profile'}
            </option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.title}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            Select the Job Profile you want to test the portal for.
          </p>
        </div>

        {error && <div className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{error}</div>}

        <button
          type="submit"
          disabled={loading || !jobProfileId || !candidateName || !candidateEmail}
          className="w-full bg-[var(--color-primary)] text-[var(--color-on-primary)] font-semibold py-2.5 rounded-sm hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Demo Application'}
        </button>
      </form>
    </div>
  );
}
