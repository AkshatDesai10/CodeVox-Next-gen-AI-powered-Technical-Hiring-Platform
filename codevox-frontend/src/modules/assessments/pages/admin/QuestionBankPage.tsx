'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { listPlatformQuestions } from '@/lib/assessments-api';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

const TYPE_FILTERS = ['ALL', 'CODING', 'MCQ', 'SHORT_ANSWER', 'SYSTEM_DESIGN', 'INTERVIEW'] as const;

function typeBadgeClass(type: string) {
  switch (type) {
    case 'CODING':
      return 'bg-[var(--assessment-primary-fixed)] text-[var(--assessment-on-primary-fixed)]';
    case 'MCQ':
      return 'bg-[var(--assessment-secondary-container,var(--color-primary,#3b82f6))] text-white';
    case 'SYSTEM_DESIGN':
      return 'bg-[var(--assessment-tertiary-container,#0058b6)] text-white';
    case 'INTERVIEW':
      return 'bg-[var(--assessment-surface-container-highest)] text-[var(--assessment-on-surface)]';
    default:
      return 'bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)]';
  }
}

export function QuestionBankPage() {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<(typeof TYPE_FILTERS)[number]>('ALL');

  const { data, isLoading, error } = useQuery({
    queryKey: ['platform-questions'],
    queryFn: async () => (await listPlatformQuestions()).data,
  });

  const filtered = useMemo(() => {
    const rows = data ?? [];
    const q = search.trim().toLowerCase();
    return rows.filter((item) => {
      const matchesType = typeFilter === 'ALL' || item.questionType === typeFilter;
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.questionType.toLowerCase().includes(q) ||
        (item.source ?? 'STATIC').toLowerCase().includes(q);
      return matchesType && matchesSearch;
    });
  }, [data, search, typeFilter]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <nav className="mb-1 flex gap-1 text-xs font-semibold text-[var(--assessment-outline)]">
            <span>Library</span>
            <span>/</span>
            <span className="text-[var(--assessment-primary)]">Question Bank</span>
          </nav>
          <h1 className="text-3xl font-bold text-[var(--assessment-on-surface)]">Question Bank</h1>
          <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
            Manage and organize your technical assessment repository.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/assessments/create"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-4 py-2.5 text-sm font-semibold text-[var(--assessment-on-surface)] transition hover:bg-[var(--assessment-surface-container)]"
          >
            <AssessmentMaterialIcon name="auto_awesome" size={18} />
            AI Assessment
          </Link>
          <Link
            href="/assessments/questions/create"
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--assessment-primary)] px-4 py-2.5 text-sm font-bold text-white shadow-md transition hover:opacity-90"
          >
            <AssessmentMaterialIcon name="add_circle" size={18} className="text-white" />
            Create Question
          </Link>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-xl flex-1">
          <AssessmentMaterialIcon
            name="search"
            size={18}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--assessment-outline)]"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search questions, skills, or source..."
            className="w-full rounded-full border-none bg-[var(--assessment-surface-container-low)] py-2 pl-10 pr-4 text-sm focus:ring-2 focus:ring-[var(--assessment-primary-container)]"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {TYPE_FILTERS.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setTypeFilter(type)}
              className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                typeFilter === type
                  ? 'bg-[var(--assessment-primary)] text-white'
                  : 'bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-high)]'
              }`}
            >
              {type === 'ALL' ? 'All' : type.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="assessment-card overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-[var(--assessment-surface-container)] text-left text-xs font-bold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            <tr>
              <th className="px-4 py-3">Title</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Difficulty</th>
              <th className="px-4 py-3">Marks</th>
              <th className="px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--assessment-on-surface-variant)]">
                  Loading question bank...
                </td>
              </tr>
            ) : null}
            {error ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-red-600">
                  Failed to load questions
                </td>
              </tr>
            ) : null}
            {!isLoading && !error && filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-[var(--assessment-on-surface-variant)]">
                  No questions match your filters.
                </td>
              </tr>
            ) : null}
            {filtered.map((q) => (
              <tr
                key={q.id}
                className="border-t border-[var(--assessment-outline-variant)]/30 transition hover:bg-[var(--assessment-surface-container-low)]"
              >
                <td className="px-4 py-3 font-medium text-[var(--assessment-on-surface)]">{q.title}</td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${typeBadgeClass(q.questionType)}`}
                  >
                    {q.questionType.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-[var(--assessment-on-surface-variant)]">{q.difficulty}</td>
                <td className="px-4 py-3 font-mono text-[var(--assessment-on-surface-variant)]">{q.marks}</td>
                <td className="px-4 py-3">
                  <span className="rounded-md bg-[var(--assessment-surface-container)] px-2 py-0.5 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                    {q.source ?? 'STATIC'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
