'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { listInterviewReports } from '@/modules/autonomous-interview/lib/interview-report-api';
import { formatFinalizedAt, formatSessionIdAsName } from '@/modules/autonomous-interview/utils/interview-report';

function initials(name: string) {
  const parts = name.split(/[\s\-_]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  return (parts[0]?.slice(0, 2) ?? 'CA').toUpperCase();
}

const PAGE_SIZE = 10;

export function InterviewReportsPage() {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ['interview-reports'],
    queryFn: async () => (await listInterviewReports()).data,
  });

  const rows = data ?? [];
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const name = (row.candidateName || formatSessionIdAsName(row.token)).toLowerCase();
      return (
        name.includes(needle) ||
        row.token.toLowerCase().includes(needle) ||
        (row.techStack ?? '').toLowerCase().includes(needle)
      );
    });
  }, [query, rows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const latest = rows
    .map((row) => row.finalizedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);

  if (isLoading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading interview reports">
        <div className="h-8 w-56 animate-pulse rounded bg-[var(--assessment-surface-container-high)]" />
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1].map((item) => (
            <div key={item} className="nexus-card h-20 animate-pulse" />
          ))}
        </div>
        <div className="nexus-card h-64 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        Interview reports could not be loaded.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display-lg text-[var(--assessment-on-surface)]">Interview reports</h1>
          <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
            Completed voice interviews.
          </p>
        </div>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setPage(1);
          }}
          placeholder="Search name, role, or session"
          className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface)] px-3 py-2 text-sm lg:w-72"
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <article className="nexus-card p-4">
          <p className="text-xs text-[var(--assessment-on-surface-variant)]">Reports</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{rows.length}</p>
        </article>
        <article className="nexus-card p-4">
          <p className="text-xs text-[var(--assessment-on-surface-variant)]">Latest</p>
          <p className="mt-1 text-sm font-semibold">{latest ? formatFinalizedAt(latest) : '—'}</p>
        </article>
      </div>

      <div className="nexus-card overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--assessment-surface-container)] text-left text-xs text-[var(--assessment-on-surface-variant)]">
            <tr>
              <th className="px-4 py-3 font-medium">Candidate</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Finished</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-sm text-[var(--assessment-on-surface-variant)]">
                  {rows.length === 0 ? 'No completed interviews yet.' : 'No reports match that search.'}
                </td>
              </tr>
            ) : (
              visible.map((row) => {
                const name = row.candidateName || formatSessionIdAsName(row.token);
                return (
                  <tr
                    key={`${row.token}-${row.filename}`}
                    className="border-t border-[var(--assessment-outline-variant)]/40 transition-colors hover:bg-[var(--assessment-surface-container)]/50"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--assessment-primary-container)] text-xs font-semibold text-[var(--assessment-primary)]">
                          {initials(name)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate font-medium">{name}</div>
                          <div className="truncate font-mono text-[11px] text-[var(--assessment-on-surface-variant)]">{row.token}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full border border-[var(--assessment-outline-variant)] px-2.5 py-1 text-xs">
                        {row.techStack || 'Not set'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {row.endedByCandidate ? (
                        <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800">
                          Self-terminated
                        </span>
                      ) : (
                        <span className="text-xs text-[var(--assessment-on-surface-variant)]">Completed</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-[var(--assessment-on-surface-variant)]">{formatFinalizedAt(row.finalizedAt)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/assessments/interview-reports/${encodeURIComponent(row.token)}`}
                        className="inline-flex rounded-lg bg-[var(--assessment-primary)] px-3 py-1.5 text-xs font-semibold text-white"
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div className="flex items-center justify-between border-t border-[var(--assessment-outline-variant)]/40 px-4 py-3 text-xs text-[var(--assessment-on-surface-variant)]">
          <span>
            Page {currentPage} of {pageCount}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md border border-[var(--assessment-outline-variant)] px-2.5 py-1 disabled:opacity-40"
              disabled={currentPage <= 1}
              onClick={() => setPage(currentPage - 1)}
            >
              Prev
            </button>
            <button
              type="button"
              className="rounded-md border border-[var(--assessment-outline-variant)] px-2.5 py-1 disabled:opacity-40"
              disabled={currentPage >= pageCount}
              onClick={() => setPage(currentPage + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
