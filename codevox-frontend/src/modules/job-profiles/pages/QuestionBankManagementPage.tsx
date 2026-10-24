'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QuestionBankRowActions } from '@/modules/job-profiles/components/QuestionBankRowActions';
import {
  bulkQuestionBankAction,
  listQuestionBank,
  type QuestionBankQuestion,
} from '@/modules/job-profiles/lib/job-profiles-api';

const COMPETENCY_FILTERS = ['Problem Solving', 'Leadership', 'Communication', 'Technical Skill'];

function questionTypeClass(type: string) {
  const t = type.toLowerCase();
  if (t.includes('behavior')) return 'bg-[var(--nexus-secondary-container)]/20 text-[var(--nexus-on-secondary-container)]';
  if (t.includes('technical')) return 'bg-[var(--nexus-tertiary-container)]/20 text-[var(--nexus-tertiary)]';
  if (t.includes('culture')) return 'bg-[var(--assessment-surface-container-highest)] text-[var(--assessment-on-surface)]';
  return 'bg-[var(--assessment-surface-container-high)] text-[var(--assessment-on-surface-variant)]';
}

function difficultyDotClass(difficulty: string) {
  const d = difficulty.toLowerCase();
  if (d === 'hard') return 'bg-[var(--assessment-error)]';
  if (d === 'easy') return 'bg-green-500';
  return 'bg-yellow-500';
}

export function QuestionBankManagementPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string>('all');
  const [difficulty, setDifficulty] = useState<string>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [competencyFilters, setCompetencyFilters] = useState<Set<string>>(new Set());

  const query = useQuery({
    queryKey: ['job-profile-question-bank', search, status, difficulty],
    queryFn: () =>
      listQuestionBank({
        search,
        page: 1,
        page_size: 100,
        status: status === 'all' ? undefined : [status],
        difficulty: difficulty === 'all' ? undefined : [difficulty],
      }),
  });

  const bulkPublishMutation = useMutation({
    mutationFn: () => bulkQuestionBankAction({ ids: [...selected], action: 'publish' }),
    onSuccess: () => {
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['job-profile-question-bank'] });
    },
  });

  const rows = query.data?.items ?? [];
  const filteredRows = useMemo(() => {
    if (!competencyFilters.size) return rows;
    return rows.filter((row) => {
      const tags = row.competencyTags ?? [];
      return tags.some((t) => competencyFilters.has(t));
    });
  }, [rows, competencyFilters]);

  const dynamicCompetencies = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => r.competencyTags?.forEach(t => set.add(t)));
    return Array.from(set).sort();
  }, [rows]);

  const headerStats = useMemo(() => {
    const total = rows.length;
    const published = rows.filter((r) => r.status === 'published').length;
    const draft = rows.filter((r) => r.status === 'draft').length;
    return { total, published, draft };
  }, [rows]);

  const allSelected =
    filteredRows.length > 0 && filteredRows.every((row) => selected.has(row.id));

  return (
    <div className="flex min-h-[calc(100vh-8rem)] gap-6 overflow-hidden">
      <aside className="w-64 shrink-0 space-y-4">
        <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-title-sm">Filters</h3>
            <button
              type="button"
              className="text-xs font-semibold text-[var(--assessment-primary)] hover:underline"
              onClick={() => {
                setCompetencyFilters(new Set());
                setDifficulty('all');
                setStatus('all');
              }}
            >
              Clear all
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                Competency
              </p>
              <div className="space-y-1">
                <select
                  value={competencyFilters.size > 0 ? Array.from(competencyFilters)[0] : 'all'}
                  onChange={(e) => {
                    if (e.target.value === 'all') setCompetencyFilters(new Set());
                    else setCompetencyFilters(new Set([e.target.value]));
                  }}
                  className="w-full rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-2 py-2 text-sm"
                >
                  <option value="all">All Competencies</option>
                  {(dynamicCompetencies.length > 0 ? dynamicCompetencies : COMPETENCY_FILTERS).map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                Difficulty
              </p>
              <div className="flex flex-wrap gap-1">
                {['all', 'easy', 'medium', 'hard'].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficulty(d)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                      difficulty === d
                        ? 'bg-[var(--assessment-surface-container-high)] text-[var(--assessment-primary)]'
                        : 'border border-[var(--assessment-outline-variant)] hover:bg-[var(--assessment-surface-container-low)]'
                    }`}
                  >
                    {d === 'all' ? 'All' : d[0]?.toUpperCase() + d.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                Status
              </p>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-2 py-2 text-sm"
              >
                <option value="all">All Statuses</option>
                <option value="published">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--assessment-primary)]/20 bg-[var(--assessment-primary)]/5 p-4">
          <div className="mb-2 flex items-center gap-2 text-[var(--assessment-primary)]">
            <span className="material-symbols-outlined text-[20px]">auto_awesome</span>
            <h4 className="font-title-sm">Quick Stats</h4>
          </div>
          <div className="space-y-3">
            <div className="flex items-end justify-between">
              <span className="text-xs text-[var(--assessment-on-surface-variant)]">Total Questions</span>
              <span className="font-mono-data text-2xl leading-none">{headerStats.total.toLocaleString()}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--assessment-outline-variant)]">
              <div className="h-full w-[85%] bg-[var(--assessment-primary)]" />
            </div>
            <p className="text-[11px] italic text-[var(--assessment-on-surface-variant)]">
              85% are high-performing (Usage: High)
            </p>
          </div>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/50 p-3">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => {
                  if (allSelected) {
                    setSelected(new Set());
                    return;
                  }
                  setSelected(new Set(filteredRows.map((r) => r.id)));
                }}
                className="rounded border-[var(--assessment-outline)] text-[var(--assessment-primary)]"
              />
              <span className="font-title-sm">Select All</span>
            </label>
            <div className="mx-2 h-6 w-px bg-[var(--assessment-outline-variant)]" />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => bulkPublishMutation.mutate()}
                disabled={!selected.size}
                className="flex items-center gap-1 rounded border border-[var(--assessment-outline-variant)] px-3 py-1.5 text-xs hover:bg-[var(--assessment-surface-container-high)] disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-sm">publish</span> Publish
              </button>
              <button
                type="button"
                disabled={!selected.size}
                onClick={async () => {
                  await bulkQuestionBankAction({ ids: [...selected], action: 'archive' });
                  setSelected(new Set());
                  queryClient.invalidateQueries({ queryKey: ['job-profile-question-bank'] });
                }}
                className="flex items-center gap-1 rounded border border-[var(--assessment-outline-variant)] px-3 py-1.5 text-xs hover:bg-[var(--assessment-surface-container-high)] disabled:opacity-40"
              >
                <span className="material-symbols-outlined text-sm">archive</span> Archive
              </button>
              <button
                type="button"
                className="flex items-center gap-1 rounded border border-[var(--assessment-outline-variant)] px-3 py-1.5 text-xs hover:bg-[var(--assessment-surface-container-high)]"
              >
                <span className="material-symbols-outlined text-sm">file_download</span> Export
              </button>
            </div>
          </div>
          <span className="text-xs text-[var(--assessment-on-surface-variant)]">
            Showing 1-{filteredRows.length} of {query.data?.total?.toLocaleString() ?? 0} questions
          </span>
        </div>

        <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] p-4">
          <div>
            <h1 className="font-display-lg">Question Bank</h1>
            <p className="text-sm text-[var(--assessment-on-surface-variant)]">
              Manage and organize your interview question repository
            </p>
          </div>
          <div className="flex gap-2">
          <Link
            href="/assessments/job-profiles/question-bank/create"
            className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            + Create Question
          </Link>
        </div>
        </div>

        <div className="border-b border-[var(--assessment-outline-variant)] p-4">
          <div className="relative max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[var(--assessment-outline)]">search</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions, competencies..."
              className="w-full rounded-lg border-none bg-[var(--assessment-surface-container-low)] py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
          />
          </div>
        </div>

        <div className="custom-scrollbar min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[1180px] border-collapse text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[var(--assessment-surface-container)]">
              <tr>
                <th className="border-b border-[var(--assessment-outline-variant)] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">Question Preview</th>
                <th className="border-b border-[var(--assessment-outline-variant)] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">Type</th>
                <th className="border-b border-[var(--assessment-outline-variant)] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">Competencies</th>
                <th className="border-b border-[var(--assessment-outline-variant)] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">Difficulty</th>
                <th className="border-b border-[var(--assessment-outline-variant)] px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">Usage Stats</th>
                <th className="border-b border-[var(--assessment-outline-variant)] px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--assessment-outline-variant)]">
              {filteredRows.map((row: QuestionBankQuestion) => {
                const usagePct = Math.max(0, Math.min(100, row.usageCount > 0 ? Math.round((row.usageCount / 200) * 100) : 0));
                const typeCls = questionTypeClass(row.questionType);
                return (
                  <tr key={row.id} className="group transition-colors hover:bg-[var(--assessment-surface-container-low)]">
                    <td className="max-w-xs px-4 py-3">
                      <div className="flex gap-3">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.id)) next.delete(row.id);
                          else next.add(row.id);
                          return next;
                        })
                      }
                          className="mt-1 rounded border-[var(--assessment-outline)] text-[var(--assessment-primary)]"
                    />
                        <div className="truncate">
                          <p className="truncate text-sm font-semibold">{(row as any).questionTextPlain || row.questionText.replace(/<[^>]+>/g, '')}</p>
                          <p className="truncate text-xs text-[var(--assessment-on-surface-variant)]">
                            {(row.topicTags ?? []).join(', ') || 'No topic tags'}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-1 text-[11px] font-bold uppercase tracking-wider ${typeCls}`}>
                        {row.questionType.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {(row.competencyTags ?? []).slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded-full bg-[var(--assessment-surface-container-high)] px-2 py-0.5 text-xs text-[var(--assessment-primary)]"
                          >
                            {tag}
                          </span>
                        ))}
                        {!row.competencyTags?.length ? (
                          <span className="text-xs text-[var(--assessment-on-surface-variant)]">-</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`h-2 w-2 rounded-full ${difficultyDotClass(row.difficulty)}`}></span>
                        <span className="text-sm">{row.difficulty}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="w-32">
                        <div className="mb-1 flex justify-between text-xs">
                          <span>Used {row.usageCount}x</span>
                          <span>{usagePct}%</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--assessment-outline-variant)]">
                          <div className="h-full bg-[var(--nexus-secondary)]" style={{ width: `${usagePct}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <QuestionBankRowActions
                        row={row}
                        onChanged={() => queryClient.invalidateQueries({ queryKey: ['job-profile-question-bank'] })}
                      />
                    </td>
                  </tr>
                );
              })}
              {!filteredRows.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-[var(--assessment-on-surface-variant)]">
                    No questions found.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
