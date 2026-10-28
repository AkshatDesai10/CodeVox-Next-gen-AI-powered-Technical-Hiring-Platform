'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { DashboardPipelineBar } from '@/modules/job-profiles/components/DashboardPipelineBar';
import { CodeVoxStatusBadge } from '@/modules/job-profiles/components/CodeVoxStatusBadge';
import {
  approveJobProfile,
  archiveJobProfile,
  closeJobProfile,
  deleteJobProfile,
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
  const [profileToDelete, setProfileToDelete] = useState<{ id: string; title: string } | null>(null);

  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteJobProfile(id),
    onMutate: async (id: string) => {
      // 1. Close dialog immediately so UI does not stay on screen
      setProfileToDelete(null);

      // 2. Remove queries for this profile so they never refetch and trigger 404
      queryClient.removeQueries({ queryKey: ['job-profile', id] });
      queryClient.removeQueries({ queryKey: ['job-profile-ai-insights', id] });
      queryClient.removeQueries({ queryKey: ['job-profile-analytics', id] });

      // 3. Cancel outgoing refetches for the list
      await queryClient.cancelQueries({ queryKey: ['job-profiles-local'] });

      // 4. Optimistically remove the item from local cache
      queryClient.setQueriesData({ queryKey: ['job-profiles-local'] }, (old: any) => {
        if (!old || !Array.isArray(old.items)) return old;
        return {
          ...old,
          items: old.items.filter((item: any) => item.id !== id),
          total: Math.max(0, (old.total ?? 1) - 1),
        };
      });
    },
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ['job-profile', id] });
      invalidate();
    },
    onError: (err: any) => {
      invalidate();
      // Suppress 404 alert if profile is already deleted/inactive
      if (!err?.message?.includes('404') && !err?.message?.includes('not found')) {
        alert(err?.message || 'Failed to delete job profile');
      }
    },
  });

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
          <div className="codevox-card group relative overflow-hidden p-6">
            <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
              <AssessmentMaterialIcon name="work" size={72} className="text-[var(--assessment-primary)]" />
            </div>
            <p className="font-label-caps mb-2 text-[var(--codevox-outline)]">Job profiles</p>
            <div className="flex items-baseline gap-2">
              <h3 className="font-display-lg text-[var(--assessment-primary)]">{stats.total}</h3>
              <span className="text-sm text-[var(--codevox-outline)]">total</span>
            </div>
            <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
              {stats.active} active | {stats.pending} pending approval
            </p>
          </div>

          <div className="codevox-card group relative overflow-hidden p-6">
            <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
              <AssessmentMaterialIcon name="pending_actions" size={72} className="text-[var(--codevox-secondary)]" />
            </div>
            <p className="font-label-caps mb-2 text-[var(--codevox-outline)]">Pending approvals</p>
            <div className="flex items-baseline gap-2">
              <h3 className="font-display-lg text-[var(--codevox-secondary)]">
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

          <div className="codevox-card group relative overflow-hidden p-6">
            <div className="absolute right-0 top-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
              <AssessmentMaterialIcon name="groups" size={72} className="text-[var(--codevox-tertiary)]" />
            </div>
            <p className="font-label-caps mb-2 text-[var(--codevox-outline)]">Active openings</p>
            <div className="flex items-baseline gap-2">
              <h3 className="font-display-lg">{stats.active}</h3>
              <span className="text-sm text-[var(--codevox-outline)]">live roles</span>
            </div>
            <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
              {stats.openings} total seats across active profiles
            </p>
          </div>
        </div>

        <div className="codevox-card flex flex-col overflow-hidden">
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
              <table className="codevox-table-dense w-full text-left">
                <thead>
                  <tr>
                    <th className="font-label-caps text-[var(--codevox-outline)]">Job profile title</th>
                    <th className="font-label-caps text-[var(--codevox-outline)]">Status</th>
                    <th className="font-label-caps text-[var(--codevox-outline)]">Pipeline progress</th>
                    <th className="font-label-caps text-[var(--codevox-outline)]">Openings</th>
                    <th className="font-label-caps text-[var(--codevox-outline)]">Last updated</th>
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
                          <p className="text-sm text-[var(--codevox-outline)]">{loc || '-'}</p>
                        </td>
                        <td>
                          <CodeVoxStatusBadge status={profile.status as JobProfileStatus} />
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
                          <span className="text-sm text-[var(--codevox-outline)]">
                            {formatDate(profile.updated_at ?? profile.created_at)}
                          </span>
                        </td>
                        <td className="text-right">
                          <div className="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                            <Link
                              href={`/assessments/job-profiles/${profile.id}/analytics`}
                              className="rounded-full p-2 text-[var(--assessment-primary)] hover:text-white hover:bg-[var(--assessment-primary)]/20 transition-colors"
                              title="Analytics"
                            >
                              <AssessmentMaterialIcon name="analytics" size={18} />
                            </Link>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setProfileToDelete({ id: profile.id, title: profile.title });
                              }}
                              className="rounded-full p-2 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors cursor-pointer"
                              title="Delete Profile"
                            >
                              <AssessmentMaterialIcon name="delete" size={18} />
                            </button>
                            {profile.status === 'pending_approval' ? (
                              <button
                                type="button"
                                onClick={() => actionMutation.mutate({ action: 'approve', id: profile.id })}
                                className="rounded-full p-2 text-[var(--codevox-secondary)] hover:bg-[var(--color-primary-container)]"
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
            <span className="text-sm text-[var(--codevox-outline)]">
              {stats.total} job profiles
            </span>
          </div>
        </div>
      </div>

      <div className="codevox-fab flex flex-col items-end gap-4">
        {showAiTip && draftProfile ? (
          <div className="codevox-glass-ai max-w-xs rounded-xl p-6 shadow-xl">
            <div className="mb-2 flex items-center gap-2">
              <AssessmentMaterialIcon name="auto_awesome" size={20} className="text-[var(--codevox-secondary)]" />
              <span className="font-title-sm text-[var(--codevox-secondary)]">AI recommendation</span>
            </div>
            <p className="text-sm">
              &ldquo;{draftProfile.title}&rdquo; may be missing competencies. Open configure to run AI suggestions.
            </p>
            <div className="mt-4 flex gap-2">
              <Link
                href={`/assessments/job-profiles/${draftProfile.id}/configure`}
                className="flex-1 rounded-lg bg-[var(--codevox-secondary)] py-2 text-center font-label-caps text-xs text-white"
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
          className="relative flex h-14 w-14 items-center justify-center rounded-full bg-[var(--codevox-secondary)] text-white shadow-lg transition-transform hover:scale-110 active:scale-95"
        >
          <AssessmentMaterialIcon name="auto_awesome" size={28} />
          {draftProfile ? (
            <span className="absolute -right-1 -top-1 h-4 w-4 rounded-full border-2 border-white bg-[var(--codevox-tertiary)]" />
          ) : null}
        </button>
      </div>
      {profileToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-2xl">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-rose-500/15 text-rose-400 border border-rose-500/25">
                <AssessmentMaterialIcon name="delete_forever" size={24} />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Delete Job Profile?</h3>
                <p className="text-xs text-slate-400">This action will remove this job profile from active listings.</p>
              </div>
            </div>
            <p className="mb-6 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-3 text-sm text-[var(--assessment-on-surface)]">
              Are you sure you want to delete <span className="font-bold text-white">&ldquo;{profileToDelete.title}&rdquo;</span>?
            </p>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => setProfileToDelete(null)}
                className="rounded-xl border border-[var(--assessment-outline-variant)] px-4 py-2 text-xs font-semibold text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-high)] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(profileToDelete.id)}
                className="rounded-xl bg-rose-600 hover:bg-rose-700 px-4 py-2 text-xs font-bold text-white transition-all shadow-[0_0_15px_rgba(225,29,72,0.3)] disabled:opacity-50"
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Profile'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
