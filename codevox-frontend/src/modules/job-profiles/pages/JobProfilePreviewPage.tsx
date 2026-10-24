'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { withBasePath } from '@/lib/with-base-path';
import { AiAdaptiveBlock } from '@/modules/job-profiles/components/AiAdaptiveBlock';
import { AnchorQuestionBlock } from '@/modules/job-profiles/components/AnchorQuestionBlock';
import {
  createJobProfilePreviewSession,
  getJobProfile,
} from '@/modules/job-profiles/lib/job-profiles-api';

export function JobProfilePreviewPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const [previewToken, setPreviewToken] = useState<string | null>(null);

  const detailQuery = useQuery({
    queryKey: ['job-profile', id],
    queryFn: () => getJobProfile(id),
  });

  const previewMutation = useMutation({
    mutationFn: () => createJobProfilePreviewSession(id),
    onSuccess: (data) => setPreviewToken(data.candidate_token),
  });

  if (detailQuery.isLoading) {
    return <p className="p-6 text-sm">Loading preview...</p>;
  }
  if (detailQuery.isError || !detailQuery.data) {
    return <p className="p-6 text-sm text-red-600">Failed to load profile.</p>;
  }

  const { profile, questions } = detailQuery.data;
  const anchorQuestions = questions.filter((q) => q.kind === 'anchor');

  return (
    <div className="w-full space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-1 flex items-center gap-2 text-sm text-[var(--assessment-on-surface-variant)]">
              <Link href="/assessments/job-profiles">Job Profiles</Link>
              <span>/</span>
              <Link href={`/assessments/job-profiles/${id}/configure`}>{profile.title}</Link>
              <span>/</span>
              <span>Preview</span>
            </div>
            <h1 className="font-display-lg">AI interview preview - test mode</h1>
            <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
              Recruiter simulation with <code className="font-mono-data">is_preview=1</code> - no
              application row is created.
            </p>
          </div>
          <button
            type="button"
            disabled={previewMutation.isPending}
            onClick={() => previewMutation.mutate()}
            className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            {previewMutation.isPending ? 'Starting...' : 'Start live simulation'}
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="nexus-card p-5">
            <h2 className="font-headline-md mb-4">Logic canvas</h2>
            <div className="space-y-4">
              {anchorQuestions.length ? (
                anchorQuestions.map((q, i) => (
                  <AnchorQuestionBlock key={q.id} index={i + 1} prompt={q.prompt} />
                ))
              ) : (
                <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                  No anchor questions configured yet.
                </p>
              )}
              <AiAdaptiveBlock branchLabel="Adaptive follow-ups from voice engine" />
            </div>
          </section>

          <section className="nexus-card flex min-h-[420px] flex-col p-5">
            <h2 className="font-headline-md mb-4">Live simulation</h2>
            {previewToken ? (
              <div className="flex flex-1 flex-col gap-4">
                <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                  Preview session ready. Open the autonomous interview in a new tab to run the full
                  voice + sandbox flow.
                </p>
                <Link
                  href={`/autonomous-interview/${previewToken}`}
                  target="_blank"
                  className="inline-flex items-center justify-center rounded-lg bg-[var(--assessment-primary-container)] px-4 py-3 text-sm font-semibold text-white"
                >
                  Open interview preview →
                </Link>
                <iframe
                  title="Interview preview"
                  src={withBasePath(`/autonomous-interview/${previewToken}`)}
                  className="min-h-[320px] flex-1 rounded-lg border border-[var(--assessment-outline-variant)]"
                />
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center text-sm text-[var(--assessment-on-surface-variant)]">
                <p>Click &quot;Start live simulation&quot; to create a sandbox interview session.</p>
                <p className="mt-2 font-mono-data text-xs">
                  Uses existing LiveKitVoiceStagePanel via autonomous interview route.
                </p>
              </div>
            )}
          </section>
        </div>
    </div>
  );
}
