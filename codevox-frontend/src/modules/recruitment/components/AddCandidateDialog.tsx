'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { listJobProfiles } from '@/modules/job-profiles/lib/job-profiles-api';
import { createManualCandidate } from '@/modules/recruitment/lib/recruitment-api';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

export function AddCandidateDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [jobProfileId, setJobProfileId] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const profilesQuery = useQuery({
    queryKey: ['job-profiles', 'active-for-manual-candidate'],
    queryFn: () => listJobProfiles({ status: 'active', pageSize: 200 }),
    enabled: open,
  });

  const profiles = profilesQuery.data?.items ?? [];

  if (!open) return null;

  const submit = async () => {
    setError('');
    if (!name.trim() || !email.trim().includes('@')) {
      setError('Enter the candidate name and a valid email.');
      return;
    }
    if (!jobProfileId) {
      setError('Select a job role.');
      return;
    }
    setSubmitting(true);
    try {
      await createManualCandidate({
        name: name.trim(),
        email: email.trim(),
        jobProfileId,
        resume,
      });
      setName('');
      setEmail('');
      setJobProfileId('');
      setResume(null);
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-candidate-title"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="add-candidate-title" className="text-lg font-semibold text-[var(--assessment-on-surface)]">
              Add candidate
            </h2>
            <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
              Create the candidate here. They get a magic link by email and open their dashboard directly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-low)]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
            Name
            <input
              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)] outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Candidate name"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
            Email
            <input
              type="email"
              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)] outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@email.com"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
            Job role
            <select
              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)] outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
              value={jobProfileId}
              onChange={(e) => setJobProfileId(e.target.value)}
            >
              <option value="">Select a role</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
            Resume (optional)
            <input
              type="file"
              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="w-full text-sm font-normal text-[var(--assessment-on-surface)]"
              onChange={(e) => setResume(e.target.files?.[0] ?? null)}
            />
          </label>
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Sending...' : 'Create and send link'}
          </button>
        </div>
      </div>
    </div>
  );
}
