'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { DashboardPipelineBar } from '@/modules/job-profiles/components/DashboardPipelineBar';
import { NexusStatusBadge } from '@/modules/job-profiles/components/NexusStatusBadge';
import {
  approveJobProfile,
  archiveJobProfile,
  closeJobProfile,
  exportJobProfilesCsv,
  getJobProfile,
  listJobProfiles,
  pauseJobProfile,
  publishJobProfile,
  type JobProfileStatus,
} from '@/modules/job-profiles/lib/job-profiles-api';
import { setupPathForDetail } from '@/modules/job-profiles/lib/job-profile-setup';

type TabFilter = 'all' | 'active' | 'archived';

function formatDate(iso?: string) {
  if (!iso) return '-';
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function JobProfilesDashboardPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState<TabFilter>('all');
  const [showAiTip, setShowAiTip] = useState(false);
  const queryClient = useQueryClient();

  const localQuery = useQuery({
    queryKey: ['job-profiles-local', search],
    queryFn: () => listJobProfiles({ pageSize: 200, search: search.trim() || undefined }),
  });

  const profiles = localQuery.data?.items ?? [];

  const filteredRows = useMemo(() => {
    return profiles.filter((profile) => {
      if (tab === 'active' && profile.status !== 'active') return false;
      if (tab === 'archived' && profile.status !== 'archived') return false;
      if (tab === 'all' && profile.status === 'archived') return false;
      return true;
    });
  }, [profiles, tab]);

  const stats = useMemo(() => {
    const active = profiles.filter((p) => p.status === 'active').length;
    const pending = profiles.filter((p) => p.status === 'pending_approval').length;
    const openings = profiles.reduce((s, p) => s + (p.openings_count ?? 0), 0);
    return {
      active,
      pending,
      openings,
      total: profiles.length,
    };
  }, [profiles]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['job-profiles'] });
    void queryClient.invalidateQueries({ queryKey: ['job-profiles-local'] });
  };

  const openProfile = useMutation({
    mutationFn: async (profileId: string) => {
      const detail = await getJobProfile(profileId);
      return setupPathForDetail(detail);
    },
    onSuccess: (path) => router.push(path),
    onError: (_err, profileId) => {
      router.push(`/assessments/job-profiles/${profileId}/basics`);
    },
  });

  const actionMutation = useMutation({
    mutationFn: async (payload: { action: string; id: string }) => {
      const { action, id } = payload;
      if (action === 'publish') return publishJobProfile(id);
      if (action === 'pause') return pauseJobProfile(id);
      if (action === 'close') return closeJobProfile(id);
      if (action === 'archive') return archiveJobProfile(id);
      if (action === 'approve') return approveJobProfile(id);
      throw new Error('Unknown action');
    },
    onSuccess: invalidate,
  });

  const handleExport = async () => {
    const csv = await exportJobProfilesCsv();
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'job-profiles.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const draftProfile = profiles.find((p) => p.status === 'draft');
  const isLoading = localQuery.isLoading;
  const loadError = localQuery.isError;

  return (
    <>
      <div className="w-full space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="nexus-card group relative overflow-hidden p-6">
            <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
              <AssessmentMaterialIcon name="work" size={72} className="text-[var(--assessment-primary)]" />
            </div>
            <p className="font-label-caps mb-2 text-[var(--nexus-outline)]">Job profiles</p>
            <div className="flex items-baseline gap-2">
              <h3 className="font-display-lg text-[var(--assessment-primary)]">{stats.total}</h3>
              <span className="text-sm text-[var(--nexus-outline)]">total</span>
            </div>
            <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
              {stats.active} active | {stats.pending} pending approval
            </p>
          </div>

          <div className="nexus-card group relative overflow-hidden p-6">
            <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
              <AssessmentMaterialIcon name="pending_actions" size={72} className="text-[var(--nexus-secondary)]" />
            </div>
            <p className="font-label-caps mb-2 text-[var(--nexus-outline)]">Pending approvals</p>
            <div className="flex items-baseline gap-2">
              <h3 className="font-display-lg text-[var(--nexus-secondary)]">
                {String(stats.pending).padStart(2, '0')}
              </h3>
              {stats.pending > 0 ? (
                <span className="flex items-center text-sm text-[var(--assessment-error,#dc2626)]">
                  <AssessmentMaterialIcon name="priority_high" size={14} className="mr-1" />
                  Action needed
                </span>
              ) : null}
            </div>
            <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">Among configured profiles</p>
          </div>

          <div className="nexus-card group relative overflow-hidden p-6">
            <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
              <AssessmentMaterialIcon name="groups" size={72} className="text-[var(--nexus-tertiary)]" />
            </div>
            <p className="font-label-caps mb-2 text-[var(--nexus-outline)]">Active openings</p>
            <div className="flex items-baseline gap-2">
              <h3 className="font-display-lg">{stats.active}</h3>
              <span className="text-sm text-[var(--nexus-outline)]">live roles</span>
            </div>
            <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
              {stats.openings} total seats across active profiles
            </p>
          </div>
        </div>

        <div className="nexus-card flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--assessment-outline-variant)] p-4">
            <div className="flex items-center gap-4">
              <h4 className="font-title-sm">Job profiles</h4>
              <span className="rounded-full bg-[var(--assessment-primary-container)]/10 px-3 py-1 font-label-caps text-[var(--assessment-primary-container)]">
                {filteredRows.length} shown
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex overflow-hidden rounded-lg border border-[var(--assessment-outline-variant)]">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'active', label: 'Active' },
                    { id: 'archived', label: 'Archived' },
                  ] as const
                ).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`px-4 py-2 font-title-sm text-sm ${
                      tab === t.id
                        ? 'bg-[var(--assessment-surface-container-high)] text-[var(--assessment-primary)]'
                        : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container)]'
                    } border-r border-[var(--assessment-outline-variant)] last:border-r-0`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter by title..."
                className="rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
              />
              <Link
                href="/assessments/job-profiles/new"
                className="flex items-center rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
              >
                <AssessmentMaterialIcon name="add" size={18} className="mr-2" />
                Create
              </Link>
              <button
                type="button"
                onClick={() => void localQuery.refetch()}
                className="flex items-center rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold hover:bg-[var(--assessment-surface-container)]"
              >
                <AssessmentMaterialIcon name="refresh" size={18} className="mr-2" />
                Refresh
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                className="flex items-center rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold hover:bg-[var(--assessment-surface-container)]"
              >
                <AssessmentMaterialIcon name="download" size={18} className="mr-2" />
                Export
              </button>
            </div>
          </div>

          {isLoading ? (
            <p className="p-8 text-sm text-[var(--assessment-on-surface-variant)]">Loading job profiles...</p>
          ) : loadError ? (
            <p className="p-8 text-sm text-red-600">Failed to load job profiles.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="nexus-table-dense w-full text-left">
                <thead>
                  <tr>
                    <th className="font-label-caps text-[var(--nexus-outline)]">Job profile title</th>
                    <th className="font-label-caps text-[var(--nexus-outline)]">Status</th>
                    <th className="font-label-caps text-[var(--nexus-outline)]">Pipeline progress</th>
                    <th className="font-label-caps text-[var(--nexus-outline)]">Openings</th>
                    <th className="font-label-caps text-[var(--nexus-outline)]">Last updated</th>
                    <th />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--assessment-outline-variant)]">
                  {filteredRows.map((profile) => {
                    const loc = [profile.department, profile.location_mode].filter(Boolean).join(' - ');
                    return (
                      <tr key={profile.id} className="group">
                        <td>
                          <button
                            type="button"
                            disabled={openProfile.isPending}
                            onClick={() => openProfile.mutate(profile.id)}
                            className="text-left font-title-sm text-[var(--assessment-on-surface)] transition-colors group-hover:text-[var(--assessment-primary)] disabled:opacity-60"
                          >
                            {profile.title}
                          </button>
                          <p className="text-sm text-[var(--nexus-outline)]">{loc || '-'}</p>
                        </td>
                        <td>
                          <NexusStatusBadge status={profile.status as JobProfileStatus} />
                        </td>
                        <td>
                          <DashboardPipelineBar
                            segments={profile.pipeline?.segments ?? []}
                            total={profile.pipeline?.total}
                            status={profile.status}
                          />
                        </td>
                        <td>
                          <span className="font-mono-data">
                            {String(profile.pipeline?.total ?? 0).padStart(2, '0')}/
                            {String(profile.openings_count).padStart(2, '0')}
                          </span>
                        </td>
                        <td>
                          <span className="text-sm text-[var(--nexus-outline)]">
                            {formatDate(profile.updated_at ?? profile.created_at)}
                          </span>
                        </td>
                        <td className="text-right">
                          <div className="flex justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <Link
                              href={`/assessments/job-profiles/${profile.id}/analytics`}
                              className="rounded-full p-2 hover:bg-[var(--assessment-surface-container)]"
                              title="Analytics"
                            >
                              <AssessmentMaterialIcon name="analytics" size={18} />
                            </Link>
                            {profile.status === 'pending_approval' ? (
                              <button
                                type="button"
                                onClick={() => actionMutation.mutate({ action: 'approve', id: profile.id })}
                                className="rounded-full p-2 text-[var(--nexus-secondary)] hover:bg-[var(--color-primary-container)]"
                                title="Approve"
                              >
                                <AssessmentMaterialIcon name="check" size={18} />
                              </button>
                            ) : null}
                            {profile.status === 'draft' ? (
                              <button
                                type="button"
                                onClick={() => actionMutation.mutate({ action: 'publish', id: profile.id })}
                                className="rounded-full p-2 text-emerald-700 hover:bg-emerald-50"
                                title="Publish"
                              >
                                <AssessmentMaterialIcon name="publish" size={18} />
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredRows.length === 0 ? (
                <p className="p-8 text-center text-sm text-[var(--assessment-on-surface-variant)]">
                  No job profiles match this filter.
                </p>
              ) : null}
            </div>
          )}

          <div className="flex items-center justify-between border-t border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/30 p-4">
            <span className="text-sm text-[var(--nexus-outline)]">
              {stats.total} job profiles
            </span>
          </div>
        </div>
      </div>

      <div className="nexus-fab flex flex-col items-end gap-4">
        {showAiTip && draftProfile ? (
          <div className="nexus-glass-ai max-w-xs rounded-xl p-6 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <AssessmentMaterialIcon name="auto_awesome" size={20} className="text-[var(--nexus-secondary)]" />
              <span className="font-title-sm text-[var(--nexus-secondary)]">AI recommendation</span>
            </div>
            <p className="text-sm">
              &ldquo;{draftProfile.title}&rdquo; may be missing competencies. Open configure to run AI suggestions.
            </p>
            <div className="mt-4 flex gap-2">
              <Link
                href={`/assessments/job-profiles/${draftProfile.id}/configure`}
                className="flex-1 rounded-lg bg-[var(--nexus-secondary)] py-2 text-center font-label-caps text-xs text-white"
              >
                Open profile
              </Link>
              <button
                type="button"
                onClick={() => setShowAiTip(false)}
                className="rounded-lg border border-[var(--assessment-outline-variant)] px-3 font-label-caps text-xs"
              >
                Ignore
              </button>
            </div>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setShowAiTip((v) => !v)}
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[var(--nexus-secondary)] text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
        >
          <AssessmentMaterialIcon name="auto_awesome" size={28} />
          {draftProfile ? (
            <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-white bg-[var(--nexus-tertiary)]" />
          ) : null}
        </button>
      </div>
    </>
  );
}
