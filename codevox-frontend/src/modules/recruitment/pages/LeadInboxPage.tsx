'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  countActiveFilters,
  DATE_RANGES,
  dateRangeToDates,
  DEFAULT_LEAD_INBOX_FILTERS,
  LeadInboxFilterDrawer,
  type LeadInboxFilters,
} from '@/modules/recruitment/components/LeadInboxFilterPanel';
import { RecruitmentOpsShell } from '@/modules/recruitment/components/RecruitmentOpsShell';
import { AddCandidateDialog } from '@/modules/recruitment/components/AddCandidateDialog';
import { BulkUploadDialog } from '@/modules/recruitment/components/BulkUploadDialog';
import {
  batchInviteLeads,
  getRecruitmentLeadStageCounts,
  inviteLeadToAssessment,
  listRecruitmentLeads,
  type RecruitmentLeadListItem,
} from '@/modules/recruitment/lib/recruitment-api';

const PIPELINE_STAGES = [
  { key: 'New', label: 'NEW' },
  { key: 'Qualified', label: 'QUALIFIED' },
  { key: 'Scheduled', label: 'SCHEDULED' },
  { key: 'Interviewed', label: 'INTERVIEW' },
  { key: 'Offered', label: 'OFFERED' },
] as const;

function leadName(row: RecruitmentLeadListItem) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ');
}

function leadSecondaryLine(row: RecruitmentLeadListItem) {
  return row.email?.trim() || row.phone?.trim() || '-';
}



function pipelineStageClass(active: boolean) {
  return active
    ? 'bg-[var(--assessment-primary)] text-white'
    : 'bg-[var(--assessment-surface-container-high)] text-[var(--assessment-on-surface-variant)]';
}

export function LeadInboxPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const courseFromUrl = searchParams?.get('course') ?? '';
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [addCandidateOpen, setAddCandidateOpen] = useState(false);
  const [bulkUploadOpen, setBulkUploadOpen] = useState(false);
  const [filters, setFilters] = useState<LeadInboxFilters>(DEFAULT_LEAD_INBOX_FILTERS);

  const invalidateLeads = () => {
    queryClient.invalidateQueries({ queryKey: ['recruitment-leads'] });
    queryClient.invalidateQueries({ queryKey: ['recruitment-lead-stage-counts'] });
    queryClient.invalidateQueries({ queryKey: ['recruitment-interviews-today'] });
  };

  const inviteSelectedMutation = useMutation({
    mutationFn: () => batchInviteLeads({ lead_ids: [...selected] }),
    onSuccess: (data) => {
      invalidateLeads();
      setSelected(new Set());
      alert(`Invited ${data.invited}, skipped ${data.skipped}.`);
    },
    onError: (err: Error) => {
      alert(`Batch invite failed: ${err.message}`);
    },
  });

  const inviteStandoutMutation = useMutation({
    mutationFn: () => batchInviteLeads({ lead_ids: [], min_score: 80 }),
    onSuccess: (data) => {
      invalidateLeads();
      alert(`Invited ${data.invited} standout lead${data.invited === 1 ? '' : 's'}, skipped ${data.skipped}.`);
    },
    onError: (err: Error) => {
      alert(`Standout invite failed: ${err.message}`);
    },
  });

  const dateBounds = useMemo(
    () => dateRangeToDates(filters.dateRangeDays, filters.startDate, filters.endDate),
    [filters.dateRangeDays, filters.startDate, filters.endDate],
  );

  const listFilters = {
    global_filter: filters.search,
    course_name: courseFromUrl || undefined,
    priority: filters.priority || undefined,
    date_from: dateBounds.date_from,
    date_to: dateBounds.date_to,
  };

  const query = useQuery({
    queryKey: ['recruitment-leads', page, filters, courseFromUrl, dateBounds],
    queryFn: () =>
      listRecruitmentLeads({
        page,
        pageSize: filters.pageSize,
        ...listFilters,
        lead_stage: filters.stage || undefined,
      }),
    refetchInterval: (q) => {
      const rows = q.state.data?.items ?? [];
      return rows.some((r) => r.resume_match_status === 'PENDING') ? 5000 : false;
    },
  });

  const stageCountsQuery = useQuery({
    queryKey: [
      'recruitment-lead-stage-counts',
      filters.search,
      courseFromUrl,
      filters.priority,
      filters.dateRangeDays,
      filters.startDate,
      filters.endDate,
    ],
    queryFn: () => getRecruitmentLeadStageCounts(listFilters),
  });

  const items = query.data?.items ?? [];

  const totalPages = query.data?.total_pages ?? 1;
  const pageSize = query.data?.page_size ?? filters.pageSize;

  const stats = query.data?.stats;
  const stageCounts = stageCountsQuery.data?.stage_counts ?? {};
  const allSelected = items.length > 0 && items.every((r) => selected.has(r.lead_id));
  const activeFilterCount = countActiveFilters(filters);

  const patchFilters = (patch: Partial<LeadInboxFilters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilters(DEFAULT_LEAD_INBOX_FILTERS);
    setPage(1);
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((r) => r.lead_id)));
    }
  };

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <RecruitmentOpsShell>
      <div className="-m-6 flex min-h-[calc(100vh-4rem)] flex-col overflow-hidden">
        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--assessment-surface)]">
          {selected.size > 0 ? (
            <div className="z-30 flex items-center justify-between bg-[var(--assessment-primary)] px-6 py-2 text-white shadow-lg">
              <div className="flex items-center gap-4">
                <span className="text-xs font-semibold uppercase tracking-wide">
                  {selected.size} leads selected
                </span>
                <button
                  type="button"
                  disabled={inviteSelectedMutation.isPending}
                  onClick={() => inviteSelectedMutation.mutate()}
                  className="flex items-center gap-1 rounded border border-white/30 px-3 py-1 text-sm hover:bg-white/10 disabled:opacity-60"
                >
                  <span className="material-symbols-outlined text-[18px]">mail</span>
                  {inviteSelectedMutation.isPending ? 'Inviting…' : 'Invite selected'}
                </button>
              </div>
              <button
                type="button"
                className="text-white/80 hover:text-white"
                onClick={() => setSelected(new Set())}
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
          ) : null}

          <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[200px] flex-1 max-w-xl">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[var(--assessment-on-surface-variant)]">
                  search
                </span>
                <input
                  className="w-full rounded-lg border-none bg-[var(--assessment-surface-container-low)] py-2.5 pl-10 pr-4 text-sm outline-none ring-2 ring-transparent focus:ring-[var(--assessment-primary)]/30"
                  placeholder="Search leads, pipelines..."
                  value={filters.search}
                  onChange={(e) => patchFilters({ search: e.target.value })}
                />
              </div>
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="relative flex items-center gap-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-2.5 text-sm font-semibold text-[var(--assessment-on-surface)] shadow-sm hover:border-[var(--assessment-primary)]"
              >
                <span className="material-symbols-outlined text-[20px]">tune</span>
                Filters
                {activeFilterCount > 0 ? (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--assessment-primary)] px-1.5 text-[10px] font-bold text-white">
                    {activeFilterCount}
                  </span>
                ) : null}
              </button>
              {filters.dateRangeDays !== 0 && (
                <div className="flex items-center gap-1.5 rounded-lg border border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/10 px-3 py-2 text-xs font-semibold text-[var(--assessment-primary)] shadow-sm">
                  <span className="material-symbols-outlined text-[16px]">calendar_today</span>
                  <span>
                    {filters.dateRangeDays === -1
                      ? `${filters.startDate || 'Start'} → ${filters.endDate || 'End'}`
                      : DATE_RANGES.find((r) => r.days === filters.dateRangeDays)?.label ?? 'Date Filter'}
                  </span>
                  <button
                    type="button"
                    onClick={() => patchFilters({ dateRangeDays: 0, startDate: '', endDate: '' })}
                    className="ml-1 hover:opacity-80"
                    title="Clear date filter"
                  >
                    <span className="material-symbols-outlined text-[14px]">close</span>
                  </button>
                </div>
              )}
              <button
                type="button"
                disabled={inviteStandoutMutation.isPending}
                onClick={() => {
                  if (
                    confirm(
                      'Invite all leads with resume match ≥80% who are not already invited?',
                    )
                  ) {
                    inviteStandoutMutation.mutate();
                  }
                }}
                className="flex items-center gap-2 self-center rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-2.5 text-sm font-semibold text-[var(--assessment-on-surface)] shadow-sm hover:border-[var(--assessment-primary)] disabled:opacity-60"
              >
                <span className="material-symbols-outlined text-[20px]">star</span>
                {inviteStandoutMutation.isPending
                  ? 'Inviting…'
                  : 'Invite all Standout (≥80%)'}
              </button>
              <button
                type="button"
                onClick={() => setBulkUploadOpen(true)}
                className="flex items-center gap-2 self-center rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-2.5 text-sm font-semibold text-[var(--assessment-on-surface)] shadow-sm hover:border-[var(--assessment-primary)]"
              >
                <span className="material-symbols-outlined text-[20px]">upload_file</span>
                Bulk Upload
              </button>
              <button
                type="button"
                onClick={() => setAddCandidateOpen(true)}
                className="ml-auto flex items-center gap-2 self-center rounded-lg bg-[var(--assessment-primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-sm"
              >
                <span className="material-symbols-outlined text-[20px]">person_add</span>
                Add candidate
              </button>
            </div>

            <div>
              <h1 className="font-display-lg">Lead Management</h1>
              <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                Lead inbox
                {courseFromUrl ? ` | ${courseFromUrl}` : ''}
              </p>
            </div>

            {courseFromUrl ? (
              <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                Filtered by course: <strong>{courseFromUrl}</strong>
              </p>
            ) : null}

            <div className="grid shrink-0 grid-cols-1 gap-4 md:grid-cols-4">
              <StatCard
                label="Total Active Leads"
                value={stageCounts.New ?? stats?.total_active ?? '-'}
                icon="person"
              />
              <StatCard label="Verified Leads" value={stats?.verified ?? '-'} icon="verified_user" />
              <div className="col-span-1 flex items-center gap-3 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4 md:col-span-2 md:border-l-4 md:border-l-[var(--nexus-tertiary)]">
                <span className="material-symbols-outlined text-[var(--nexus-tertiary)]">auto_awesome</span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-[var(--nexus-tertiary)]">AI INSIGHT</p>
                  <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                    {stats?.verified != null
                      ? `${stats.verified} verified leads on this page | ${stats.duplicates ?? 0} duplicates flagged.`
                      : 'Open a lead to run AI scoring and qualification.'}
                  </p>
                </div>
              </div>
            </div>

            <div className="shrink-0 overflow-x-auto rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-2">
              <div className="flex h-10 min-w-[800px]">
                {PIPELINE_STAGES.map((stage, i) => {
                  const count =
                    stageCounts[stage.key] ??
                    stageCounts[stage.key.toLowerCase()] ??
                    (stageCountsQuery.isLoading ? '...' : 0);
                  const active =
                    (filters.stage || 'New').toLowerCase() === stage.key.toLowerCase();
                  return (
                    <button
                      key={stage.key}
                      type="button"
                      onClick={() => patchFilters({ stage: stage.key })}
                      className={`flex flex-1 items-center justify-center text-xs font-semibold uppercase tracking-wide ${
                        i === 0 ? 'pipeline-chevron-first' : 'pipeline-chevron'
                      } ${pipelineStageClass(active)}`}
                    >
                      {stage.label} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] shadow-sm">
              {query.isLoading ? (
                <p className="p-8 text-sm">Loading leads...</p>
              ) : query.isError ? (
                <p className="p-8 text-sm text-red-600">Failed to load leads.</p>
              ) : (
                <>
                  <div className="h-full overflow-x-auto">
                    <table className="lead-inbox-table w-full border-collapse text-left">
                      <thead>
                        <tr className="border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]">
                          <th className="w-10 p-2">
                            <input
                              type="checkbox"
                              checked={allSelected}
                              onChange={toggleAll}
                              className="rounded border-[var(--assessment-outline-variant)] text-[var(--assessment-primary)] focus:ring-[var(--assessment-primary)]/30"
                            />
                          </th>
                          <th className="p-2 text-[var(--assessment-on-surface-variant)]">Lead Entity</th>
                          <th className="p-2 text-[var(--assessment-on-surface-variant)]">Job Profile</th>
                          <th className="p-2 text-[var(--assessment-on-surface-variant)]">Experience</th>
                          <th className="p-2 text-[var(--assessment-on-surface-variant)]">Resume Match</th>
                          <th className="p-2 text-[var(--assessment-on-surface-variant)]">Status</th>
                          <th className="p-2 text-[var(--assessment-on-surface-variant)]">CV</th>
                          <th className="p-2 text-center text-[var(--assessment-on-surface-variant)]">Invite</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--assessment-outline-variant)]">
                        {items.map((row) => {
                          const jobProfileText = row.courses?.map(c => c.course_name).filter(Boolean).join(', ');
                          return (
                            <tr
                              key={row.lead_id}
                              className="group cursor-pointer transition-colors hover:bg-[var(--assessment-surface-container-low)]/50"
                              onClick={() =>
                                router.push(
                                  `/assessments/recruitment/leads/${row.lead_id}`,
                                )
                              }
                            >
                              <td className="p-2" onClick={(e) => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  checked={selected.has(row.lead_id)}
                                  onChange={() => toggleRow(row.lead_id)}
                                  className="rounded border-[var(--assessment-outline-variant)] text-[var(--assessment-primary)] focus:ring-[var(--assessment-primary)]/30"
                                />
                              </td>
                              <td className="p-2">
                                <div className="flex flex-col">
                                  <span className="text-sm font-bold text-[var(--assessment-on-surface)]">
                                    {leadName(row) || '-'}
                                  </span>
                                  <span className="text-xs text-[var(--assessment-on-surface-variant)]">
                                    {leadSecondaryLine(row)}
                                  </span>
                                  {(row.duplicate_match_count ?? 0) > 0 ||
                                  row.priority === 'High' ||
                                  row.verified_lead === 1 ? (
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      {(row.duplicate_match_count ?? 0) > 0 ? (
                                        <span className="rounded bg-[var(--assessment-error-container)] px-1 text-[10px] font-bold uppercase text-[var(--assessment-on-error-container)]">
                                          Duplicate
                                        </span>
                                      ) : null}
                                      {row.priority === 'High' ? (
                                        <span className="rounded bg-[var(--nexus-tertiary-container)] px-1 text-[10px] font-bold uppercase text-white">
                                          Priority
                                        </span>
                                      ) : null}
                                      {row.verified_lead === 1 ? (
                                        <span className="rounded bg-green-100 px-1 text-[10px] font-bold uppercase text-green-800">
                                          Verified
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                              <td className="p-2">
                                {jobProfileText ? (
                                  <div className="flex items-center gap-1 text-sm font-medium text-[var(--assessment-on-surface)]">
                                    <span className="material-symbols-outlined text-[18px] text-[var(--assessment-primary)]">work</span>
                                    {jobProfileText}
                                  </div>
                                ) : (
                                  <span className="text-[var(--assessment-on-surface-variant)]">-</span>
                                )}
                              </td>
                              <td className="p-2 text-sm text-[var(--assessment-on-surface)]">
                                {row.experience_years != null ? `${row.experience_years} yrs` : '-'}
                              </td>
                              <td className="p-2">
                                <ResumeMatchCell lead={row} />
                              </td>
                              <td className="p-2">
                                <StatusBadge stage={row.effective_stage ?? row.lead_stage} />
                              </td>
                              <td className="p-2" onClick={(e) => e.stopPropagation()}>
                                {row.resume_url ? (
                                  <a href={row.resume_url} target="_blank" rel="noreferrer" className="flex items-center text-[var(--assessment-primary)] hover:underline">
                                    <span className="material-symbols-outlined text-[18px]">description</span>
                                  </a>
                                ) : (
                                  <span className="text-[var(--assessment-on-surface-variant)]">-</span>
                                )}
                              </td>
                              <td className="p-2 text-center" onClick={(e) => e.stopPropagation()}>
                                <InviteCell lead={row} />
                              </td>
                            </tr>
                          );
                        })}
                        {!items.length ? (
                          <tr>
                            <td colSpan={8} className="p-10 text-center text-[var(--assessment-on-surface-variant)]">
                              No leads match your filters.
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                  <Pager
                    page={query.data?.page ?? page}
                    pageSize={pageSize}
                    total={query.data?.total ?? 0}
                    totalPages={totalPages}
                    hasNextPage={query.data?.has_next_page ?? false}
                    hasPreviousPage={query.data?.has_previous_page ?? page > 1}
                    onPage={setPage}
                  />
                </>
              )}
            </div>
          </div>
        </main>

        <LeadInboxFilterDrawer
          open={filtersOpen}
          onClose={() => setFiltersOpen(false)}
          filters={filters}
          totalRecords={query.data?.total}
          currentPage={query.data?.page}
          totalPages={query.data?.total_pages}
          activeFilterCount={activeFilterCount}
          onChange={patchFilters}
          onClear={clearFilters}
        />
        <AddCandidateDialog
          open={addCandidateOpen}
          onClose={() => setAddCandidateOpen(false)}
          onCreated={() => {
            invalidateLeads();
          }}
        />
        <BulkUploadDialog
          open={bulkUploadOpen}
          onClose={() => setBulkUploadOpen(false)}
          onCreated={() => {
            invalidateLeads();
          }}
        />
      </div>
    </RecruitmentOpsShell>
  );
}

function StatCard(props: { label: string; value: string | number; icon: string }) {
  return (
    <div className="flex items-center gap-4 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4">
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--assessment-primary)]/10 text-[var(--assessment-primary)]">
        <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
          {props.icon}
        </span>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase text-[var(--assessment-on-surface-variant)]">
          {props.label}
        </p>
        <p className="text-2xl font-semibold">{props.value}</p>
      </div>
    </div>
  );
}


function StatusBadge(props: { stage: string | null }) {
  const s = (props.stage ?? 'New').toUpperCase();
  const qualified = s.includes('QUALIF');
  const scheduled = s.includes('SCHED');
  const interviewed = s.includes('INTERVIEW');
  const offered = s.includes('OFFER');
  const cls = qualified
    ? 'bg-[var(--assessment-primary-container)]/10 text-[var(--assessment-primary)]'
    : scheduled || interviewed
      ? 'bg-[var(--nexus-tertiary-container)]/10 text-[var(--nexus-tertiary)]'
      : offered
        ? 'bg-green-100 text-green-800'
        : 'bg-[var(--assessment-surface-container-highest)] text-[var(--assessment-on-surface-variant)]';
  return (
    <span className={`rounded px-2 py-1 text-[11px] font-bold ${cls}`}>{s}</span>
  );
}

function buildPageList(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const pages = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const out: Array<number | 'ellipsis'> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    if (i > 0 && sorted[i]! - sorted[i - 1]! > 1) out.push('ellipsis');
    out.push(sorted[i]!);
  }
  return out;
}

function Pager(props: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  onPage: (p: number) => void;
}) {
  const from = props.total ? (props.page - 1) * props.pageSize + 1 : 0;
  const to = Math.min(props.page * props.pageSize, props.total);
  const pages = buildPageList(props.page, props.totalPages);
  return (
    <div className="flex items-center justify-between border-t border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-2">
      <span className="text-sm text-[var(--assessment-on-surface-variant)]">
        Showing {from}-{to} of {props.total.toLocaleString()} entries
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="rounded p-1 transition-colors hover:bg-[var(--assessment-surface-container-low)] disabled:opacity-40"
          disabled={!props.hasPreviousPage}
          onClick={() => props.onPage(props.page - 1)}
        >
          <span className="material-symbols-outlined text-[20px]">chevron_left</span>
        </button>
        {pages.map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`ellipsis-${i}`} className="px-2 text-sm text-[var(--assessment-on-surface-variant)]">
              ...
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => props.onPage(p)}
              className={`rounded px-2 py-1 text-sm transition-colors ${
                p === props.page
                  ? 'bg-[var(--assessment-primary)] text-white'
                  : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-low)]'
              }`}
            >
              {p}
            </button>
          ),
        )}
        <button
          type="button"
          className="rounded p-1 transition-colors hover:bg-[var(--assessment-surface-container-low)] disabled:opacity-40"
          disabled={!props.hasNextPage}
          onClick={() => props.onPage(props.page + 1)}
        >
          <span className="material-symbols-outlined text-[20px]">chevron_right</span>
        </button>
      </div>
    </div>
  );
}

function matchTier(score: number): { label: string; className: string } | null {
  if (score >= 90) {
    return {
      label: 'Standout',
      className: 'bg-emerald-100 text-emerald-800',
    };
  }
  if (score >= 80) {
    return {
      label: 'Strong',
      className: 'bg-sky-100 text-sky-800',
    };
  }
  if (score >= 65) {
    return {
      label: 'Moderate',
      className: 'bg-amber-100 text-amber-800',
    };
  }
  return null;
}

function ResumeMatchCell({ lead }: { lead: RecruitmentLeadListItem }) {
  const status = lead.resume_match_status;
  const score = lead.resume_match_score;
  const err = lead.resume_match_error;

  if (status === 'PENDING') {
    return (
      <span className="text-xs font-medium text-[var(--assessment-primary)]">Analyzing…</span>
    );
  }
  if (status === 'COMPLETED' && score != null) {
    const tier = matchTier(score);
    return (
      <div className="flex flex-col items-start gap-1">
        <span
          className="font-mono-data text-sm font-bold text-[var(--assessment-primary)]"
          title={
            lead.resume_match_confidence != null
              ? `Confidence ${lead.resume_match_confidence}`
              : undefined
          }
        >
          {Math.round(score)}
        </span>
        {tier ? (
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tier.className}`}
          >
            {tier.label}
          </span>
        ) : null}
      </div>
    );
  }
  if (status === 'UNAVAILABLE') {
    return (
      <span
        className="text-xs text-[var(--assessment-on-surface-variant)]"
        title={err ?? 'Unavailable'}
      >
        Unavailable
      </span>
    );
  }
  if (status === 'FAILED') {
    return (
      <span className="text-xs text-amber-700" title={err ?? 'Failed'}>
        Failed
      </span>
    );
  }
  return <span className="text-[var(--assessment-on-surface-variant)]">—</span>;
}

function InviteCell({ lead }: { lead: RecruitmentLeadListItem }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => inviteLeadToAssessment(lead.lead_id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recruitment-leads'] });
      queryClient.invalidateQueries({ queryKey: ['recruitment-interviews-today'] });
    },
    onError: (err: any) => {
      alert(`Failed to send invite: ${err.message}`);
    },
  });

  if (lead.invite_status === 'INVITED') {
    return (
      <div className="flex flex-col items-center justify-center gap-1">
        <span className="rounded bg-green-100 px-2 py-1 text-xs font-bold text-green-800">
          Invited ✓
        </span>
        {lead.invite_token && (
          <button
            type="button"
            className="flex items-center gap-1 text-[10px] font-medium text-[var(--assessment-primary)] hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              const url = `${window.location.origin}/candidate/portal/${lead.invite_token}`;
              navigator.clipboard.writeText(url).then(() => {
                alert('Magic Link copied to clipboard!');
              });
            }}
          >
            <span className="material-symbols-outlined text-[12px]">content_copy</span>
            Copy Link
          </button>
        )}
      </div>
    );
  }

  if (lead.invite_status === 'NO_OPENING') {
    return (
      <span className="rounded bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">
        No Opening
      </span>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1">
      {lead.invite_status === 'PENDING' ? (
        <span className="rounded bg-[var(--assessment-surface-container-high)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--assessment-on-surface-variant)]">
          Pending review
        </span>
      ) : null}
      <button
        type="button"
        disabled={mutation.isPending}
        onClick={(e) => {
          e.stopPropagation();
          mutation.mutate();
        }}
        className="flex items-center justify-center rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-2 py-1 text-xs font-semibold text-[var(--assessment-primary)] transition-colors hover:bg-[var(--assessment-surface-container-low)] disabled:opacity-50"
      >
        {mutation.isPending ? 'Sending...' : 'Send Magic Link'}
      </button>
    </div>
  );
}
