'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { CompetencyMultiSelect } from '@/modules/job-profiles/components/CompetencyMultiSelect';
import {
  listJobProfileCompetencyCatalog,
  listProblemBank,
  listQuestionBank,
  mapBankContentToProfile,
  type ProblemBankProblem,
  type QuestionBankQuestion,
} from '@/modules/job-profiles/lib/job-profiles-api';

type Props = {
  mode?: 'drawer' | 'inline';
  open?: boolean;
  profileId?: string;
  stageId?: string | null;
  roundName?: string;
  roundStageType?: string;
  /** Job profile rubric competency names */
  competencies?: string[];
  /** Bank question IDs already on this round */
  existingQuestionBankIds?: string[];
  /** Bank problem IDs already on this round */
  existingProblemBankIds?: string[];
  onClose?: () => void;
  onAddQuestions: (rows: QuestionBankQuestion[]) => void;
  onAddProblems: (rows: ProblemBankProblem[]) => void;
  onAddContent?: (payload: {
    questions: QuestionBankQuestion[];
    problems: ProblemBankProblem[];
  }) => void;
};

function questionLabel(q: QuestionBankQuestion & Record<string, unknown>) {
  const raw = String(q.questionText ?? q.question_text ?? '').trim();
  if (raw) {
    return raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return 'Untitled question';
}

function normalizeTags(row: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = row[key];
    if (Array.isArray(value)) {
      return value.map((item) => String(item).trim()).filter(Boolean);
    }
  }
  return [];
}

function rowSearchText(row: Record<string, unknown>): string {
  return String(
    row.questionText ?? row.question_text ?? row.title ?? row.statementMd ?? row.statement_md ?? '',
  )
    .replace(/<[^>]+>/g, ' ')
    .toLowerCase();
}

function matchesCompetencyFilter(
  row: Record<string, unknown>,
  selected: string[],
  kind: 'question' | 'problem',
): boolean {
  if (!selected.length) return true;
  const tagKeys =
    kind === 'question'
      ? ['competencyTags', 'competency_tags', 'topicTags', 'topic_tags']
      : ['topicTags', 'topic_tags'];
  const tags = normalizeTags(row, tagKeys).map((t) => t.toLowerCase());
  const text = rowSearchText(row);
  return selected.some((sel) => {
    const needle = sel.trim().toLowerCase();
    if (!needle) return false;
    if (tags.some((t) => t === needle || t.includes(needle) || needle.includes(t))) return true;
    return text.includes(needle);
  });
}

export function RoundQuestionProblemPicker(props: Props) {
  const mode = props.mode ?? 'drawer';
  const isActive = mode === 'inline' || Boolean(props.open);

  const catalogQuery = useQuery({
    queryKey: ['job-profile-competency-catalog', 'content-picker'],
    queryFn: () => listJobProfileCompetencyCatalog(),
    enabled: isActive,
    staleTime: 60_000,
  });

  const profileCompetencies = useMemo(
    () => (props.competencies ?? []).map((c) => c.trim()).filter(Boolean),
    [props.competencies],
  );

  const alreadyAddedQuestionIds = useMemo(
    () => new Set((props.existingQuestionBankIds ?? []).map(String)),
    [props.existingQuestionBankIds],
  );
  const alreadyAddedProblemIds = useMemo(
    () => new Set((props.existingProblemBankIds ?? []).map(String)),
    [props.existingProblemBankIds],
  );

  const competencyOptions = useMemo(() => {
    const names = new Set<string>(profileCompetencies);
    catalogQuery.data?.forEach((item) => {
      if (item.name?.trim()) names.add(item.name.trim());
    });
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [profileCompetencies, catalogQuery.data]);

  const [tab, setTab] = useState<'question' | 'problem'>('question');
  const [search, setSearch] = useState('');
  const [selectedCompetencies, setSelectedCompetencies] = useState<string[]>([]);
  const [selectedQuestions, setSelectedQuestions] = useState<Set<string>>(new Set());
  const [selectedProblems, setSelectedProblems] = useState<Set<string>>(new Set());
  const [mappingNotes, setMappingNotes] = useState('');

  const aiMapMutation = useMutation({
    mutationFn: () => {
      if (!props.profileId) {
        throw new Error('Job profile is required for AI mapping.');
      }
      const isCodingRound = props.roundStageType === 'coding';
      return mapBankContentToProfile(props.profileId, {
        stage_id: props.stageId ?? undefined,
        content_type: 'both',
        max_questions: 8,
        max_problems: isCodingRound ? 6 : 3,
      });
    },
    onSuccess: (data) => {
      setMappingNotes(data.mapping_notes?.trim() ?? '');
      setSelectedCompetencies([]);
      if (data.question_ids?.length) {
        setSelectedQuestions((prev) => {
          const next = new Set(prev);
          for (const id of data.question_ids) next.add(String(id));
          return next;
        });
      }
      if (data.problem_ids?.length) {
        setSelectedProblems((prev) => {
          const next = new Set(prev);
          for (const id of data.problem_ids) next.add(String(id));
          return next;
        });
      }
    },
  });

  useEffect(() => {
    if (!isActive) return;
    setSelectedCompetencies([]);
    setSelectedQuestions(new Set(props.existingQuestionBankIds ?? []));
    setSelectedProblems(new Set(props.existingProblemBankIds ?? []));
    setMappingNotes('');
  }, [isActive, profileCompetencies, props.existingQuestionBankIds, props.existingProblemBankIds]);

  const listBody = useMemo(
    () => ({
      search,
      page: 1,
      page_size: 100,
      status: ['published', 'draft'] as string[],
    }),
    [search],
  );

  const questionQuery = useQuery({
    queryKey: ['question-bank-picker', listBody, selectedCompetencies],
    queryFn: () => listQuestionBank(listBody),
    enabled: isActive,
  });
  const problemQuery = useQuery({
    queryKey: ['problem-bank-picker', listBody, selectedCompetencies],
    queryFn: () => listProblemBank(listBody),
    enabled: isActive,
  });

  const questionRows = useMemo(() => {
    const items = (questionQuery.data?.items ?? []) as Array<QuestionBankQuestion & Record<string, unknown>>;
    return items.filter((row) => matchesCompetencyFilter(row, selectedCompetencies, 'question'));
  }, [questionQuery.data, selectedCompetencies]);

  const problemRows = useMemo(() => {
    const items = (problemQuery.data?.items ?? []) as Array<ProblemBankProblem & Record<string, unknown>>;
    return items.filter((row) => matchesCompetencyFilter(row, selectedCompetencies, 'problem'));
  }, [problemQuery.data, selectedCompetencies]);

  const activeQuery = tab === 'question' ? questionQuery : problemQuery;

  const newQuestionCount = useMemo(
    () => [...selectedQuestions].filter((id) => !alreadyAddedQuestionIds.has(id)).length,
    [selectedQuestions, alreadyAddedQuestionIds],
  );
  const newProblemCount = useMemo(
    () => [...selectedProblems].filter((id) => !alreadyAddedProblemIds.has(id)).length,
    [selectedProblems, alreadyAddedProblemIds],
  );
  const newSelectedCount = newQuestionCount + newProblemCount;

  const projectedBoost = Math.min(30, newSelectedCount * 6);
  const projectedPct = Math.min(100, 55 + projectedBoost);

  const addButtonLabel = useMemo(() => {
    if (newSelectedCount === 0) return 'Add New Items';
    if (newQuestionCount > 0 && newProblemCount > 0) {
      return `Add ${newQuestionCount} question${newQuestionCount === 1 ? '' : 's'} & ${newProblemCount} challenge${newProblemCount === 1 ? '' : 's'}`;
    }
    return `Add ${newSelectedCount} New Item${newSelectedCount === 1 ? '' : 's'}`;
  }, [newSelectedCount, newQuestionCount, newProblemCount]);

  const filterLabel =
    selectedCompetencies.length === 0
      ? 'All bank items'
      : selectedCompetencies.length === 1
        ? selectedCompetencies[0]!
        : `${selectedCompetencies.length} competencies`;

  const addSelected = () => {
    const allQuestions = (questionQuery.data?.items ?? []) as QuestionBankQuestion[];
    const allProblems = (problemQuery.data?.items ?? []) as ProblemBankProblem[];

    const toAddQuestions = allQuestions.filter(
      (q) => selectedQuestions.has(q.id) && !alreadyAddedQuestionIds.has(q.id),
    );
    const toAddProblems = allProblems.filter(
      (p) => selectedProblems.has(p.id) && !alreadyAddedProblemIds.has(p.id),
    );

    if (toAddQuestions.length || toAddProblems.length) {
      if (props.onAddContent) {
        props.onAddContent({ questions: toAddQuestions, problems: toAddProblems });
      } else {
        if (toAddQuestions.length) props.onAddQuestions(toAddQuestions);
        if (toAddProblems.length) props.onAddProblems(toAddProblems);
      }
    }
    props.onClose?.();
  };

  if (!isActive) return null;

  const listRows = tab === 'question' ? questionRows : problemRows;

  const panel = (
    <aside
      className={`flex flex-col overflow-hidden bg-[var(--assessment-surface)] shadow-2xl ${
        mode === 'inline'
          ? 'h-full min-h-[32rem] rounded-xl border border-[var(--assessment-outline-variant)]'
          : 'relative h-full w-full max-w-[440px]'
      }`}
    >
      <div className="border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-headline-md font-bold text-[var(--assessment-primary)]">Add Content</h3>
            <p className="font-label-caps text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
              {props.roundName ? `${props.roundName} | ` : ''}
              Question & problem bank
            </p>
          </div>
          {mode === 'drawer' ? (
            <button
              type="button"
              onClick={props.onClose}
              className="flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[var(--assessment-surface-container)]"
            >
              <AssessmentMaterialIcon name="close" size={20} />
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-4">
        <button
          type="button"
          onClick={() => setTab('question')}
          className={`flex-1 py-2 text-sm font-bold transition-colors ${
            tab === 'question'
              ? 'border-b-2 border-[var(--assessment-primary)] text-[var(--assessment-primary)]'
              : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)]'
          }`}
        >
          Interview Questions
          {newQuestionCount > 0 ? (
            <span className="ml-1.5 rounded-full bg-[var(--assessment-primary)] px-1.5 py-0.5 text-[10px] text-white">
              {newQuestionCount}
            </span>
          ) : null}
        </button>
        <button
          type="button"
          onClick={() => setTab('problem')}
          className={`flex-1 py-2 text-sm font-medium transition-colors ${
            tab === 'problem'
              ? 'border-b-2 border-[var(--assessment-primary)] font-bold text-[var(--assessment-primary)]'
              : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)]'
          }`}
        >
          Coding Challenges
          {newProblemCount > 0 ? (
            <span className="ml-1.5 rounded-full bg-[var(--assessment-primary)] px-1.5 py-0.5 text-[10px] text-white">
              {newProblemCount}
            </span>
          ) : null}
        </button>
      </div>

      <div className="space-y-3 border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)]/50 p-4">
        <div className="relative">
          <AssessmentMaterialIcon
            name="search"
            size={20}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--assessment-outline)]"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search question & problem bank..."
            className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] py-2.5 pl-10 pr-4 text-sm shadow-sm outline-none transition-all focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
          />
        </div>

        <CompetencyMultiSelect
          options={competencyOptions}
          value={selectedCompetencies}
          onChange={setSelectedCompetencies}
          label="Filter by competency"
          placeholder="All competencies (no filter)"
          disabled={!competencyOptions.length}
        />

        {props.profileId ? (
          <button
            type="button"
            disabled={aiMapMutation.isPending}
            onClick={() => aiMapMutation.mutate()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[var(--codevox-secondary)]/40 bg-[var(--codevox-secondary-container)]/20 py-2.5 text-sm font-bold text-[var(--codevox-secondary)] transition hover:bg-[var(--codevox-secondary-container)]/35 disabled:opacity-60"
          >
            <AssessmentMaterialIcon
              name="auto_awesome"
              size={18}
              className={aiMapMutation.isPending ? 'animate-spin' : undefined}
              style={{ fontVariationSettings: "'FILL' 1" }}
            />
            {aiMapMutation.isPending ? 'AI mapping...' : 'AI Map from job profile'}
          </button>
        ) : null}

        {mappingNotes ? (
          <p className="rounded-lg border border-[var(--codevox-secondary)]/25 bg-[var(--codevox-secondary-container)]/15 px-3 py-2 text-[11px] text-[var(--assessment-on-surface-variant)]">
            <span className="font-bold text-[var(--codevox-secondary)]">AI: </span>
            {mappingNotes}
          </p>
        ) : null}
        {aiMapMutation.isError ? (
          <p className="text-[11px] text-[var(--assessment-error)]">
            {(aiMapMutation.error as Error).message || 'AI mapping failed.'}
          </p>
        ) : null}

        <p className="text-[10px] text-[var(--assessment-on-surface-variant)]">
          Showing: {filterLabel}
          {selectedCompetencies.length > 0 ? ` | ${listRows.length} match${listRows.length === 1 ? '' : 'es'}` : ''}
        </p>
        {!competencyOptions.length ? (
          <p className="text-[10px] text-amber-800">
            Add competencies to the job profile rubric (step 2) to enable competency filtering.
          </p>
        ) : null}
      </div>

      <div className="custom-scrollbar flex-1 space-y-4 overflow-y-auto bg-[var(--assessment-background)]/50 p-4">
        {activeQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-[var(--assessment-on-surface-variant)]">Loading bank...</p>
        ) : activeQuery.isError ? (
          <p className="py-8 text-center text-sm text-[var(--assessment-error)]">
            {(activeQuery.error as Error).message || 'Failed to load bank items.'}
          </p>
        ) : tab === 'question' ? (
          questionRows.map((q) => {
            const checked = selectedQuestions.has(q.id);
            const alreadyAdded = alreadyAddedQuestionIds.has(q.id);
            const competencyTag = normalizeTags(q as Record<string, unknown>, [
              'competencyTags',
              'competency_tags',
              'topicTags',
              'topic_tags',
            ])[0];
            return (
              <label
                key={q.id}
                className={`block rounded-xl border p-4 transition-all ${
                  alreadyAdded
                    ? 'cursor-default border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)]/40 opacity-90'
                    : `cursor-pointer ${
                        checked
                          ? 'border-2 border-[var(--assessment-primary)] bg-[var(--assessment-primary-fixed)]/10'
                          : 'border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] hover:border-[var(--assessment-primary)] hover:shadow-md'
                      }`
                }`}
              >
                <div className="flex items-start gap-4">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={alreadyAdded}
                    onChange={() => {
                      if (alreadyAdded) return;
                      setSelectedQuestions((prev) => {
                        const next = new Set(prev);
                        if (next.has(q.id)) next.delete(q.id);
                        else next.add(q.id);
                        return next;
                      });
                    }}
                    className="mt-1 h-5 w-5 rounded text-[var(--assessment-primary)] focus:ring-[var(--assessment-primary)] disabled:opacity-70"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm font-semibold ${checked && !alreadyAdded ? 'text-[var(--assessment-primary)]' : ''}`}
                      >
                        {questionLabel(q)}
                      </p>
                      {alreadyAdded ? (
                        <span className="shrink-0 rounded-full bg-[var(--assessment-tertiary-container)]/20 px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--assessment-tertiary)]">
                          In round
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {competencyTag ? (
                        <span className="rounded bg-[var(--codevox-secondary-fixed)] px-1.5 font-mono text-[10px] uppercase text-[var(--codevox-on-secondary-fixed)]">
                          {String(competencyTag)}
                        </span>
                      ) : null}
                      <span className="rounded bg-[var(--assessment-surface-container-high)] px-1.5 font-mono text-[10px] uppercase text-[var(--assessment-on-surface-variant)]">
                        {q.difficulty || 'MEDIUM'}
                      </span>
                    </div>
                  </div>
                </div>
              </label>
            );
          })
        ) : (
          problemRows.map((p) => {
            const checked = selectedProblems.has(p.id);
            const alreadyAdded = alreadyAddedProblemIds.has(p.id);
            const topicTag = normalizeTags(p as Record<string, unknown>, ['topicTags', 'topic_tags'])[0];
            return (
              <label
                key={p.id}
                className={`block rounded-xl border p-4 transition-all ${
                  alreadyAdded
                    ? 'cursor-default border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)]/40 opacity-90'
                    : `cursor-pointer ${
                        checked
                          ? 'border-2 border-[var(--assessment-primary)] bg-[var(--assessment-primary-fixed)]/10'
                          : 'border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] hover:border-[var(--assessment-primary)] hover:shadow-md'
                      }`
                }`}
              >
                <div className="flex items-start gap-4">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={alreadyAdded}
                    onChange={() => {
                      if (alreadyAdded) return;
                      setSelectedProblems((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      });
                    }}
                    className="mt-1 h-5 w-5 rounded text-[var(--assessment-primary)] focus:ring-[var(--assessment-primary)] disabled:opacity-70"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p
                        className={`text-sm font-semibold ${checked && !alreadyAdded ? 'text-[var(--assessment-primary)]' : ''}`}
                      >
                        {p.title?.trim() || 'Untitled problem'}
                      </p>
                      {alreadyAdded ? (
                        <span className="shrink-0 rounded-full bg-[var(--assessment-tertiary-container)]/20 px-2 py-0.5 text-[9px] font-bold uppercase text-[var(--assessment-tertiary)]">
                          In round
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {topicTag ? (
                        <span className="rounded bg-[var(--codevox-secondary-fixed)] px-1.5 font-mono text-[10px] uppercase">
                          {String(topicTag)}
                        </span>
                      ) : null}
                      <span className="rounded bg-[var(--assessment-surface-container-high)] px-1.5 font-mono text-[10px] uppercase text-[var(--assessment-on-surface-variant)]">
                        {p.difficulty || 'MEDIUM'}
                      </span>
                    </div>
                  </div>
                </div>
              </label>
            );
          })
        )}
        {!activeQuery.isLoading && !activeQuery.isError && listRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-[var(--assessment-on-surface-variant)]">
            No {tab === 'question' ? 'interview questions' : 'coding challenges'} match the selected filters.
            {selectedCompetencies.length > 0
              ? ' Clear competency filter or pick different competencies.'
              : ' Create items in the question bank or problem bank first.'}
          </p>
        ) : null}
      </div>

      <div className="border-t border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-6">
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm text-[var(--assessment-on-surface-variant)]">Projected Competency Coverage</span>
            <span className="text-sm font-bold text-[var(--assessment-primary)]">
              {newSelectedCount > 0 ? `+${projectedBoost}%` : '-'}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--assessment-surface-container)]">
            <div
              className="h-full rounded-full bg-[var(--assessment-primary)] shadow-inner"
              style={{ width: `${projectedPct}%` }}
            />
          </div>
        </div>
        <button
          type="button"
          disabled={newSelectedCount === 0}
          onClick={addSelected}
          className="w-full rounded-xl bg-[var(--assessment-primary)] py-2.5 text-sm font-bold text-white shadow-md transition-all hover:opacity-90 active:scale-[0.98] disabled:opacity-40"
        >
          {addButtonLabel}
        </button>
      </div>
    </aside>
  );

  if (mode === 'inline') return panel;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close picker"
        className="absolute inset-0 bg-[var(--assessment-on-surface)]/30 backdrop-blur-[2px]"
        onClick={props.onClose}
      />
      {panel}
    </div>
  );
}
