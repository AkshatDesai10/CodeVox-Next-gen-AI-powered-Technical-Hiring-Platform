'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { ProjectAssessmentDownloads } from '@/modules/assessments/components/ProjectAssessmentDownloads';
import { SubmissionEvaluationProgress } from '@/modules/assessments/components/SubmissionEvaluationProgress';
import { withBasePath } from '@/lib/with-base-path';
import {
  getProjectInterviewSubmission,
  selectProjectInterviewProject,
  submitProjectInterviewRepo,
  submitProjectInterviewZip,
  type CandidateProjectChoice,
  type ProjectInterviewCandidateView,
} from '@/modules/assessments/lib/project-interview-api';

const DIFFICULTY_LABEL: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

const DIFFICULTY_CLASS: Record<string, string> = {
  beginner: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  intermediate: 'bg-sky-50 text-sky-700 border-sky-200',
  advanced: 'bg-rose-50 text-rose-700 border-rose-200',
};

const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?(\.git)?$/;

function DeadlineCountdown({ dueAt }: { dueAt: string }) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    const tick = () => {
      const ms = new Date(dueAt).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining('Expired');
        return;
      }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [dueAt]);
  return <span>{remaining}</span>;
}

function plainExcerpt(md: string, max = 190): string {
  const text = md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`~\-[\]()!|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function keyDeliverables(p: CandidateProjectChoice): string[] {
  const items = p.must_have_requirements.map((r) => r.text).filter(Boolean);
  if (p.deliverables.require_readme) items.push('README with project overview');
  if (p.deliverables.run_instructions_required) items.push('Clear run / setup instructions');
  if (p.deliverables.require_tests) items.push('Automated tests');
  if (p.deliverables.require_decisions_md) items.push('DECISIONS.md explaining trade-offs');
  return items;
}

function stackLabel(p: CandidateProjectChoice): string[] {
  if (p.tech_stack.mode === 'free_choice' || p.tech_stack.languages_frameworks.length === 0) {
    return ['Any stack'];
  }
  return p.tech_stack.languages_frameworks;
}

function Shell(props: { data: ProjectInterviewCandidateView; children: React.ReactNode; showDeadline?: boolean }) {
  const { data } = props;
  return (
    <div className="min-h-screen bg-[var(--assessment-surface)] font-sans">
      <div className="flex items-center justify-between border-b bg-[var(--assessment-surface-container)] px-8 py-4 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="text-xl font-bold tracking-tight text-[var(--assessment-primary)]">CodeVox</div>
          <div className="h-6 w-px bg-[var(--assessment-surface-container-high)]" />
          <div className="text-xs font-semibold uppercase tracking-wider text-[var(--assessment-outline-variant)]">
            Build &amp; Defend
          </div>
          {data.job_title ? (
            <div className="text-sm font-semibold text-[var(--assessment-on-surface-variant)]">{data.job_title}</div>
          ) : null}
        </div>
        {props.showDeadline && data.due_at ? (
          <div className="flex items-center gap-2 rounded-full border border-[var(--assessment-primary)]/20 bg-[var(--assessment-surface-container)] px-4 py-1.5 text-sm font-bold text-[var(--assessment-primary)]">
            <AssessmentMaterialIcon name="timer" size={18} />
            <DeadlineCountdown dueAt={data.due_at} />
          </div>
        ) : null}
      </div>
      {props.children}
    </div>
  );
}

function StatusScreen(props: {
  icon: string;
  tone: 'amber' | 'emerald' | 'red' | 'blue';
  title: string;
  body: React.ReactNode;
  spinner?: boolean;
  action?: React.ReactNode;
}) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    red: 'border-red-200 bg-red-50 text-red-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
  } as const;
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6 py-16 text-center">
      <div className={`rounded-2xl border p-10 shadow-sm ${tones[props.tone]}`}>
        {props.spinner ? (
          <div className="mx-auto mb-5 h-12 w-12 animate-spin rounded-full border-4 border-current border-t-transparent opacity-70" />
        ) : (
          <AssessmentMaterialIcon name={props.icon} size={44} className="mx-auto mb-4 opacity-80" />
        )}
        <h1 className="text-2xl font-semibold">{props.title}</h1>
        <div className="mt-3 text-sm opacity-90">{props.body}</div>
      </div>
      {props.action}
    </div>
  );
}

function ProjectCard(props: {
  project: CandidateProjectChoice;
  selected: boolean;
  onSelect: () => void;
  onPreview: () => void;
}) {
  const { project: p, selected } = props;
  const deliverables = keyDeliverables(p).slice(0, 3);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={props.onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), props.onSelect())}
      className={`flex cursor-pointer flex-col rounded-2xl border bg-[var(--assessment-surface-container)] p-5 text-left shadow-sm transition ${
        selected
          ? 'border-2 border-[var(--assessment-primary)] ring-4 ring-[var(--assessment-primary)]/10'
          : 'border-[var(--assessment-outline-variant)]/60 hover:border-[var(--assessment-primary)]/50 hover:shadow-md'
      }`}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        {p.category ? (
          <span className="rounded-full border border-[var(--assessment-primary)]/20 bg-[var(--assessment-surface-container)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--assessment-primary)]">
            ● {p.category}
          </span>
        ) : (
          <span />
        )}
        <span
          className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
            selected ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)] text-white' : 'border-slate-300'
          }`}
        >
          {selected ? <AssessmentMaterialIcon name="check" size={14} /> : null}
        </span>
      </div>

      <h3 className="text-lg font-bold leading-snug text-[var(--assessment-on-surface)]">{p.title}</h3>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {p.difficulty ? (
          <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${DIFFICULTY_CLASS[p.difficulty] ?? ''}`}>
            {DIFFICULTY_LABEL[p.difficulty]}
          </span>
        ) : null}
        <span className="flex items-center gap-1 rounded border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-600">
          <AssessmentMaterialIcon name="schedule" size={12} />
          Shared assessment window after selection
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-[var(--assessment-on-surface-variant)]">
        {plainExcerpt(p.description_md)}
      </p>

      <div className="mt-4">
        <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--assessment-outline-variant)]">
          Stack requirements
        </p>
        <div className="flex flex-wrap gap-1.5">
          {stackLabel(p).map((s) => (
            <span
              key={s}
              className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-700"
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      {deliverables.length ? (
        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--assessment-outline-variant)]">
            Key deliverables
          </p>
          <ul className="space-y-1">
            {deliverables.map((d, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-[var(--assessment-on-surface-variant)]">
                <AssessmentMaterialIcon name="check_circle" size={14} className="mt-0.5 text-emerald-600" />
                <span>{d}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between border-t border-[var(--assessment-outline-variant)]/40 pt-3 text-xs">
        <span className={`font-bold ${selected ? 'text-[var(--assessment-primary)]' : 'text-[var(--assessment-on-surface-variant)]'}`}>
          {selected ? '◉ Selected assessment' : 'Choose this assessment'}
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            props.onPreview();
          }}
          className="flex items-center gap-1 font-semibold text-[var(--assessment-primary)] hover:underline"
        >
          <AssessmentMaterialIcon name="visibility" size={14} />
          Details
        </button>
      </div>
    </div>
  );
}

function ProjectDetail({
  project: p,
  submissionToken,
}: {
  project: CandidateProjectChoice;
  submissionToken: string;
}) {
  const excelMode = p.submission_type === 'excel_or_pdf';
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {p.category ? (
            <span className="rounded-full bg-[var(--assessment-surface-container)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--assessment-primary)]">
              {p.category}
            </span>
          ) : null}
          {p.difficulty ? (
            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold ${DIFFICULTY_CLASS[p.difficulty] ?? ''}`}>
              {DIFFICULTY_LABEL[p.difficulty]}
            </span>
          ) : null}
        </div>
        <h2 className="mb-4 text-2xl font-bold text-[var(--assessment-on-surface)]">{p.title}</h2>
        <div className="prose prose-sm prose-slate max-w-none">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.description_md}</ReactMarkdown>
        </div>
        <div className="mt-6">
          <ProjectAssessmentDownloads project={p} submissionToken={submissionToken} />
        </div>
      </div>

      {!excelMode && p.twist_requirement ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 shadow-sm">
          <AssessmentMaterialIcon name="bolt" size={22} className="mt-0.5 text-amber-600" />
          <div>
            <h3 className="text-sm font-bold text-amber-900">The twist</h3>
            <p className="mt-1 text-sm text-amber-900/90">{p.twist_requirement}</p>
          </div>
        </div>
      ) : null}

      {!excelMode && p.must_have_requirements.length ? (
        <div className="rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-bold text-[var(--assessment-on-surface)]">Must-have requirements</h3>
          <ul className="space-y-2.5">
            {p.must_have_requirements.map((r) => (
              <li
                key={r.id}
                className="flex items-start gap-3 rounded-xl border border-[var(--assessment-outline-variant)]/50 p-3 text-sm text-[var(--assessment-on-surface-variant)]"
              >
                <AssessmentMaterialIcon name="radio_button_unchecked" size={18} className="mt-0.5 text-slate-300" />
                <span>{r.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!excelMode ? (
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-[var(--assessment-on-surface)]">
            Tech stack{' '}
            <span className="font-normal text-[var(--assessment-on-surface-variant)]">
              ({p.tech_stack.mode === 'mandatory' ? 'mandatory' : p.tech_stack.mode === 'allowed' ? 'pick from' : 'your choice'})
            </span>
          </h3>
          <div className="flex flex-wrap gap-2">
            {stackLabel(p).map((s) => (
              <span key={s} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 font-mono text-xs font-semibold text-slate-700">
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-[var(--assessment-on-surface)]">Deliverables</h3>
          <ul className="space-y-1.5 text-sm text-[var(--assessment-on-surface-variant)]">
            {keyDeliverables({ ...p, must_have_requirements: [] }).map((d) => (
              <li key={d} className="flex items-center gap-2">
                <AssessmentMaterialIcon name="task_alt" size={16} className="text-emerald-600" />
                {d}
              </li>
            ))}
            <li className="flex items-center gap-2">
              <AssessmentMaterialIcon name="link" size={16} className="text-emerald-600" />
              Public GitHub repository
            </li>
          </ul>
        </div>
      </div>
      ) : null}

      {p.attached_documents.length ? (
        <div className="rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-[var(--assessment-on-surface)]">Attached documents</h3>
          <ul className="space-y-2">
            {p.attached_documents.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-2 text-sm font-semibold text-[var(--assessment-primary)] hover:underline"
                >
                  <AssessmentMaterialIcon name="description" size={16} />
                  {url.split('/').pop() || url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SelectionCountdown(props: {
  startedAt: string | null;
  countdownSeconds: number;
}) {
  const [label, setLabel] = useState('10:00');
  useEffect(() => {
    const started = props.startedAt ? new Date(props.startedAt).getTime() : Date.now();
    const total = Math.max(1, props.countdownSeconds || 600);
    const tick = () => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      const left = Math.max(0, total - elapsed);
      const m = Math.floor(left / 60);
      const s = left % 60;
      setLabel(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [props.startedAt, props.countdownSeconds]);
  return <span className="font-mono tabular-nums">{label}</span>;
}

function SelectionScreen(props: {
  data: ProjectInterviewCandidateView;
  onConfirm: (projectId: string) => void;
  confirming: boolean;
  error: string | null;
}) {
  const { data } = props;
  const [chosenId, setChosenId] = useState<string | null>(data.projects.length === 1 ? data.projects[0]!.id : null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [difficulty, setDifficulty] = useState('all');
  const [category, setCategory] = useState('all');

  const categories = useMemo(
    () => Array.from(new Set(data.projects.map((p) => p.category).filter((c): c is string => Boolean(c)))),
    [data.projects],
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.projects.filter((p) => {
      if (difficulty !== 'all' && p.difficulty !== difficulty) return false;
      if (category !== 'all' && p.category !== category) return false;
      if (!q) return true;
      const hay = [p.title, p.description_md, p.category ?? '', ...p.tech_stack.languages_frameworks].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [data.projects, search, difficulty, category]);

  const chosen = data.projects.find((p) => p.id === chosenId) ?? null;
  const preview = data.projects.find((p) => p.id === previewId) ?? null;
  const maxHours = data.max_assessment_hours || Math.max(...data.projects.map((p) => p.duration_hours), 4);

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6 pb-32 md:p-8 md:pb-32">
      <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--assessment-primary)]/20 bg-[var(--assessment-surface-container)] p-5">
        <div className="flex items-start gap-3">
          <AssessmentMaterialIcon name="lock" size={22} className="mt-0.5 text-[var(--assessment-primary)]" />
          <div>
            <h2 className="text-base font-bold text-[var(--assessment-on-surface)]">Single Choice Locking Notice</h2>
            <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
              <strong>Important:</strong> You can only select <strong>one</strong> project. Once confirmed, your
              choice is final and the assessment session starts. You will have{' '}
              <strong>{maxHours} hours</strong> after you start the project. Keep this window open while you choose.
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className="flex items-center gap-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-1.5 text-xs font-bold text-[var(--assessment-on-surface)]">
            <AssessmentMaterialIcon name="timer" size={16} className="text-[var(--assessment-primary)]" />
            Selection timer:{' '}
            <SelectionCountdown
              startedAt={data.selection_started_at}
              countdownSeconds={data.selection_countdown_seconds ?? 600}
            />
          </span>
          <span className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-1 font-mono text-xs font-bold text-[var(--assessment-on-surface-variant)]">
            Assessment: {maxHours} hrs after start
          </span>
        </div>
      </div>

      <div className="space-y-3 rounded-2xl border border-[var(--assessment-outline-variant)]/60 bg-[var(--assessment-surface-container)] p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] flex-1">
            <AssessmentMaterialIcon
              name="search"
              size={18}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--assessment-outline-variant)]"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects, keywords, frameworks…"
              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] py-2 pl-10 pr-3 text-sm outline-none focus:border-[var(--assessment-primary)]"
            />
          </div>
          <label className="flex items-center gap-2 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
            Difficulty
            <select
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
              className="rounded-lg border border-[var(--assessment-outline-variant)] px-2 py-1.5 text-sm outline-none"
            >
              <option value="all">All difficulties</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              setSearch('');
              setDifficulty('all');
              setCategory('all');
            }}
            className="flex items-center gap-1 rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-1.5 text-xs font-semibold text-[var(--assessment-on-surface-variant)] hover:bg-slate-50"
          >
            <AssessmentMaterialIcon name="restart_alt" size={16} />
            Reset
          </button>
        </div>
        {categories.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {['all', ...categories].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  category === c
                    ? 'bg-[var(--assessment-primary)] text-white'
                    : 'border border-[var(--assessment-outline-variant)] text-[var(--assessment-on-surface-variant)] hover:border-[var(--assessment-primary)]/50'
                }`}
              >
                {c === 'all' ? `All (${data.projects.length})` : c}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {visible.length ? (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              selected={p.id === chosenId}
              onSelect={() => setChosenId(p.id)}
              onPreview={() => setPreviewId(p.id)}
            />
          ))}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-[var(--assessment-outline-variant)] p-10 text-center text-sm text-[var(--assessment-on-surface-variant)]">
          No projects match your filters.
        </p>
      )}

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--assessment-outline-variant)]/60 bg-white/95 px-6 py-4 shadow-[0_-4px_20px_rgba(0,0,0,0.06)] backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--assessment-outline-variant)]">
              Active selection
            </p>
            <p className="truncate text-sm font-bold text-[var(--assessment-on-surface)]">
              {chosen ? chosen.title : 'No project selected yet'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {props.error ? <span className="text-xs font-semibold text-red-600">{props.error}</span> : null}
            {chosen ? (
              <button
                type="button"
                onClick={() => setPreviewId(chosen.id)}
                className="text-sm font-semibold text-[var(--assessment-primary)] hover:underline"
              >
                Preview full brief
              </button>
            ) : null}
            <button
              type="button"
              disabled={!chosen || props.confirming}
              onClick={() => setConfirmOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-[var(--assessment-primary)] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition disabled:opacity-40"
            >
              {props.confirming ? 'Locking…' : 'Confirm selection & start'}
              <AssessmentMaterialIcon name="arrow_forward" size={18} />
            </button>
          </div>
        </div>
      </div>

      {preview ? (
        <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onClick={() => setPreviewId(null)}>
          <div
            className="h-full w-full max-w-3xl overflow-y-auto bg-[var(--assessment-surface)] p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest text-[var(--assessment-outline-variant)]">
                Project brief
              </span>
              <button type="button" onClick={() => setPreviewId(null)} className="text-[var(--assessment-on-surface-variant)]">
                <AssessmentMaterialIcon name="close" size={22} />
              </button>
            </div>
            <ProjectDetail project={preview} submissionToken={data.submission_token} />
            <div className="sticky bottom-0 mt-6 flex justify-end bg-[var(--assessment-surface)] py-3">
              <button
                type="button"
                onClick={() => {
                  setChosenId(preview.id);
                  setPreviewId(null);
                }}
                className="rounded-xl bg-[var(--assessment-primary)] px-5 py-2.5 text-sm font-bold text-white"
              >
                Select this project
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmOpen && chosen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--assessment-surface-container)] p-6 shadow-xl">
            <div className="mb-3 flex items-center gap-2 text-[var(--assessment-primary)]">
              <AssessmentMaterialIcon name="lock" size={22} />
              <h3 className="text-lg font-bold text-[var(--assessment-on-surface)]">Lock in this project?</h3>
            </div>
            <p className="text-sm text-[var(--assessment-on-surface-variant)]">
              You are choosing <strong>{chosen.title}</strong>. This cannot be changed later. You will have{' '}
              <strong>{data.max_assessment_hours || chosen.duration_hours} hours</strong> after you start the
              assessment session (screen share required).
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-[var(--assessment-on-surface-variant)] hover:bg-slate-100"
              >
                Go back
              </button>
              <button
                type="button"
                disabled={props.confirming}
                onClick={() => {
                  setConfirmOpen(false);
                  props.onConfirm(chosen.id);
                }}
                className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
              >
                Yes, lock it in
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SubmitScreen(props: {
  data: ProjectInterviewCandidateView;
  project: CandidateProjectChoice;
  onSubmit: (input: { github_url?: string; github_branch?: string; file?: File }) => void;
  submitting: boolean;
  error: string | null;
}) {
  const { data, project } = props;
  const [githubUrl, setGithubUrl] = useState(data.github_url ?? '');
  const [githubBranch, setGithubBranch] = useState(data.github_branch ?? '');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const urlValid = GITHUB_URL_RE.test(githubUrl.trim());
  const documentPack = project.submission_type === 'zip_upload';
  const excelMode = project.submission_type === 'excel_or_pdf';
  const fileUpload = documentPack || excelMode;

  return (
    <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 p-6 md:grid-cols-3 md:p-8">
      <div className="md:col-span-2">
        <ProjectDetail project={project} submissionToken={data.submission_token} />
      </div>

      <div className="space-y-6">
        <div className="rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm md:sticky md:top-6">
          <h3 className="mb-1 text-lg font-bold text-[var(--assessment-on-surface)]">
            {excelMode
              ? 'Submit your workbook'
              : documentPack
                ? 'Submit your zip'
                : 'Submit your repository'}
          </h3>
          <p className="mb-5 text-xs leading-relaxed text-[var(--assessment-on-surface-variant)]">
            {excelMode
              ? 'Download the problem sheet, finish it in Excel, then upload your workbook. We grade it against the answer key; your Defend interview starts right after.'
              : documentPack
                ? 'Download the assessment files, do the work in your own tools, then upload a .zip of your SQL and write-ups. The AI interview starts after grading.'
                : `Build offline, push to a public GitHub repo, then submit. The AI interview (${data.interview.question_count} questions, ~${data.interview.duration_minutes} min) starts automatically once your code has been analysed — keep your microphone and camera ready.`}
          </p>

          {data.last_error ? (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <AssessmentMaterialIcon name="error" size={16} className="mt-0.5" />
              <span>
                <strong>We couldn&apos;t access your code.</strong>{' '}
                {data.last_error.replace(/^We couldn't access your code\.\s*/i, '')}
              </span>
            </div>
          ) : null}

          <div className="space-y-4">
            {fileUpload ? (
              <div className="space-y-2">
                <span className="text-xs font-bold text-[var(--assessment-on-surface-variant)]">
                  {excelMode ? 'Your completed file' : 'Your zip file'}{' '}
                  <span className="text-red-500">*</span>
                </span>
                <label
                  className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
                    zipFile
                      ? 'border-[var(--assessment-primary)]/40 bg-[var(--assessment-primary)]/5'
                      : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/40 hover:border-[var(--assessment-primary)]/50'
                  }`}
                >
                  <input
                    type="file"
                    accept={
                      excelMode
                        ? '.xlsx,.xls,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf'
                        : '.zip,application/zip'
                    }
                    onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
                    className="sr-only"
                  />
                  <AssessmentMaterialIcon
                    name={zipFile ? 'draft' : 'upload_file'}
                    size={32}
                    className="text-[var(--assessment-primary)]"
                  />
                  {zipFile ? (
                    <>
                      <p className="max-w-full truncate text-sm font-semibold text-[var(--assessment-on-surface)]">
                        {zipFile.name}
                      </p>
                      <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                        {(zipFile.size / 1024).toFixed(0)} KB · click to replace
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-semibold text-[var(--assessment-on-surface)]">
                        {excelMode ? 'Drop workbook here or browse' : 'Drop zip here or browse'}
                      </p>
                      <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                        {excelMode ? '.xlsx preferred · .pdf for soft scoring' : '.zip only'}
                      </p>
                    </>
                  )}
                </label>
                {zipFile ? (
                  <button
                    type="button"
                    onClick={() => setZipFile(null)}
                    className="text-xs font-semibold text-red-600 hover:underline"
                  >
                    Remove file
                  </button>
                ) : null}
              </div>
            ) : null}
            {!fileUpload ? (
            <>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-[var(--assessment-on-surface-variant)]">
                Repository URL <span className="text-red-500">*</span>
              </span>
              <div className="relative">
                <AssessmentMaterialIcon
                  name="link"
                  size={18}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--assessment-outline-variant)]"
                />
                <input
                  value={githubUrl}
                  onChange={(e) => setGithubUrl(e.target.value)}
                  placeholder="https://github.com/username/repo"
                  className="w-full rounded-lg border border-[var(--assessment-outline-variant)] py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--assessment-primary)]"
                />
              </div>
              {githubUrl.trim() && !urlValid ? (
                <span className="text-[11px] text-red-600">Use the form https://github.com/owner/repo</span>
              ) : null}
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-bold text-[var(--assessment-on-surface-variant)]">Branch (optional)</span>
              <div className="relative">
                <AssessmentMaterialIcon
                  name="call_split"
                  size={18}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--assessment-outline-variant)]"
                />
                <input
                  value={githubBranch}
                  onChange={(e) => setGithubBranch(e.target.value)}
                  placeholder="main"
                  className="w-full rounded-lg border border-[var(--assessment-outline-variant)] py-2.5 pl-10 pr-3 text-sm outline-none focus:border-[var(--assessment-primary)]"
                />
              </div>
            </label>
            </>
            ) : null}
            {props.error ? (
              <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-xs font-medium text-red-700">{props.error}</p>
            ) : null}
            <button
              type="button"
              disabled={(fileUpload ? !zipFile : !urlValid) || props.submitting}
              onClick={() => setConfirmOpen(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--assessment-primary)] px-5 py-3 text-sm font-bold text-white shadow-sm disabled:opacity-40"
            >
              <AssessmentMaterialIcon name="rocket_launch" size={18} />
              {props.submitting ? 'Submitting…' : 'Submit & start interview'}
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm">
          <h3 className="mb-3 text-sm font-bold text-[var(--assessment-on-surface)]">What happens next</h3>
          <ol className="space-y-3 text-xs text-[var(--assessment-on-surface-variant)]">
            {(excelMode
              ? [
                  ['table_view', 'We compare your answer cells to the master key (problem≠key).'],
                  ['fact_check', 'You get a Build score from matched cells; gaps feed the interview.'],
                  ['record_voice_over', 'An AI interviewer asks conceptual questions about your workbook.'],
                ]
              : documentPack
                ? [
                    ['inventory_2', 'We unpack your zip and read your SQL / write-ups.'],
                    ['fact_check', 'Your work is checked against the assessment rubric.'],
                    ['record_voice_over', 'An AI interviewer asks conceptual questions about your submission.'],
                  ]
                : [
                    ['inventory_2', 'We read your README, package / config files and folder structure.'],
                    ['fact_check', 'Your repo is checked against the must-have requirements.'],
                    ['record_voice_over', 'An AI interviewer asks simple conceptual questions about your own project.'],
                  ]
            ).map(([icon, text]) => (
              <li key={icon} className="flex items-start gap-2">
                <AssessmentMaterialIcon name={icon!} size={16} className="mt-0.5 text-[var(--assessment-primary)]" />
                <span>{text}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--assessment-surface-container)] p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[var(--assessment-on-surface)]">Ready for your interview?</h3>
            <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
              {excelMode
                ? 'Your workbook will be graded against the answer key. The voice interview starts after grading.'
                : documentPack
                  ? 'Your zip will be read and scored. The voice interview starts after grading. Make sure you are in a quiet place with your camera and microphone available.'
                  : 'Once your repository has been analysed, the voice interview starts immediately. Make sure you are in a quiet place with your camera and microphone available.'}
            </p>
            <p className="mt-2 break-all rounded-lg bg-slate-50 p-2 font-mono text-xs text-slate-700">
              {fileUpload
                ? zipFile?.name
                : `${githubUrl.trim()}${githubBranch.trim() ? ` @ ${githubBranch.trim()}` : ''}`}
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-[var(--assessment-on-surface-variant)] hover:bg-slate-100"
              >
                Not yet
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  props.onSubmit(
                    fileUpload && zipFile
                      ? { file: zipFile }
                      : { github_url: githubUrl.trim(), github_branch: githubBranch.trim() },
                  );
                }}
                className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-bold text-white"
              >
                Submit now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ProjectInterviewCandidatePage({ token }: { token: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const queryKey = ['project-interview', token];

  const query = useQuery({
    queryKey,
    queryFn: () => getProjectInterviewSubmission(token),
    refetchInterval: (q) =>
      q.state.data?.status === 'evaluating_code' || q.state.data?.result?.pending ? 3000 : false,
    refetchOnWindowFocus: true,
  });

  const selectMutation = useMutation({
    mutationFn: (projectId: string) => selectProjectInterviewProject(token, projectId),
    onSuccess: (data) => {
      qc.setQueryData(queryKey, data);
      const buildToken = data.build_session_token;
      if (!buildToken) return;
      const portalToken = data.portal_token;
      if (portalToken) localStorage.setItem(`portalToken:${buildToken}`, portalToken);
      const qs = new URLSearchParams({ bndPhase: 'build' });
      if (portalToken) qs.set('portalToken', portalToken);
      window.location.href = withBasePath(`/autonomous-interview/${buildToken}?${qs.toString()}`);
    },
  });

  const submitMutation = useMutation({
    mutationFn: (input: { github_url?: string; github_branch?: string; file?: File }) =>
      input.file
        ? submitProjectInterviewZip(token, input.file)
        : submitProjectInterviewRepo(token, {
            github_url: input.github_url ?? '',
            github_branch: input.github_branch,
          }),
    onSuccess: (data) => qc.setQueryData(queryKey, data),
  });

  const data = query.data;
  const portalHref = data?.portal_token ? `/candidate/portal/${data.portal_token}` : null;

  useEffect(() => {
    if (data?.status === 'in_build' && data.build_session_token) {
      const buildToken = data.build_session_token;
      const portalToken = data.portal_token;
      if (portalToken) localStorage.setItem(`portalToken:${buildToken}`, portalToken);
      const qs = new URLSearchParams({ bndPhase: 'build' });
      if (portalToken) qs.set('portalToken', portalToken);
      window.location.href = withBasePath(`/autonomous-interview/${buildToken}?${qs.toString()}`);
    }
  }, [data?.status, data?.build_session_token, data?.portal_token]);

  useEffect(() => {
    const portalToken = data?.portal_token;
    if (data?.result?.pending !== false || data?.result?.outcome !== 'advanced' || !portalToken) return;
    const timer = setTimeout(() => {
      window.location.href = withBasePath(`/candidate/portal/${portalToken}`);
    }, 4000);
    return () => clearTimeout(timer);
  }, [data?.result?.pending, data?.result?.outcome, data?.portal_token]);

  useEffect(() => {
    if (data?.result?.pending) return;
    if (data?.status !== 'ready_for_interview' || !data.interview_token) return;
    const interviewToken = data.interview_token;
    const portalToken = data.portal_token;
    if (portalToken) localStorage.setItem(`portalToken:${interviewToken}`, portalToken);
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({ bndPhase: 'defend' });
      if (portalToken) qs.set('portalToken', portalToken);
      window.location.href = withBasePath(`/autonomous-interview/${interviewToken}?${qs.toString()}`);
    }, 1500);
    return () => clearTimeout(timer);
  }, [data?.status, data?.interview_token, data?.portal_token, data?.result?.pending]);

  if (query.isLoading) {
    return <div className="p-6 text-sm text-[var(--assessment-on-surface-variant)]">Loading Build &amp; Defend…</div>;
  }
  if (query.error || !data) {
    return (
      <div className="p-6 text-sm text-red-600">
        {query.error instanceof Error ? query.error.message : 'Could not load this round.'}
      </div>
    );
  }

  const backToPortal = portalHref ? (
    <button
      type="button"
      onClick={() => router.push(portalHref)}
      className="rounded-lg bg-[var(--assessment-primary)] px-5 py-2.5 text-sm font-bold text-white shadow-sm"
    >
      Return to portal
    </button>
  ) : null;

  if (data.result?.pending) {
    return (
      <Shell data={data}>
        <StatusScreen
          icon="hourglass_top"
          tone="amber"
          spinner
          title="Your round is being assessed"
          body={
            <>
              <p>Build and Defend are being evaluated together. This can take a few minutes.</p>
              <p className="mt-4 font-bold text-red-600">
                Please do not close this page while the evaluation is in progress.
              </p>
            </>
          }
        />
      </Shell>
    );
  }

  if (data.result && data.result.pending === false) {
    if (data.result.outcome === 'eliminated') {
      return (
        <Shell data={data}>
          <div className="mx-auto max-w-4xl space-y-8 p-6 py-12 font-sans">
            <div className="rounded-sm bg-[#1685FF] p-12 text-center text-white shadow-sm">
              <h1 className="mb-4 text-4xl font-semibold tracking-tight">Assessment complete</h1>
              <h2 className="text-2xl font-medium">Thank you!</h2>
            </div>
            <div className="space-y-4 px-2 text-gray-800">
              <p className="text-[15px]">
                Unfortunately, your score did not meet the requirement to advance to the next stage.
              </p>
            </div>
          </div>
        </Shell>
      );
    }
    if (data.result.outcome === 'advanced') {
      return (
        <Shell data={data}>
          <div className="mx-auto max-w-4xl space-y-8 p-6 py-12 font-sans">
            <div className="rounded-sm bg-[#1685FF] p-12 text-center text-white shadow-sm">
              <h1 className="mb-4 text-4xl font-semibold tracking-tight">Round completed</h1>
              <h2 className="text-2xl font-medium">Thank you!</h2>
            </div>
            <div className="space-y-4 px-2 text-center text-gray-800">
              <p className="text-[15px]">Returning you to your dashboard…</p>
            </div>
          </div>
        </Shell>
      );
    }
    return (
      <Shell data={data}>
        <div className="mx-auto max-w-4xl space-y-8 p-6 py-12 font-sans">
          <div className="rounded-sm bg-[#1685FF] p-12 text-center text-white shadow-sm">
            <h1 className="mb-4 text-4xl font-semibold tracking-tight">Assessment complete</h1>
            <h2 className="text-2xl font-medium">Thank you!</h2>
          </div>
          <div className="space-y-4 px-2 text-gray-800">
            <p className="text-[15px]">All assessment rounds have been completed.</p>
            <p className="text-[15px]">We will contact you about the next steps.</p>
          </div>
        </div>
      </Shell>
    );
  }

  if (data.status === 'in_build') {
    return (
      <Shell data={data} showDeadline>
        <StatusScreen
          icon="desktop_windows"
          tone="blue"
          spinner
          title="Opening your Build session…"
          body="Connecting you to the assessment room. Keep screen sharing on for the full window."
        />
      </Shell>
    );
  }

  if (data.status === 'evaluating_code') {
    return (
      <Shell data={data}>
        <StatusScreen
          icon="hourglass_top"
          tone="blue"
          spinner
          title="Evaluating your submission…"
          body={<SubmissionEvaluationProgress target={data.github_url || 'your uploaded files'} />}
        />
      </Shell>
    );
  }

  if (data.status === 'ready_for_interview') {
    return (
      <Shell data={data}>
        <StatusScreen
          icon="record_voice_over"
          tone="emerald"
          spinner
          title="Starting your interview…"
          body="Your project has been analysed. Connecting you to the AI interviewer now."
        />
      </Shell>
    );
  }

  if (data.status === 'completed') {
    return (
      <Shell data={data}>
        <StatusScreen
          icon="task_alt"
          tone="emerald"
          title="Round completed"
          body="Thank you! Your project and interview have been recorded. We'll be in touch about the next steps."
          action={backToPortal}
        />
      </Shell>
    );
  }

  if (data.status === 'expired') {
    return (
      <Shell data={data}>
        <StatusScreen
          icon="timer_off"
          tone="red"
          title="Build window expired"
          body="The deadline for this project has passed and submissions are closed."
          action={backToPortal}
        />
      </Shell>
    );
  }

  if (!data.selected_project) {
    return (
      <Shell data={data}>
        {data.projects.length ? (
          <SelectionScreen
            data={data}
            confirming={selectMutation.isPending}
            error={selectMutation.error instanceof Error ? selectMutation.error.message : null}
            onConfirm={(id) => selectMutation.mutate(id)}
          />
        ) : (
          <StatusScreen
            icon="inventory_2"
            tone="amber"
            title="No projects available"
            body="This round has not been configured yet. Please contact the recruiter."
            action={backToPortal}
          />
        )}
      </Shell>
    );
  }

  return (
    <Shell data={data} showDeadline>
      <SubmitScreen
        data={data}
        project={data.selected_project}
        submitting={submitMutation.isPending}
        error={submitMutation.error instanceof Error ? submitMutation.error.message : null}
        onSubmit={(input) => submitMutation.mutate(input)}
      />
    </Shell>
  );
}
