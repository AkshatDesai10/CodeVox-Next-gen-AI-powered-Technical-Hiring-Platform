'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  assignCandidateAssessment,
  createPlatformAssessment,
  listAssessmentCandidates,
  listPlatformQuestions,
  mapQuestionToAssessment,
} from '@/lib/assessments-api';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type { CandidateDto, PlatformQuestionDto } from '@/types/assessments';

type WizardStep = 1 | 2 | 3;
type BankTab = 'ALL' | 'QUESTIONS' | 'PROBLEMS';

type SelectedQuestionItem = {
  question: PlatformQuestionDto;
  marks: number;
};

const POPULAR_ROLES = [
  'Backend Developer (Node.js / Python)',
  'Frontend Developer (React / Next.js)',
  'Full Stack Engineer',
  'Data Engineer / SQL Analyst',
  'DevOps & Cloud Engineer',
  'System Architect',
  'QA / Test Automation Engineer',
  'Mobile App Developer (React Native / Flutter)',
  'Other',
];

const DURATION_PRESETS = [30, 45, 60, 90, 120];

export function CreateAssessmentPage() {
  const router = useRouter();

  // --- Wizard Step State ---
  const [currentStep, setCurrentStep] = useState<WizardStep>(1);

  // --- Step 1: Assessment Details State ---
  const [title, setTitle] = useState('');
  const [role, setRole] = useState(POPULAR_ROLES[0]);
  const [customRole, setCustomRole] = useState('');
  const [description, setDescription] = useState('');
  const [instructions, setInstructions] = useState('');
  const [duration, setDuration] = useState(60);
  const [experienceLevel, setExperienceLevel] = useState<'JUNIOR' | 'MID' | 'SENIOR'>('MID');
  const [difficulty, setDifficulty] = useState<'EASY' | 'MEDIUM' | 'HARD'>('MEDIUM');

  // --- Step 2: Map Questions State ---
  const [selectedQuestions, setSelectedQuestions] = useState<SelectedQuestionItem[]>([]);
  const [bankTab, setBankTab] = useState<BankTab>('ALL');
  const [questionSearch, setQuestionSearch] = useState('');
  const [filterType, setFilterType] = useState('ALL');
  const [filterLanguage, setFilterLanguage] = useState('ALL');
  const [filterDifficulty, setFilterDifficulty] = useState('ALL');
  const [previewQuestion, setPreviewQuestion] = useState<PlatformQuestionDto | null>(null);

  // --- Step 3: Assign Candidates State ---
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<string[]>([]);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // --- Queries ---
  const questionsQuery = useQuery({
    queryKey: ['platform-questions'],
    queryFn: async () => (await listPlatformQuestions()).data,
  });

  const candidatesQuery = useQuery({
    queryKey: ['assessment-candidates'],
    queryFn: async () => (await listAssessmentCandidates()).data,
  });

  const allQuestions = useMemo(() => questionsQuery.data ?? [], [questionsQuery.data]);
  const allCandidates = useMemo(() => candidatesQuery.data ?? [], [candidatesQuery.data]);

  // --- Filtered Questions for Step 2 ---
  const filteredQuestions = useMemo(() => {
    return allQuestions.filter((q) => {
      // Bank Tab Filter
      if (bankTab === 'QUESTIONS') {
        if (q.questionType?.toUpperCase() === 'CODING') return false;
      } else if (bankTab === 'PROBLEMS') {
        if (q.questionType?.toUpperCase() !== 'CODING' && q.questionType?.toUpperCase() !== 'SQL') return false;
      }

      // Type Filter
      if (filterType !== 'ALL' && q.questionType?.toUpperCase() !== filterType) {
        return false;
      }

      // Language Filter
      if (filterLanguage !== 'ALL' && q.language?.toUpperCase() !== filterLanguage) {
        return false;
      }

      // Difficulty Filter
      if (filterDifficulty !== 'ALL' && q.difficulty?.toUpperCase() !== filterDifficulty) {
        return false;
      }

      // Search Filter
      if (questionSearch.trim()) {
        const query = questionSearch.toLowerCase();
        const matchesTitle = q.title?.toLowerCase().includes(query);
        const matchesDesc = q.description?.toLowerCase().includes(query);
        if (!matchesTitle && !matchesDesc) return false;
      }

      return true;
    });
  }, [allQuestions, bankTab, filterType, filterLanguage, filterDifficulty, questionSearch]);

  // --- Filtered Candidates for Step 3 ---
  const filteredCandidates = useMemo(() => {
    if (!candidateSearch.trim()) return allCandidates;
    const query = candidateSearch.toLowerCase();
    return allCandidates.filter((c) => {
      const fullName = `${c.firstName ?? ''} ${c.lastName ?? ''}`.toLowerCase();
      const email = (c.email ?? '').toLowerCase();
      const company = (c.currentCompany ?? '').toLowerCase();
      return fullName.includes(query) || email.includes(query) || company.includes(query);
    });
  }, [allCandidates, candidateSearch]);

  // --- Calculated Stats ---
  const totalCalculatedMarks = useMemo(() => {
    return selectedQuestions.reduce((sum, item) => sum + (Number(item.marks) || 0), 0);
  }, [selectedQuestions]);

  const questionsBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of selectedQuestions) {
      const type = item.question.questionType?.toUpperCase() || 'OTHER';
      counts[type] = (counts[type] || 0) + 1;
    }
    return counts;
  }, [selectedQuestions]);

  // --- Question Selection Actions ---
  const toggleQuestionSelection = (question: PlatformQuestionDto) => {
    setSelectedQuestions((prev) => {
      const exists = prev.some((item) => item.question.id === question.id);
      if (exists) {
        return prev.filter((item) => item.question.id !== question.id);
      }
      return [...prev, { question, marks: question.marks || 20 }];
    });
  };

  const updateQuestionMarks = (questionId: string, marks: number) => {
    setSelectedQuestions((prev) =>
      prev.map((item) => (item.question.id === questionId ? { ...item, marks: Math.max(1, marks) } : item)),
    );
  };

  const moveQuestion = (index: number, direction: 'up' | 'down') => {
    setSelectedQuestions((prev) => {
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[targetIndex];
      copy[targetIndex] = temp;
      return copy;
    });
  };

  // --- Candidate Selection Actions ---
  const toggleCandidateSelection = (candidateId: string) => {
    setSelectedCandidateIds((prev) =>
      prev.includes(candidateId) ? prev.filter((id) => id !== candidateId) : [...prev, candidateId],
    );
  };

  const selectAllFilteredCandidates = () => {
    const ids = filteredCandidates.map((c) => c.id);
    setSelectedCandidateIds((prev) => Array.from(new Set([...prev, ...ids])));
  };

  const deselectAllFilteredCandidates = () => {
    const filterIds = new Set(filteredCandidates.map((c) => c.id));
    setSelectedCandidateIds((prev) => prev.filter((id) => !filterIds.has(id)));
  };

  // --- Atomic Assessment Creation Mutation ---
  const createAssessmentMutation = useMutation({
    mutationFn: async () => {
      const finalRole = role === 'Other' ? customRole.trim() || 'Software Engineer' : role;

      // 1. Create Assessment Header
      setStatusMessage('Creating assessment record...');
      const createRes = await createPlatformAssessment({
        title: title.trim(),
        description: `${description.trim()}\n\n[Target Role: ${finalRole}]\n\nCandidate Instructions:\n${instructions.trim()}`,
        duration_minutes: duration,
        question_source: 'STATIC',
        evaluation_mode: 'HYBRID',
        experience_level: experienceLevel,
        difficulty: difficulty,
        target_skills: [finalRole],
      });

      const assessmentId = String(
        (createRes.data as { id?: string | number })?.id ||
          (createRes as unknown as { id?: string | number })?.id,
      );

      if (!assessmentId) throw new Error('Failed to retrieve created assessment ID');

      // 2. Map All Selected Questions
      setStatusMessage(`Mapping ${selectedQuestions.length} questions...`);
      for (let i = 0; i < selectedQuestions.length; i++) {
        const item = selectedQuestions[i];
        await mapQuestionToAssessment(assessmentId, {
          question_id: item.question.id,
          marks: Number(item.marks) || 20,
          sort_order: i + 1,
        });
      }

      // 3. Assign All Selected Candidates
      setStatusMessage(`Assigning ${selectedCandidateIds.length} candidate(s)...`);
      for (const candidateId of selectedCandidateIds) {
        await assignCandidateAssessment({
          candidate_id: candidateId,
          assessment_id: assessmentId,
        });
      }

      return { assessmentId };
    },
    onSuccess: () => {
      router.push('/assessments/list');
    },
    onError: (err) => {
      setStatusMessage(null);
      alert(err instanceof Error ? err.message : 'Failed to create assessment');
    },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 pb-16">
      {/* Top Header & Breadcrumb */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--assessment-outline-variant)]/60 pb-5">
        <div>
          <nav className="mb-1 flex items-center gap-1 text-xs font-semibold text-[var(--assessment-outline)]">
            <Link href="/assessments/list" className="hover:underline">
              Assessments
            </Link>
            <AssessmentMaterialIcon name="chevron_right" size={14} />
            <span className="text-[var(--assessment-primary)]">New Assessment</span>
          </nav>
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--assessment-on-surface)]">
            Create Assessment
          </h1>
        </div>

        <Link
          href="/assessments/list"
          className="rounded-xl border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold text-[var(--assessment-outline)] transition hover:bg-[var(--assessment-surface-container)]"
        >
          Cancel
        </Link>
      </div>

      {/* Stepper Navigation Wizard Bar */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { step: 1, label: '1. Assessment Details', icon: 'description', sub: 'Role, duration & instructions' },
          {
            step: 2,
            label: '2. Map Questions & Problems',
            icon: 'checklist',
            sub: `${selectedQuestions.length} selected (${totalCalculatedMarks} marks)`,
          },
          {
            step: 3,
            label: '3. Assign & Publish',
            icon: 'group_add',
            sub: `${selectedCandidateIds.length} candidate(s) selected`,
          },
        ].map((s) => {
          const isCurrent = currentStep === s.step;
          const isPassed = currentStep > s.step;

          return (
            <button
              key={s.step}
              type="button"
              onClick={() => {
                if (isPassed || (s.step === 2 && title.trim()) || (s.step === 3 && title.trim() && selectedQuestions.length > 0)) {
                  setCurrentStep(s.step as WizardStep);
                }
              }}
              className={`flex items-center gap-3 rounded-2xl border p-4 text-left transition-all ${
                isCurrent
                  ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5 ring-2 ring-[var(--assessment-primary)]/20'
                  : isPassed
                  ? 'border-emerald-500/40 bg-emerald-50/50 hover:bg-emerald-50'
                  : 'border-[var(--assessment-outline-variant)]/60 bg-[var(--assessment-surface-container-low)] opacity-70'
              }`}
            >
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-bold transition-colors ${
                  isCurrent
                    ? 'bg-[var(--assessment-primary)] text-white shadow-sm'
                    : isPassed
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[var(--assessment-surface-container-high)] text-[var(--assessment-on-surface-variant)]'
                }`}
              >
                {isPassed ? (
                  <AssessmentMaterialIcon name="check" size={20} />
                ) : (
                  <AssessmentMaterialIcon name={s.icon} size={20} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={`text-sm font-bold truncate ${
                    isCurrent ? 'text-[var(--assessment-primary)]' : 'text-[var(--assessment-on-surface)]'
                  }`}
                >
                  {s.label}
                </p>
                <p className="text-xs text-[var(--assessment-on-surface-variant)] truncate">{s.sub}</p>
              </div>
            </button>
          );
        })}
      </div>

      {/* ========================================================================= */}
      {/* STEP 1: ASSESSMENT DETAILS */}
      {/* ========================================================================= */}
      {currentStep === 1 && (
        <div className="assessment-card space-y-6 p-6 sm:p-8">
          <div className="border-b border-[var(--assessment-outline-variant)]/40 pb-4">
            <h2 className="text-xl font-bold text-[var(--assessment-on-surface)]">Step 1: Assessment Details</h2>
            <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
              Specify the core role parameters, duration, and instructions for candidates.
            </p>
          </div>

          <div className="space-y-6">
            {/* Title */}
            <label className="block space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                Assessment Title <span className="text-red-500">*</span>
              </span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Senior Backend Engineer - Node.js & System Architecture"
                className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-3 text-base font-medium shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
              />
            </label>

            {/* Target Role Selector */}
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                  Target Engineering Role <span className="text-red-500">*</span>
                </span>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                  className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3.5 py-2.5 text-sm font-medium shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
                >
                  {POPULAR_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>

              {role === 'Other' ? (
                <label className="block space-y-1.5">
                  <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                    Custom Role Name
                  </span>
                  <input
                    value={customRole}
                    onChange={(e) => setCustomRole(e.target.value)}
                    placeholder="e.g. Embedded Firmware Engineer"
                    className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3.5 py-2.5 text-sm font-medium shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
                  />
                </label>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                      Experience Level
                    </span>
                    <select
                      value={experienceLevel}
                      onChange={(e) => setExperienceLevel(e.target.value as 'JUNIOR' | 'MID' | 'SENIOR')}
                      className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2.5 text-sm font-medium shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
                    >
                      <option value="JUNIOR">Junior (0-2 yrs)</option>
                      <option value="MID">Mid Level (2-5 yrs)</option>
                      <option value="SENIOR">Senior (5+ yrs)</option>
                    </select>
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                      Difficulty
                    </span>
                    <select
                      value={difficulty}
                      onChange={(e) => setDifficulty(e.target.value as 'EASY' | 'MEDIUM' | 'HARD')}
                      className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2.5 text-sm font-medium shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
                    >
                      <option value="EASY">Easy</option>
                      <option value="MEDIUM">Medium</option>
                      <option value="HARD">Hard</option>
                    </select>
                  </label>
                </div>
              )}
            </div>

            {/* Duration Section */}
            <div className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                Duration (Minutes)
              </span>
              <div className="flex flex-wrap items-center gap-3">
                {DURATION_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setDuration(preset)}
                    className={`rounded-xl border px-4 py-2 text-sm font-bold transition ${
                      duration === preset
                        ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)] text-white shadow-sm'
                        : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)] hover:border-[var(--assessment-primary)]/50'
                    }`}
                  >
                    {preset} mins
                  </button>
                ))}
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={15}
                    max={360}
                    value={duration}
                    onChange={(e) => setDuration(Math.max(1, Number(e.target.value)))}
                    className="w-24 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm font-bold text-center shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
                  />
                  <span className="text-xs font-semibold text-[var(--assessment-outline)]">custom min</span>
                </div>
              </div>
            </div>

            {/* Role Description */}
            <label className="block space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                Role Description & Competencies (Optional)
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Key responsibilities, skills tested, and evaluation objectives for this hiring round..."
                className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-3 text-sm shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
              />
            </label>

            {/* Candidate Instructions */}
            <label className="block space-y-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                Candidate Instructions (Shown before starting test)
              </span>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                rows={3}
                placeholder="e.g. Ensure you have a quiet environment. Coding challenges will be evaluated automatically against visible and hidden test cases."
                className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-3 text-sm shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
              />
            </label>
          </div>

          {/* Navigation Action */}
          <div className="flex justify-end border-t border-[var(--assessment-outline-variant)]/40 pt-5">
            <button
              type="button"
              disabled={!title.trim() || duration <= 0}
              onClick={() => setCurrentStep(2)}
              className="inline-flex items-center gap-2 rounded-xl bg-[var(--assessment-primary)] px-6 py-3 text-sm font-bold text-white shadow-md transition hover:opacity-95 disabled:opacity-50"
            >
              <span>Next: Map Questions & Problems</span>
              <AssessmentMaterialIcon name="arrow_forward" size={18} />
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 2: MAP QUESTIONS & PROBLEMS */}
      {/* ========================================================================= */}
      {currentStep === 2 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: Question Explorer & Bank Browser (7 Cols) */}
          <div className="space-y-4 lg:col-span-7">
            <div className="assessment-card space-y-4 p-5">
              {/* Bank Switcher Tabs */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--assessment-outline-variant)]/40 pb-3">
                <div className="inline-flex rounded-xl bg-[var(--assessment-surface-container-low)] p-1">
                  {[
                    { key: 'ALL', label: 'All Items' },
                    { key: 'QUESTIONS', label: 'Question Bank (MCQ/Design)' },
                    { key: 'PROBLEMS', label: 'Problem Bank (Coding/SQL)' },
                  ].map((tab) => (
                    <button
                      key={tab.key}
                      type="button"
                      onClick={() => setBankTab(tab.key as BankTab)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                        bankTab === tab.key
                          ? 'bg-[var(--assessment-surface-container)] text-[var(--assessment-primary)] shadow-sm'
                          : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <Link
                  href="/assessments/questions/create"
                  target="_blank"
                  className="inline-flex items-center gap-1 rounded-lg border border-[var(--assessment-primary)]/40 bg-[var(--assessment-primary)]/5 px-2.5 py-1 text-xs font-bold text-[var(--assessment-primary)] hover:bg-[var(--assessment-primary)]/10"
                >
                  <AssessmentMaterialIcon name="add" size={14} />
                  <span>Create New Question</span>
                </Link>
              </div>

              {/* Search & Multi Filters */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="relative col-span-full">
                  <input
                    value={questionSearch}
                    onChange={(e) => setQuestionSearch(e.target.value)}
                    placeholder="Search by topic, skill or keywords..."
                    className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] pl-9 pr-4 py-2 text-xs font-medium focus:border-[var(--assessment-primary)] focus:outline-none"
                  />
                  <div className="pointer-events-none absolute left-3 top-2.5 text-[var(--assessment-outline)]">
                    <AssessmentMaterialIcon name="search" size={16} />
                  </div>
                </div>

                <select
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                  className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-2.5 py-1.5 text-xs font-medium"
                >
                  <option value="ALL">All Types</option>
                  <option value="MCQ">MCQ</option>
                  <option value="CODING">Coding Challenge</option>
                  <option value="SHORT_ANSWER">Technical Essay</option>
                  <option value="SYSTEM_DESIGN">System Design</option>
                  <option value="INTERVIEW">Interview</option>
                </select>

                <select
                  value={filterLanguage}
                  onChange={(e) => setFilterLanguage(e.target.value)}
                  className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-2.5 py-1.5 text-xs font-medium"
                >
                  <option value="ALL">All Languages</option>
                  <option value="PYTHON">Python</option>
                  <option value="SQL">SQL</option>
                  <option value="NODE">Node.js</option>
                  <option value="PHP">PHP</option>
                  <option value="TEXT">Text / Conceptual</option>
                </select>

                <select
                  value={filterDifficulty}
                  onChange={(e) => setFilterDifficulty(e.target.value)}
                  className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-2.5 py-1.5 text-xs font-medium"
                >
                  <option value="ALL">All Difficulties</option>
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
              </div>

              {/* Questions List */}
              <div className="max-h-[500px] space-y-2.5 overflow-y-auto pr-1">
                {questionsQuery.isLoading ? (
                  <div className="py-8 text-center text-xs text-[var(--assessment-outline)]">
                    Loading question bank...
                  </div>
                ) : filteredQuestions.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center text-xs text-[var(--assessment-outline)]">
                    No questions found matching the criteria.
                  </div>
                ) : (
                  filteredQuestions.map((q) => {
                    const isSelected = selectedQuestions.some((item) => item.question.id === q.id);

                    return (
                      <div
                        key={q.id}
                        className={`flex items-start justify-between gap-3 rounded-xl border p-3.5 transition-all ${
                          isSelected
                            ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5 shadow-sm'
                            : 'border-[var(--assessment-outline-variant)]/60 bg-[var(--assessment-surface-container)] hover:border-[var(--assessment-primary)]/40'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span
                              className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                q.questionType === 'CODING'
                                  ? 'bg-blue-100 text-blue-800'
                                  : q.questionType === 'MCQ'
                                  ? 'bg-[var(--color-primary-container)] text-[var(--color-on-primary-container)]'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {q.questionType}
                            </span>
                            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                              {q.language || 'TEXT'}
                            </span>
                            <span className="text-[10px] font-semibold text-[var(--assessment-outline)]">
                              • {q.difficulty}
                            </span>
                          </div>

                          <h4 className="mt-1 text-sm font-bold text-[var(--assessment-on-surface)] truncate">
                            {q.title}
                          </h4>
                          <p className="mt-0.5 line-clamp-1 text-xs text-[var(--assessment-on-surface-variant)]">
                            {q.description}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPreviewQuestion(q)}
                            className="rounded-lg p-1.5 text-[var(--assessment-outline)] hover:bg-[var(--assessment-surface-container)] hover:text-[var(--assessment-on-surface)]"
                            title="Preview question"
                          >
                            <AssessmentMaterialIcon name="visibility" size={16} />
                          </button>

                          <button
                            type="button"
                            onClick={() => toggleQuestionSelection(q)}
                            className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                              isSelected
                                ? 'bg-red-50 text-red-600 hover:bg-red-100'
                                : 'bg-[var(--assessment-primary)] text-white hover:opacity-90'
                            }`}
                          >
                            {isSelected ? 'Remove' : '+ Add'}
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Selected Assessment Questions Drawer (5 Cols) */}
          <div className="space-y-4 lg:col-span-5">
            <div className="assessment-card flex h-full flex-col p-5">
              <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)]/40 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-[var(--assessment-on-surface)]">Mapped Questions</h3>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                    {selectedQuestions.length} item(s) selected
                  </p>
                </div>
                <div className="rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 border border-emerald-200">
                  Total Marks: {totalCalculatedMarks}
                </div>
              </div>

              {/* Selected List */}
              <div className="mt-4 flex-1 space-y-2 overflow-y-auto max-h-[440px] pr-1">
                {selectedQuestions.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-8 text-center text-xs text-[var(--assessment-outline)]">
                    <AssessmentMaterialIcon name="playlist_add" size={28} className="mx-auto mb-2 text-gray-400" />
                    No questions added yet. Click &quot;+ Add&quot; from the question explorer on the left.
                  </div>
                ) : (
                  selectedQuestions.map((item, index) => (
                    <div
                      key={item.question.id}
                      className="rounded-xl border border-[var(--assessment-outline-variant)]/80 bg-[var(--assessment-surface-container)] p-3 shadow-xs space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--assessment-surface-container)] text-[10px] font-bold text-[var(--assessment-primary)]">
                            {index + 1}
                          </span>
                          <p className="text-xs font-bold text-[var(--assessment-on-surface)] truncate">
                            {item.question.title}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleQuestionSelection(item.question)}
                          className="text-gray-400 hover:text-red-600"
                        >
                          <AssessmentMaterialIcon name="close" size={14} />
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-gray-100">
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => moveQuestion(index, 'up')}
                            className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          >
                            <AssessmentMaterialIcon name="arrow_upward" size={14} />
                          </button>
                          <button
                            type="button"
                            disabled={index === selectedQuestions.length - 1}
                            onClick={() => moveQuestion(index, 'down')}
                            className="rounded p-1 text-gray-500 hover:bg-gray-100 disabled:opacity-30"
                          >
                            <AssessmentMaterialIcon name="arrow_downward" size={14} />
                          </button>
                          <span className="text-[10px] text-gray-400">Order #{index + 1}</span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-semibold text-gray-500">Marks:</span>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={item.marks}
                            onChange={(e) => updateQuestionMarks(item.question.id, Number(e.target.value))}
                            className="w-14 rounded-lg border border-gray-300 px-2 py-0.5 text-xs font-bold text-center"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Bottom Wizard Actions */}
              <div className="mt-5 flex items-center justify-between border-t border-[var(--assessment-outline-variant)]/40 pt-4">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="rounded-xl border border-[var(--assessment-outline-variant)] px-4 py-2.5 text-xs font-bold text-[var(--assessment-outline)]"
                >
                  ← Back to Details
                </button>
                <button
                  type="button"
                  disabled={selectedQuestions.length === 0}
                  onClick={() => setCurrentStep(3)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--assessment-primary)] px-5 py-2.5 text-xs font-bold text-white shadow-sm disabled:opacity-50"
                >
                  <span>Next: Assign Candidates</span>
                  <AssessmentMaterialIcon name="arrow_forward" size={16} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STEP 3: ASSIGN CANDIDATES & FINAL REVIEW */}
      {/* ========================================================================= */}
      {currentStep === 3 && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* Left Column: Candidate Multi-Select (7 Cols) */}
          <div className="space-y-4 lg:col-span-7">
            <div className="assessment-card space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--assessment-outline-variant)]/40 pb-3">
                <div>
                  <h3 className="text-base font-bold text-[var(--assessment-on-surface)]">Select Candidates</h3>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                    Choose candidates to assign this assessment attempt.
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={selectAllFilteredCandidates}
                    className="rounded-lg border px-2.5 py-1 text-xs font-semibold hover:bg-gray-50"
                  >
                    Select All
                  </button>
                  <button
                    type="button"
                    onClick={deselectAllFilteredCandidates}
                    className="rounded-lg border px-2.5 py-1 text-xs font-semibold hover:bg-gray-50"
                  >
                    Clear
                  </button>
                </div>
              </div>

              {/* Candidate Search */}
              <div className="relative">
                <input
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  placeholder="Search candidate by name, email or company..."
                  className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] pl-9 pr-4 py-2.5 text-xs font-medium focus:border-[var(--assessment-primary)] focus:outline-none"
                />
                <div className="pointer-events-none absolute left-3 top-3 text-[var(--assessment-outline)]">
                  <AssessmentMaterialIcon name="search" size={16} />
                </div>
              </div>

              {/* Candidate Checkbox List */}
              <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {candidatesQuery.isLoading ? (
                  <div className="py-8 text-center text-xs text-[var(--assessment-outline)]">
                    Loading candidates...
                  </div>
                ) : filteredCandidates.length === 0 ? (
                  <div className="rounded-xl border border-dashed p-6 text-center text-xs text-[var(--assessment-outline)]">
                    No candidates found.
                  </div>
                ) : (
                  filteredCandidates.map((c: CandidateDto) => {
                    const isChecked = selectedCandidateIds.includes(c.id);

                    return (
                      <label
                        key={c.id}
                        className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 transition ${
                          isChecked
                            ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5 shadow-xs'
                            : 'border-[var(--assessment-outline-variant)]/60 bg-[var(--assessment-surface-container)] hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleCandidateSelection(c.id)}
                            className="h-4 w-4 rounded text-[var(--assessment-primary)] focus:ring-[var(--assessment-primary)]"
                          />
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--assessment-surface-container)] text-xs font-bold text-[var(--assessment-primary)]">
                            {c.firstName?.[0] || 'C'}
                            {c.lastName?.[0] || ''}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[var(--assessment-on-surface)] truncate">
                              {c.firstName} {c.lastName}
                            </p>
                            <p className="text-[11px] text-[var(--assessment-on-surface-variant)] truncate">{c.email}</p>
                          </div>
                        </div>

                        <div className="text-right">
                          <span className="text-[10px] font-semibold text-gray-500">
                            {c.currentCompany ? `${c.currentCompany} • ` : ''}
                            {c.experienceYears ? `${c.experienceYears} yrs` : 'Candidate'}
                          </span>
                        </div>
                      </label>
                    );
                  })
                )}
              </div>
            </div>
          </div>

          {/* Right Column: Final Assessment Review Card (5 Cols) */}
          <div className="space-y-4 lg:col-span-5">
            <div className="assessment-card space-y-5 p-6">
              <div className="border-b border-[var(--assessment-outline-variant)]/40 pb-3">
                <h3 className="text-lg font-bold text-[var(--assessment-on-surface)]">Assessment Summary</h3>
                <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                  Review specifications before publishing.
                </p>
              </div>

              {/* Summary Specs */}
              <div className="space-y-3 text-xs">
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-500">Title:</span>
                  <span className="font-bold text-[var(--assessment-on-surface)] text-right max-w-[200px] truncate">
                    {title}
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-500">Target Role:</span>
                  <span className="font-bold text-[var(--assessment-on-surface)]">
                    {role === 'Other' ? customRole : role}
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-500">Duration:</span>
                  <span className="font-bold text-[var(--assessment-on-surface)]">{duration} Minutes</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-500">Difficulty & Level:</span>
                  <span className="font-bold text-[var(--assessment-on-surface)]">
                    {difficulty} • {experienceLevel}
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-500">Total Questions:</span>
                  <span className="font-bold text-[var(--assessment-primary)]">
                    {selectedQuestions.length} Question(s)
                  </span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-500">Total Marks:</span>
                  <span className="font-bold text-emerald-700 text-sm">{totalCalculatedMarks} Marks</span>
                </div>
                <div className="flex justify-between border-b pb-2">
                  <span className="text-gray-500">Assigned Candidates:</span>
                  <span className="font-bold text-[var(--assessment-on-surface)]">
                    {selectedCandidateIds.length} candidate(s)
                  </span>
                </div>
              </div>

              {/* Questions Type Breakdown */}
              <div className="rounded-xl bg-[var(--assessment-surface-container-low)] p-3 text-xs">
                <p className="font-bold text-[var(--assessment-on-surface-variant)] uppercase tracking-wider text-[10px] mb-2">
                  Question Type Breakdown
                </p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(questionsBreakdown).map(([type, count]) => (
                    <span
                      key={type}
                      className="inline-flex items-center gap-1 rounded-md bg-[var(--assessment-surface-container)] px-2 py-1 text-[11px] font-bold border"
                    >
                      <span>{type}:</span>
                      <span className="text-[var(--assessment-primary)]">{count}</span>
                    </span>
                  ))}
                </div>
              </div>

              {statusMessage ? (
                <div className="rounded-xl bg-blue-50 p-3 text-xs font-semibold text-blue-800 animate-pulse text-center">
                  {statusMessage}
                </div>
              ) : null}

              {/* Wizard Bottom Actions */}
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="rounded-xl border border-[var(--assessment-outline-variant)] px-4 py-2.5 text-xs font-bold text-[var(--assessment-outline)]"
                >
                  ← Back
                </button>
                <button
                  type="button"
                  disabled={
                    selectedCandidateIds.length === 0 ||
                    selectedQuestions.length === 0 ||
                    createAssessmentMutation.isPending
                  }
                  onClick={() => createAssessmentMutation.mutate()}
                  className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-bold text-white shadow-md transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  {createAssessmentMutation.isPending ? 'Publishing...' : 'Create Assessment 🚀'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Preview Modal for Questions */}
      {previewQuestion ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl rounded-2xl bg-[var(--assessment-surface-container)] p-6 shadow-2xl space-y-4 text-left max-h-[85vh] overflow-y-auto">
            <div className="flex items-start justify-between gap-3 border-b pb-3">
              <div>
                <span className="rounded-md bg-[var(--color-primary-container)] px-2 py-0.5 text-[10px] font-bold text-[var(--color-on-primary-container)]">
                  {previewQuestion.questionType}
                </span>
                <h3 className="mt-1 text-lg font-bold text-gray-900">{previewQuestion.title}</h3>
                <p className="text-xs text-gray-500">
                  {previewQuestion.language || 'TEXT'} • {previewQuestion.difficulty} • {previewQuestion.marks || 20}{' '}
                  marks
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewQuestion(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <AssessmentMaterialIcon name="close" size={20} />
              </button>
            </div>

            <div className="space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-500">Problem Statement</span>
              <p className="whitespace-pre-wrap text-sm text-gray-700 rounded-xl bg-gray-50 p-4 border font-mono">
                {previewQuestion.description}
              </p>
            </div>

            <div className="flex justify-end pt-3 border-t">
              <button
                type="button"
                onClick={() => {
                  toggleQuestionSelection(previewQuestion);
                  setPreviewQuestion(null);
                }}
                className="rounded-xl bg-[var(--assessment-primary)] px-5 py-2 text-xs font-bold text-white shadow-sm"
              >
                {selectedQuestions.some((item) => item.question.id === previewQuestion.id)
                  ? 'Remove from Assessment'
                  : 'Add to Assessment'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
