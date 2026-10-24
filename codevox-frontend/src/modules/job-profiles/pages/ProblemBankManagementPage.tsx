'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ProblemBankRowActions } from '@/modules/job-profiles/components/ProblemBankRowActions';
import { listProblemBank, type ProblemBankProblem } from '@/modules/job-profiles/lib/job-profiles-api';

function statusBadgeClass(status: string) {
  if (status === 'published') return 'bg-[var(--assessment-primary-container)] text-[var(--assessment-on-primary-container)]';
  if (status === 'archived') return 'bg-[var(--assessment-surface-container)] text-[var(--assessment-outline)]';
  return 'bg-[var(--assessment-surface-container-high)] text-[var(--assessment-on-surface-variant)]';
}

export function ProblemBankManagementPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('all');
  const [language, setLanguage] = useState('all');

  const query = useQuery({
    queryKey: ['problem-bank', search, difficulty],
    queryFn: () =>
      listProblemBank({
        search,
        page: 1,
        page_size: 100,
        difficulty: difficulty === 'all' ? undefined : [difficulty],
      }),
  });

  const rows = query.data?.items ?? [];
  const filteredRows = useMemo(
    () =>
      rows.filter((row) =>
        language === 'all'
          ? true
          : (row.allowedLanguages ?? []).some((item) => item.toLowerCase() === language.toLowerCase()),
      ),
    [rows, language],
  );
  const totalProblems = rows.length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-[var(--assessment-on-surface)]">Coding Challenge Bank</h1>
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            Manage and organize algorithmic, system design, and framework-specific challenges.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm"
          >
            <option value="all">All Languages</option>
            <option value="python">Python</option>
            <option value="javascript">JavaScript</option>
            <option value="php">PHP</option>
            <option value="java">Java</option>
          </select>
          <select
            value={difficulty}
            onChange={(e) => setDifficulty(e.target.value)}
            className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm"
          >
            <option value="all">Complexity: All</option>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>
          <Link
            href="/assessments/job-profiles/problem-bank/create"
            className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Create Problem
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 space-y-4 lg:col-span-9">
          <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search problems, tags, or IDs..."
              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
            />
          </div>
          {filteredRows.map((row: ProblemBankProblem) => (
            <div
              key={row.id}
              className="group rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-6"
            >
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold text-[var(--assessment-primary)]">{row.title}</h3>
                    <span className="rounded-full bg-[var(--assessment-surface-container)] px-2 py-0.5 text-xs uppercase text-[var(--assessment-on-surface-variant)]">
                      {row.difficulty}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${statusBadgeClass(row.status)}`}>
                      {row.status}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(row.topicTags ?? []).map((tag) => (
                      <span
                        key={`${row.id}-${tag}`}
                        className="rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-2 py-0.5 text-[11px]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                </div>
                <ProblemBankRowActions
                  row={row}
                  onChanged={() => queryClient.invalidateQueries({ queryKey: ['problem-bank'] })}
                />
              </div>
              <div className="flex items-center justify-between border-t border-[var(--assessment-outline-variant)] pt-4">
                <div className="flex flex-wrap items-center gap-4 text-xs text-[var(--assessment-on-surface-variant)]">
                  <span>{(row.allowedLanguages ?? []).join(', ') || 'No language selected'}</span>
                  <span>{row.testCaseCount ?? 0} Test Cases</span>
                  <span>{row.timeLimitMinutes ?? 0} min</span>
                  <span>{row.marks ?? 0} marks</span>
                  <span>{row.workspaceType ?? 'code'} workspace</span>
                </div>
              </div>
            </div>
          ))}
          {!filteredRows.length ? (
            <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-10 text-center text-sm text-[var(--assessment-on-surface-variant)]">
              No problems found.
            </div>
          ) : null}
        </div>

        <div className="col-span-12 space-y-6 lg:col-span-3">
          <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4">
            <h4 className="mb-4 font-semibold">Bank Summary</h4>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-[var(--assessment-on-surface-variant)]">Total Problems</span>
                <span className="font-mono font-bold text-[var(--assessment-primary)]">{totalProblems}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--assessment-on-surface-variant)]">Active Tests</span>
                <span className="font-mono font-bold">
                  {rows.reduce((sum, row) => sum + (row.testCaseCount ?? 0), 0)}
                </span>
              </div>
            </div>
          </div>
          <div className="rounded-xl bg-[var(--assessment-primary)] p-4 text-white">
            <h4 className="font-semibold">Need a custom problem?</h4>
            <p className="mt-1 text-xs text-white/90">
              Generate test cases and statements with AI-assisted workflow and fine-tune sandbox settings.
            </p>
            <Link
              href="/assessments/job-profiles/problem-bank/create"
              className="mt-3 inline-block rounded-lg bg-[var(--assessment-surface-container)] px-3 py-2 text-xs font-semibold text-[var(--assessment-primary)]"
            >
              Try AI Builder
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
