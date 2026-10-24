'use client';

import { useMutation } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createPlatformQuestion, generatePlatformQuestion, savePlatformGeneratedQuestion } from '@/lib/assessments-api';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type { GeneratedQuestionDto } from '@/types/assessments';

type TabMode = 'manual' | 'ai';
type McqDraft = { label: string; text: string; is_correct: boolean };

const DEFAULT_MCQ: McqDraft[] = [
  { label: 'A', text: '', is_correct: true },
  { label: 'B', text: '', is_correct: false },
  { label: 'C', text: '', is_correct: false },
  { label: 'D', text: '', is_correct: false },
];

function formatGeneratedDescription(generated: GeneratedQuestionDto) {
  const parts = [generated.problemStatement];
  if (generated.requirements?.length) {
    parts.push('', 'Requirements:', ...generated.requirements.map((r) => `- ${r}`));
  }
  if (generated.evaluationCriteria?.length) {
    parts.push('', 'Evaluation criteria:', ...generated.evaluationCriteria.map((r) => `- ${r}`));
  }
  return parts.join('\n');
}

function applyGeneratedToForm(
  generated: GeneratedQuestionDto,
  setters: {
    setTitle: (v: string) => void;
    setDescription: (v: string) => void;
    setQuestionType: (v: string) => void;
    setLanguage: (v: string) => void;
    setMarks: (v: number) => void;
    setDifficulty: (v: string) => void;
    setMcqOptions: (v: McqDraft[]) => void;
  },
) {
  setters.setTitle(generated.title ?? '');
  setters.setDescription(formatGeneratedDescription(generated));
  setters.setQuestionType((generated.questionType ?? 'MCQ').toUpperCase());
  setters.setLanguage((generated.language ?? 'TEXT').toUpperCase());
  setters.setMarks(generated.marks ?? 20);
  setters.setDifficulty((generated.difficulty ?? 'MEDIUM').toUpperCase());
  if (generated.options?.length) {
    setters.setMcqOptions(
      generated.options.map((opt) => ({
        label: opt.label,
        text: opt.text,
        is_correct: Boolean(opt.isCorrect ?? opt.is_correct),
      })),
    );
  }
}

export function CreateQuestionPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabMode>('manual');
  const [title, setTitle] = useState('');
  const [experienceLevel, setExperienceLevel] = useState('MID');
  const [description, setDescription] = useState('');
  const [questionType, setQuestionType] = useState('MCQ');
  const [language, setLanguage] = useState('PYTHON');
  const [difficulty, setDifficulty] = useState('MEDIUM');
  const [marks, setMarks] = useState(20);
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState('');
  const [mcqOptions, setMcqOptions] = useState<McqDraft[]>(DEFAULT_MCQ);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiPreview, setAiPreview] = useState<GeneratedQuestionDto | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [role, setRole] = useState('Full Stack Engineer');
  const [customRole, setCustomRole] = useState('');

  const formSetters = {
    setTitle,
    setDescription,
    setQuestionType,
    setLanguage,
    setMarks,
    setDifficulty,
    setMcqOptions,
  };

  const createMutation = useMutation({
    mutationFn: () =>
      createPlatformQuestion({
        title,
        description,
        question_type: questionType,
        language,
        marks,
        difficulty,
        mcq_options: questionType === 'MCQ' ? mcqOptions : undefined,
        evaluation_config: aiPreview?.evaluationCriteria
          ? { criteria: aiPreview.evaluationCriteria, mode: 'AI' }
          : undefined,
        environment_config: aiPreview?.environmentTemplate ?? undefined,
      }),
    onSuccess: () => router.push('/assessments/question-bank'),
  });
  
const generateMutation = useMutation({
  mutationFn: () =>
    generatePlatformQuestion({
      prompt: `[Role: ${role === 'Other' ? customRole : role}] ${aiPrompt}`,
      difficulty,
      experience_level: experienceLevel,
      question_type: questionType,
    }),

    onSuccess: (res) => {
      const payload = res.data as GeneratedQuestionDto;
      setAiPreview(payload);
      setAiError(null);
    },
    onError: (err) => {
      setAiError(err instanceof Error ? err.message : 'Generation failed');
    },
  });

  const saveGeneratedMutation = useMutation({
    mutationFn: () => {
      if (!aiPreview) throw new Error('Generate a question before saving');
      return savePlatformGeneratedQuestion(aiPreview);
    },
    onSuccess: () => router.push('/assessments/question-bank'),
    onError: (err) => {
      setAiError(err instanceof Error ? err.message : 'Save failed');
    },
  });

  const updateMcq = (index: number, patch: Partial<McqDraft>) => {
    setMcqOptions((prev) =>
      prev.map((opt, i) => {
        if (i !== index) {
          return patch.is_correct ? { ...opt, is_correct: false } : opt;
        }
        return { ...opt, ...patch };
      }),
    );
  };

  const addSkill = () => {
    const value = skillInput.trim();
    if (!value || skills.includes(value)) return;
    setSkills((prev) => [...prev, value]);
    setSkillInput('');
  };

  const useInManualForm = () => {
    if (!aiPreview) return;
    applyGeneratedToForm(aiPreview, formSetters);
    setTab('manual');
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <nav className="mb-1 flex items-center gap-1 text-xs font-semibold text-[var(--assessment-outline)]">
            <span>Question Bank</span>
            <AssessmentMaterialIcon name="chevron_right" size={14} />
            <span className="text-[var(--assessment-primary)]">New Question</span>
          </nav>
          <h1 className="text-3xl font-bold text-[var(--assessment-on-surface)]">Create Question</h1>
        </div>
        <div className="flex gap-2">
          <Link
            href="/assessments/question-bank"
            className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold text-[var(--assessment-outline)] transition hover:bg-[var(--assessment-surface-container)]"
          >
            Cancel
          </Link>
          {tab === 'manual' ? (
            <button
              type="button"
              disabled={!title || createMutation.isPending}
              onClick={() => createMutation.mutate()}
              className="rounded-lg bg-[var(--assessment-primary)] px-5 py-2 text-sm font-bold text-white shadow-md disabled:opacity-60"
            >
              {createMutation.isPending ? 'Saving...' : 'Save Question'}
            </button>
          ) : (
            <button
              type="button"
              disabled={!aiPreview || saveGeneratedMutation.isPending}
              onClick={() => saveGeneratedMutation.mutate()}
              className="rounded-lg bg-[var(--assessment-primary)] px-5 py-2 text-sm font-bold text-white shadow-md disabled:opacity-60"
            >
              {saveGeneratedMutation.isPending ? 'Saving...' : 'Save to Bank'}
            </button>
          )}
        </div>
      </div>

      <div className="inline-flex rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-1">
        <button
          type="button"
          onClick={() => setTab('manual')}
          className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
            tab === 'manual'
              ? 'bg-[var(--assessment-surface-container-lowest)] text-[var(--assessment-primary)] shadow-sm'
              : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)]'
          }`}
        >
          Manual Entry
        </button>
        <button
          type="button"
          onClick={() => setTab('ai')}
          className={`inline-flex items-center gap-1 rounded-lg px-4 py-2 text-sm font-semibold transition ${
            tab === 'ai'
              ? 'bg-[var(--assessment-surface-container-lowest)] text-[var(--assessment-primary)] shadow-sm'
              : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)]'
          }`}
        >
          <AssessmentMaterialIcon name="auto_awesome" size={16} />
          AI Generator
        </button>
      </div>

      <div className="assessment-card p-6">
        {tab === 'manual' ? (
          <div className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="col-span-full block space-y-1">
                <span className="text-xs font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                  Question Title
                </span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Invert a Binary Tree"
                  className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2.5"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase">Type</span>
                <select
                  value={questionType}
                  onChange={(e) => setQuestionType(e.target.value)}
                  className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2.5"
                >
                  <option value="MCQ">Multiple Choice (MCQ)</option>
                  <option value="SHORT_ANSWER">Technical Essay</option>
                  <option value="SYSTEM_DESIGN">System Design</option>
                  <option value="INTERVIEW">Interview</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase">Difficulty</span>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2.5"
                >
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
              </label>
            </div>

            <div>
              <span className="text-xs font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                Skills Tags
              </span>
              <div className="mt-1 flex min-h-[48px] flex-wrap items-center gap-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-2">
                {skills.map((skill) => (
                  <span
                    key={skill}
                    className="inline-flex items-center gap-1 rounded-full border border-[var(--assessment-primary)]/10 bg-[var(--assessment-surface-container)] px-2 py-0.5 text-xs font-semibold text-[var(--assessment-primary)]"
                  >
                    {skill}
                    <button type="button" onClick={() => setSkills((s) => s.filter((x) => x !== skill))}>
                      <AssessmentMaterialIcon name="close" size={14} />
                    </button>
                  </span>
                ))}
                <input
                  value={skillInput}
                  onChange={(e) => setSkillInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addSkill();
                    }
                  }}
                  placeholder="Add skill..."
                  className="min-w-[120px] flex-1 border-none text-sm focus:ring-0"
                />
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                Problem Statement
              </span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={10}
                placeholder="Write the problem description here using Markdown..."
                className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2.5 font-mono text-sm"
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase">Language</span>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2.5"
                >
                  <option value="PYTHON">Python</option>
                  <option value="PHP">PHP</option>
                  <option value="NODE">Node</option>
                  <option value="SQL">SQL</option>
                  <option value="TEXT">Text</option>
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-bold uppercase">Marks</span>
                <input
                  type="number"
                  value={marks}
                  onChange={(e) => setMarks(Number(e.target.value))}
                  className="w-full rounded-lg border px-3 py-2.5"
                />
              </label>
            </div>

            {questionType === 'MCQ' ? (
              <section className="space-y-3 rounded-xl border bg-[var(--assessment-surface-container-low)] p-4">
                <h2 className="text-sm font-bold uppercase">Answer options</h2>
                {mcqOptions.map((opt, index) => (
                  <div key={opt.label} className="flex flex-wrap items-center gap-3">
                    <span className="w-6 font-bold text-[var(--assessment-primary)]">{opt.label}</span>
                    <input
                      value={opt.text}
                      onChange={(e) => updateMcq(index, { text: e.target.value })}
                      className="min-w-[200px] flex-1 rounded-lg border px-3 py-2 text-sm"
                    />
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="correct-mcq"
                        checked={opt.is_correct}
                        onChange={() => updateMcq(index, { is_correct: true })}
                      />
                      Correct
                    </label>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-[var(--assessment-primary-container)]/10">
              <AssessmentMaterialIcon
                name="auto_awesome"
                size={32}
                className={`text-[var(--assessment-primary)] ${generateMutation.isPending ? 'animate-pulse' : ''}`}
              />
            </div>
            <h2 className="text-xl font-semibold text-[var(--assessment-on-surface)]">AI Question Generator</h2>
            <p className="mt-2 max-w-md text-sm text-[var(--assessment-on-surface-variant)]">
              Describe the topic or paste a job description, and our AI will craft a high-quality assessment
              question with test cases.
            </p>
            {/* AI Generation Parameters Grid */}
            <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-4 text-left sm:grid-cols-3">
              {/* Question Type */}
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                  Question Type
                </span>
                <select
                  value={questionType}
                  onChange={(e) => setQuestionType(e.target.value)}
                  className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3.5 py-2.5 text-sm font-medium text-[var(--assessment-on-surface)] shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
                >
                  <option value="MCQ">Multiple Choice (MCQ)</option>
                  <option value="SHORT_ANSWER">Technical Essay</option>
                  <option value="SYSTEM_DESIGN">System Design</option>
                  <option value="INTERVIEW">Spoken Interview</option>
                </select>
              </label>

              {/* Difficulty */}
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                  Difficulty
                </span>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3.5 py-2.5 text-sm font-medium text-[var(--assessment-on-surface)] shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
                >
                  <option value="EASY">Easy</option>
                  <option value="MEDIUM">Medium</option>
                  <option value="HARD">Hard</option>
                </select>
              </label>

              {/* Experience Level */}
              <label className="block space-y-1.5">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                  Experience Level
                </span>
                <select
                  value={experienceLevel}
                  onChange={(e) => setExperienceLevel(e.target.value)}
                  className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3.5 py-2.5 text-sm font-medium text-[var(--assessment-on-surface)] shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
                >
                   <option value="JUNIOR">Junior / Fresher (0-2 yrs)</option>
    <option value="MID">Mid Level (2-5 yrs)</option>
    <option value="SENIOR">Senior / Lead (5+ yrs)</option>
                </select>
              </label>
            </div>

          {/* Engineering Role Section */}
<div className="mt-5 w-full max-w-2xl text-left">
  <label className="block space-y-1.5">
    <span className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
      Target Engineering Role
    </span>
    <div className="flex gap-2">
      <select
        value={role}
        onChange={(e) => setRole(e.target.value)}
        className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3.5 py-2.5 text-sm font-medium text-[var(--assessment-on-surface)] shadow-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
      >
        <option value="Backend Developer (Node.js / Python)">Backend Developer (Node.js / Python)</option>
        <option value="Frontend Developer (React / Next.js)">Frontend Developer (React / Next.js)</option>
        <option value="Full Stack Engineer">Full Stack Engineer</option>
        <option value="Data Engineer / SQL Analyst">Data Engineer / SQL Analyst</option>
        <option value="DevOps & Cloud Engineer">DevOps & Cloud Engineer</option>
        <option value="System Architect">System Architect</option>
        <option value="QA / Test Automation Engineer">QA / Test Automation Engineer</option>
      </select>
    </div>
  </label>
</div>

            <div className="relative mt-6 w-full max-w-2xl text-left">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                Problem Prompt & Instructions
              </span>
              <div className="relative">
                <textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  rows={5}
                  placeholder="e.g. Generate a medium-difficulty SQL question about complex joins and window functions for a Senior Data Engineer role..."
                  className="w-full rounded-xl border border-[var(--assessment-outline-variant)] p-4 pb-14 text-sm focus:border-[var(--assessment-primary)] focus:outline-none focus:ring-1 focus:ring-[var(--assessment-primary)]"
                />
                <button
                  type="button"
                  disabled={!aiPrompt.trim() || generateMutation.isPending}
                  onClick={() => generateMutation.mutate()}
                  className="absolute bottom-4 right-4 inline-flex items-center gap-1.5 rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-60"
                >
                  {generateMutation.isPending ? 'Generating...' : 'Generate'}
                  <AssessmentMaterialIcon name="bolt" size={18} className="text-white" />
                </button>
              </div>
            </div>

            {aiError ? <p className="mt-4 text-sm text-red-600">{aiError}</p> : null}

            {aiPreview ? (
              <div className="mt-8 w-full max-w-2xl rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-5 text-left">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                      Preview
                    </p>
                    <h3 className="mt-1 text-lg font-semibold text-[var(--assessment-on-surface)]">
                      {aiPreview.title}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                      {aiPreview.questionType ?? 'CODING'} | {aiPreview.difficulty ?? 'MEDIUM'} |{' '}
                      {aiPreview.marks ?? 20} marks
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={useInManualForm}
                    className="rounded-lg border border-[var(--assessment-primary)] px-3 py-1.5 text-xs font-bold text-[var(--assessment-primary)]"
                  >
                    Edit in Manual Form
                  </button>
                </div>
                <p className="mt-4 whitespace-pre-wrap text-sm text-[var(--assessment-on-surface-variant)]">
                  {formatGeneratedDescription(aiPreview)}
                </p>
                {aiPreview.options?.length ? (
                  <div className="mt-4 space-y-2 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4">
                    <p className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                      Answer Options
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {aiPreview.options.map((opt) => {
                        const isRight = Boolean(opt.isCorrect ?? opt.is_correct);
                        return (
                          <div
                            key={opt.label}
                            className={`flex items-start gap-2.5 rounded-lg border p-3 text-xs ${
                              isRight
                                ? 'border-emerald-500/40 bg-emerald-50 text-emerald-900'
                                : 'border-[var(--assessment-outline-variant)]/60 bg-[var(--assessment-surface-container-low)] text-[var(--assessment-on-surface)]'
                            }`}
                          >
                            <span className={`font-bold ${isRight ? 'text-emerald-700' : 'text-[var(--assessment-primary)]'}`}>
                              {opt.label}.
                            </span>
                            <span className="flex-1 font-medium">{opt.text}</span>
                            {isRight ? (
                              <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                                ✓ Correct
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}

                {aiPreview.testCases?.length ? (
                  <div className="mt-4 rounded-lg bg-[var(--assessment-surface-container)] p-3 text-xs">
                    <p className="font-bold text-[var(--assessment-on-surface)]">
                      {aiPreview.testCases.length} test case(s) included
                    </p>
                    <ul className="mt-2 space-y-1 font-mono text-[var(--assessment-on-surface-variant)]">
                      {aiPreview.testCases.slice(0, 3).map((tc, i) => {
                        const inputStr = typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input);
                        return (
                          <li key={i}>
                            #{i + 1}: in={inputStr.slice(0, 40)}
                            {inputStr.length > 40 ? '...' : ''}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {[
          {
            icon: 'lightbulb',
            title: 'Pro-Tip',
            text: 'Include edge cases in your problem statement to challenge top candidates.',
          },
          {
            icon: 'gavel',
            title: 'Fairness Check',
            text: 'Our system automatically checks questions for potential cultural bias.',
          },
          {
            icon: 'visibility',
            title: 'Candidate View',
            text: 'Preview how this looks in the assessment environment at any time.',
          },
        ].map((tip) => (
          <div
            key={tip.title}
            className="flex gap-3 rounded-xl border border-[var(--assessment-outline-variant)]/30 bg-[var(--assessment-surface-container)] p-4"
          >
            <AssessmentMaterialIcon name={tip.icon} size={22} className="text-[var(--assessment-primary)]" />
            <div>
              <h3 className="text-sm font-bold text-[var(--assessment-on-surface)]">{tip.title}</h3>
              <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">{tip.text}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
