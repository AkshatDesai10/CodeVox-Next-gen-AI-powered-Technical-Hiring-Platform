'use client';

import { useMemo, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { uploadProjectInterviewFile } from '@/modules/job-profiles/lib/job-profiles-api';
export function textInputClass(extra = '') {
  return `w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-2 text-xs text-[var(--assessment-on-surface)] placeholder-[var(--assessment-on-surface-variant)] focus:border-[var(--assessment-primary)] focus:outline-none ${extra}`;
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] mb-1">
      {children}
    </label>
  );
}

export function SectionCard({
  icon,
  title,
  children,
}: {
  icon?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-5 space-y-3">
      <div className="flex items-center gap-2 text-sm font-bold text-[var(--assessment-on-surface)]">
        {icon ? (
          <AssessmentMaterialIcon
            name={icon}
            size={18}
            className="text-[var(--assessment-primary)]"
          />
        ) : null}
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}

export function formatLibraries(libs: string[]): string {
  return (libs || []).join(', ');
}

export function parseLibraries(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
import {
  CODE_DEFEND_TOPIC_PRESETS,
  EXCEL_DEFEND_TOPIC_PRESETS,
  PROJECT_DIFFICULTY_LABELS,
  PROJECT_INTERVIEW_MAX_CHOICES,
  PROJECT_TECH_MODE_LABELS,
  VIVA_QUESTION_SOURCE_LABELS,
  defaultProjectChoice,
  normalizeVivaQuestionSource,
  parseProjectInterviewRoundConfig,
  type ProjectChoice,
  type ProjectDifficulty,
  type ProjectGradingRubric,
  type ProjectInterviewRoundConfig,
  type ProjectRubricTask,
  type ProjectSubmissionType,
  type ProjectTechStackMode,
  type VivaQuestionSource,
} from '@/modules/job-profiles/lib/project-interview-round.types';

function isSameTopicList(a: string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(a.map((x) => x.trim().toLowerCase()));
  return b.every((x) => set.has(x.toLowerCase()));
}

function defendTopicPresetsFor(submissionType: ProjectSubmissionType | undefined): readonly string[] {
  return submissionType === 'excel_or_pdf' ? EXCEL_DEFEND_TOPIC_PRESETS : CODE_DEFEND_TOPIC_PRESETS;
}

type Props = {
  config: ProjectInterviewRoundConfig | Record<string, unknown> | null | undefined;
  onChange: (config: ProjectInterviewRoundConfig) => void;
};

const DELIVERABLE_LABELS: Array<{ key: keyof ProjectChoice['deliverables']; label: string }> = [
  { key: 'require_readme', label: 'README.md' },
  { key: 'run_instructions_required', label: 'Run instructions' },
  { key: 'require_tests', label: 'Automated tests' },
  { key: 'require_decisions_md', label: 'DECISIONS.md' },
];

export function ProjectInterviewRoundConfigForm(props: Props) {
  const config = useMemo(() => parseProjectInterviewRoundConfig(props.config), [props.config]);
  const [activeIdx, setActiveIdx] = useState(0);
  const idx = Math.min(activeIdx, Math.max(0, config.project_choices.length - 1));
  const active = config.project_choices[idx];

  const patch = (partial: Partial<ProjectInterviewRoundConfig>) =>
    props.onChange({ ...config, ...partial });

  const patchChoice = (partial: Partial<ProjectChoice>) =>
    patch({
      project_choices: config.project_choices.map((c, i) => (i === idx ? { ...c, ...partial } : c)),
    });

  const addChoice = () => {
    if (config.project_choices.length >= PROJECT_INTERVIEW_MAX_CHOICES) return;
    patch({
      project_choices: [...config.project_choices, defaultProjectChoice(config.project_choices.length)],
    });
    setActiveIdx(config.project_choices.length);
  };

  const removeChoice = (i: number) => {
    if (config.project_choices.length <= 1) return;
    patch({ project_choices: config.project_choices.filter((_, j) => j !== i) });
    setActiveIdx(Math.max(0, i - 1));
  };

  const interviewWeight = config.scoring_weights.interview_performance;
  const codeWeight = config.scoring_weights.code_submission;
  const vivaSource = normalizeVivaQuestionSource(config.ai_interviewer.viva_question_source);
  const showDefendTopics = vivaSource === 'admin_rubric' || vivaSource === 'mix';
  const topicPresets = defendTopicPresetsFor(active?.submission_type);

  const setInterviewWeight = (interview_performance: number) => {
    const interview = Math.min(100, Math.max(0, interview_performance));
    patch({
      scoring_weights: {
        interview_performance: interview,
        code_submission: 100 - interview,
      },
    });
  };

  const patchChoiceWithTopicDefaults = (partial: Partial<ProjectChoice>) => {
    const nextType = partial.submission_type ?? active?.submission_type;
    const nextPresets = defendTopicPresetsFor(nextType);
    const current = config.ai_interviewer.focus_areas ?? [];
    const looksLikeOtherDefault =
      isSameTopicList(current, CODE_DEFEND_TOPIC_PRESETS) ||
      isSameTopicList(current, EXCEL_DEFEND_TOPIC_PRESETS) ||
      current.length === 0;
    const shouldSwapTopics =
      partial.submission_type != null &&
      partial.submission_type !== active?.submission_type &&
      looksLikeOtherDefault;

    patch({
      project_choices: config.project_choices.map((c, i) => (i === idx ? { ...c, ...partial } : c)),
      ...(shouldSwapTopics
        ? {
            ai_interviewer: {
              ...config.ai_interviewer,
              focus_areas: [...nextPresets],
            },
          }
        : {}),
    });
  };

  return (
    <div className="space-y-6">
      <SectionCard icon="schedule" title="Assessment time">
        <p className="text-xs text-[var(--assessment-on-surface-variant)]">
          One shared Build window for every project. After the candidate locks a project, this clock starts
          for the LiveKit assessment session.
        </p>
        <label className="block max-w-xs space-y-1">
          <FieldLabel>Maximum assessment time (hours)</FieldLabel>
          <input
            type="number"
            min={1}
            max={168}
            className={textInputClass()}
            value={config.max_assessment_hours}
            onChange={(e) =>
              patch({
                max_assessment_hours: Math.min(168, Math.max(1, Number(e.target.value) || 4)),
              })
            }
          />
        </label>
      </SectionCard>

      <SectionCard icon="view_carousel" title="Project Choices">
        <p className="text-xs text-[var(--assessment-on-surface-variant)]">
          Candidates pick exactly one project (the choice is locked), build it while screen-sharing in
          LiveKit, submit a GitHub link, then defend the repo in an AI interview.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {config.project_choices.map((c, i) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setActiveIdx(i)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                i === idx
                  ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)] text-white'
                  : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)] hover:border-[var(--assessment-primary)]/50'
              }`}
            >
              {c.title.trim() || `Project ${i + 1}`}
              {!c.title.trim() || !c.description_md.trim() ? (
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" title="Incomplete" />
              ) : null}
            </button>
          ))}
          <button
            type="button"
            onClick={addChoice}
            disabled={config.project_choices.length >= PROJECT_INTERVIEW_MAX_CHOICES}
            className="flex items-center gap-1 rounded-full border border-dashed border-[var(--assessment-primary)]/60 px-3 py-1.5 text-xs font-bold text-[var(--assessment-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AssessmentMaterialIcon name="add" size={16} />
            Add project
          </button>
        </div>

        {active ? (
          <ProjectChoiceEditor
            key={active.id}
            choice={active}
            index={idx}
            canRemove={config.project_choices.length > 1}
            onChange={patchChoiceWithTopicDefaults}
            onRemove={() => removeChoice(idx)}
          />
        ) : null}
      </SectionCard>

      <SectionCard icon="record_voice_over" title="AI Interviewer">
        <p className="text-xs text-[var(--assessment-on-surface-variant)]">
          After Build grading, the voice Defend interview starts with locked questions. Never reveals
          answer-key values; probes concepts, assumptions, and flagged mistakes.
        </p>
        <div className="block space-y-1">
          <FieldLabel>Viva question source</FieldLabel>
          <div className="flex flex-col gap-1 rounded-lg border border-[var(--assessment-outline-variant)] p-1 sm:flex-row">
            {(Object.keys(VIVA_QUESTION_SOURCE_LABELS) as VivaQuestionSource[]).map((src) => {
              const selected = vivaSource === src;
              return (
                <button
                  key={src}
                  type="button"
                  onClick={() =>
                    patch({
                      ai_interviewer: { ...config.ai_interviewer, viva_question_source: src },
                    })
                  }
                  className={`flex-1 rounded-md px-2 py-2 text-[11px] font-bold leading-tight ${
                    selected
                      ? 'bg-[var(--assessment-primary)] text-white'
                      : 'text-[var(--assessment-on-surface-variant)]'
                  }`}
                >
                  {VIVA_QUESTION_SOURCE_LABELS[src]}
                </button>
              );
            })}
          </div>
        </div>
        {showDefendTopics ? (
          <DefendTopicsChecklist
            presets={topicPresets}
            value={config.ai_interviewer.focus_areas}
            onChange={(focus_areas) =>
              patch({ ai_interviewer: { ...config.ai_interviewer, focus_areas } })
            }
            excelMode={active?.submission_type === 'excel_or_pdf'}
          />
        ) : (
          <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
            Defend topics hidden — questions will come only from submission gaps / mistakes.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1">
            <FieldLabel>Primary questions</FieldLabel>
            <input
              type="number"
              min={1}
              className={textInputClass()}
              value={config.ai_interviewer.question_count}
              onChange={(e) =>
                patch({
                  ai_interviewer: {
                    ...config.ai_interviewer,
                    question_count: Math.max(1, Math.round(Number(e.target.value)) || 1),
                  },
                })
              }
            />
          </label>
          <label className="block space-y-1">
            <FieldLabel>Max duration (minutes)</FieldLabel>
            <input
              type="number"
              min={5}
              max={20}
              className={textInputClass()}
              value={config.ai_interviewer.duration_minutes}
              onChange={(e) =>
                patch({
                  ai_interviewer: {
                    ...config.ai_interviewer,
                    duration_minutes: Math.min(20, Math.max(5, Number(e.target.value) || 15)),
                  },
                })
              }
            />
          </label>
        </div>
      </SectionCard>

      <SectionCard icon="scale" title="Scoring Weights">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="font-bold uppercase tracking-wide">Code build</span>
            <span className="font-mono text-lg font-bold text-[var(--codevox-secondary)]">{codeWeight}%</span>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold uppercase tracking-wide">Interview defense</span>
              <span className="font-mono text-lg font-bold text-[var(--assessment-primary)]">
                {interviewWeight}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={interviewWeight}
              onChange={(e) => setInterviewWeight(Number(e.target.value))}
              className="h-2 w-full accent-[var(--assessment-primary)]"
            />
          </div>
          <p className="text-xs text-[var(--assessment-on-surface-variant)]">
            Final score = (code requirements score × {codeWeight}%) + (verbal defense score × {interviewWeight}
            %). Competency rubric below is informational for recruiters.
          </p>
        </div>
      </SectionCard>
    </div>
  );
}

function ListInput(props: {
  value: string[];
  onChange: (list: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={textInputClass()}
      disabled={props.disabled}
      value={draft ?? formatLibraries(props.value)}
      onChange={(e) => {
        setDraft(e.target.value);
        props.onChange(parseLibraries(e.target.value));
      }}
      onBlur={() => setDraft(null)}
      placeholder={props.placeholder}
    />
  );
}

/** Verbal-style topic checklist (stores the same focus_areas string[]). */
function DefendTopicsChecklist(props: {
  presets: readonly string[];
  value: string[];
  onChange: (next: string[]) => void;
  excelMode: boolean;
}) {
  const [customDraft, setCustomDraft] = useState('');
  const selected = new Set(props.value.map((x) => x.trim()).filter(Boolean));
  const customTopics = props.value.filter(
    (t) => t.trim() && !props.presets.some((p) => p.toLowerCase() === t.trim().toLowerCase()),
  );

  const toggle = (label: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(label);
    else next.delete(label);
    props.onChange([...next]);
  };

  const addCustom = () => {
    const label = customDraft.trim();
    if (!label) return;
    if (![...selected].some((x) => x.toLowerCase() === label.toLowerCase())) {
      props.onChange([...selected, label]);
    }
    setCustomDraft('');
  };

  const applyPresets = () => props.onChange([...props.presets]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel>Defend topics</FieldLabel>
        <button
          type="button"
          onClick={applyPresets}
          className="text-[11px] font-bold text-[var(--assessment-primary)] hover:underline"
        >
          Use {props.excelMode ? 'Excel' : 'code'} defaults
        </button>
      </div>
      <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
        Like AI Verbal rubrics — pick topics the viva should cover
        {props.excelMode ? ' for this Excel practical' : ''}.
      </p>
      <ul className="space-y-1 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-3">
        {props.presets.map((label) => (
          <li key={label}>
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--assessment-on-surface)]">
              <input
                type="checkbox"
                checked={selected.has(label)}
                onChange={(e) => toggle(label, e.target.checked)}
              />
              {label}
            </label>
          </li>
        ))}
        {customTopics.map((label) => (
          <li key={label} className="flex items-center gap-2">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked
                onChange={(e) => toggle(label, e.target.checked)}
              />
              <span className="truncate">{label}</span>
            </label>
            <button
              type="button"
              className="text-[11px] font-bold text-red-600"
              onClick={() => toggle(label, false)}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <input
          className={`${textInputClass()} flex-1`}
          value={customDraft}
          onChange={(e) => setCustomDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addCustom())}
          placeholder="Add a custom topic…"
        />
        <button
          type="button"
          onClick={addCustom}
          className="rounded-lg bg-[var(--assessment-primary)] px-3 py-2 text-xs font-bold text-white"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function GradingRubricEditor(props: {
  rubric: ProjectGradingRubric | null | undefined;
  onChange: (rubric: ProjectGradingRubric | null) => void;
}) {
  const tasks = props.rubric?.tasks ?? [];
  const write = (next: ProjectRubricTask[]) => props.onChange(next.length ? { tasks: next } : null);
  const patchTask = (index: number, task: ProjectRubricTask) => write(tasks.map((row, i) => (i === index ? task : row)));
  const totalMarks = tasks.reduce((sum, task) => sum + task.subparts.reduce((partSum, part) => partSum + part.marks, 0), 0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>Grading rubric</FieldLabel>
        {tasks.length ? (
          <span className="text-[11px] font-bold text-[var(--assessment-on-surface-variant)]">Total {totalMarks}</span>
        ) : null}
      </div>
      <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
        Filled from the assessment. When the document has no marks, AI assigns them by importance and they sum to 100. You can change any mark before saving.
      </p>
      {tasks.map((task, taskIndex) => (
        <div key={task.id} className="space-y-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-3">
          <div className="flex items-center gap-2">
            <input
              className={`${textInputClass()} flex-1`}
              value={task.name}
              onChange={(e) => patchTask(taskIndex, { ...task, name: e.target.value })}
              placeholder="Task name"
            />
            <button
              type="button"
              className="text-[var(--assessment-on-surface-variant)] hover:text-red-600"
              onClick={() => write(tasks.filter((_, i) => i !== taskIndex))}
            >
              <AssessmentMaterialIcon name="close" size={18} />
            </button>
          </div>
          {task.subparts.map((part, partIndex) => (
            <div key={`${task.id}-${partIndex}`} className="flex items-center gap-2 pl-3">
              <input
                className={`${textInputClass()} flex-1`}
                value={part.name}
                onChange={(e) =>
                  patchTask(taskIndex, {
                    ...task,
                    subparts: task.subparts.map((row, i) => (i === partIndex ? { ...row, name: e.target.value } : row)),
                  })
                }
                placeholder="Sub-part, e.g. Stock never goes negative"
              />
              <label className="flex items-center gap-1 text-[10px] font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                Marks
                <input
                  type="number"
                  min={1}
                  max={100}
                  className="w-16 rounded border border-[var(--assessment-outline-variant)] px-2 py-1 font-mono text-xs outline-none"
                  value={part.marks}
                  onChange={(e) =>
                    patchTask(taskIndex, {
                      ...task,
                      subparts: task.subparts.map((row, i) =>
                        i === partIndex ? { ...row, marks: Math.max(1, Number(e.target.value) || 1) } : row,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                className="text-[var(--assessment-on-surface-variant)] hover:text-red-600"
                onClick={() =>
                  patchTask(taskIndex, { ...task, subparts: task.subparts.filter((_, i) => i !== partIndex) })
                }
              >
                <AssessmentMaterialIcon name="close" size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="pl-3 text-xs font-bold text-[var(--assessment-primary)]"
            onClick={() => patchTask(taskIndex, { ...task, subparts: [...task.subparts, { name: '', marks: 1 }] })}
          >
            Add sub-part
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          write([
            ...tasks,
            { id: `task_${Date.now().toString(36)}`, name: '', subparts: [{ name: '', marks: 1 }] },
          ])
        }
        className="flex items-center gap-1 rounded-lg bg-[var(--assessment-primary)] px-3 py-2 text-xs font-bold text-white"
      >
        <AssessmentMaterialIcon name="add_circle" size={16} />
        Add task
      </button>
    </div>
  );
}

function ProjectChoiceEditor(props: {
  choice: ProjectChoice;
  index: number;
  canRemove: boolean;
  onChange: (partial: Partial<ProjectChoice>) => void;
  onRemove: () => void;
}) {
  const { choice, onChange } = props;
  const [newReq, setNewReq] = useState('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'assessment' | 'dataset' | 'answer_key' | null>(null);
  const documentPack = choice.submission_type === 'zip_upload';
  const excelMode = choice.submission_type === 'excel_or_pdf';
  const githubMode = choice.submission_type === 'github_url';

  const setSubmissionType = (submission_type: ProjectSubmissionType) => {
    // Excel/PDF practical scores from answer-key cells — no code checklist fields.
    if (submission_type === 'excel_or_pdf') {
      onChange({
        submission_type,
        twist_requirement: '',
        must_have_requirements: [],
        tech_stack: { mode: 'free_choice', languages_frameworks: [] },
        deliverables: {
          require_readme: false,
          require_decisions_md: false,
          require_tests: false,
          run_instructions_required: false,
        },
        supporting_datasets: [],
        grading_rubric: undefined,
      });
      return;
    }
    onChange({ submission_type });
  };

  const uploadAssessment = (file: File) => {
    setUploadError(null);
    setUploading('assessment');
    void uploadProjectInterviewFile(file, 'assessment_document')
      .then((uploaded) => {
        onChange({
          assessment_document: {
            filename: uploaded.filename,
            file_url: uploaded.file_url,
            extracted_text: uploaded.extracted_text,
          },
          ...(uploaded.title ? { title: uploaded.title } : {}),
          ...(uploaded.teaser ? { description_md: uploaded.teaser } : {}),
          // Excel mode: never import must-have / rubric from the problem sheet.
          ...(!excelMode && uploaded.requirements?.length
            ? {
                must_have_requirements: uploaded.requirements.map((item, i) => ({
                  id: `req_doc_${Date.now().toString(36)}_${i}`,
                  text: item.text,
                  weight: item.weight,
                })),
              }
            : {}),
          ...(!excelMode && uploaded.grading_rubric?.tasks?.length
            ? { grading_rubric: uploaded.grading_rubric }
            : {}),
        });
      })
      .catch((err: unknown) => {
        setUploadError(err instanceof Error ? err.message : 'Could not upload the assessment document.');
      })
      .finally(() => setUploading(null));
  };

  const uploadAnswerKey = (file: File) => {
    setUploadError(null);
    setUploading('answer_key');
    void uploadProjectInterviewFile(file, 'answer_key')
      .then((uploaded) => {
        onChange({
          answer_key: {
            filename: uploaded.filename,
            file_url: uploaded.file_url,
            uploaded_at: uploaded.uploaded_at ?? new Date().toISOString(),
          },
        });
      })
      .catch((err: unknown) => {
        setUploadError(err instanceof Error ? err.message : 'Could not upload the answer key.');
      })
      .finally(() => setUploading(null));
  };

  const uploadDataset = (file: File) => {
    setUploadError(null);
    setUploading('dataset');
    void uploadProjectInterviewFile(file, 'supporting_dataset')
      .then((uploaded) => {
        onChange({
          supporting_datasets: [
            ...(choice.supporting_datasets ?? []),
            { filename: uploaded.filename, file_url: uploaded.file_url },
          ],
        });
      })
      .catch((err: unknown) => {
        setUploadError(err instanceof Error ? err.message : 'Could not upload the dataset.');
      })
      .finally(() => setUploading(null));
  };

  const assessmentDrop = useDropzone({
    accept: excelMode
      ? {
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
          'application/vnd.ms-excel': ['.xls'],
          'application/pdf': ['.pdf'],
        }
      : {
          'application/pdf': ['.pdf'],
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
    maxSize: 25 * 1024 * 1024,
    multiple: false,
    disabled: uploading != null,
    onDrop: (files, fileRejections) => {
      if (fileRejections.length > 0) {
        const rej = fileRejections[0];
        const isTooLarge = rej.errors.some((e) => e.code === 'file-too-large');
        setUploadError(
          isTooLarge
            ? 'File must not exceed 25 MB.'
            : rej.errors[0]?.message || 'Invalid file.',
        );
        return;
      }
      const file = files[0];
      if (file) uploadAssessment(file);
    },
  });

  const answerKeyDrop = useDropzone({
    accept: {
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
      'application/vnd.ms-excel': ['.xls'],
    },
    maxSize: 25 * 1024 * 1024,
    multiple: false,
    disabled: uploading != null,
    onDrop: (files, fileRejections) => {
      if (fileRejections.length > 0) {
        const rej = fileRejections[0];
        const isTooLarge = rej.errors.some((e) => e.code === 'file-too-large');
        setUploadError(
          isTooLarge ? 'Answer key must not exceed 25 MB.' : rej.errors[0]?.message || 'Invalid file.',
        );
        return;
      }
      const file = files[0];
      if (file) uploadAnswerKey(file);
    },
  });

  const datasetDrop = useDropzone({
    accept: {
      'application/sql': ['.sql'],
      'text/csv': ['.csv'],
      'application/json': ['.json'],
      'text/plain': ['.txt', '.md', '.tsv'],
    },
    maxSize: 25 * 1024 * 1024,
    multiple: false,
    disabled: uploading != null,
    onDrop: (files, fileRejections) => {
      if (fileRejections.length > 0) {
        const rej = fileRejections[0];
        const isTooLarge = rej.errors.some((e) => e.code === 'file-too-large');
        setUploadError(
          isTooLarge
            ? 'Supporting dataset must not exceed 25 MB.'
            : rej.errors[0]?.message || 'Invalid file.',
        );
        return;
      }
      const file = files[0];
      if (file) uploadDataset(file);
    },
  });

  const addRequirement = () => {
    const text = newReq.trim();
    if (!text) return;
    onChange({
      must_have_requirements: [
        ...choice.must_have_requirements,
        { id: `req_${Date.now().toString(36)}`, text, weight: 1 },
      ],
    });
    setNewReq('');
  };

  return (
    <div className="space-y-4 rounded-xl border border-[var(--assessment-outline-variant)]/50 bg-[var(--assessment-surface-container-low)]/40 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest text-[var(--assessment-on-surface-variant)]">
          Project {props.index + 1}
        </span>
        {props.canRemove ? (
          <button
            type="button"
            onClick={props.onRemove}
            className="flex items-center gap-1 text-xs font-bold text-red-600 hover:underline"
          >
            <AssessmentMaterialIcon name="delete" size={16} />
            Remove
          </button>
        ) : null}
      </div>

      <div className="block space-y-1">
        <FieldLabel>Candidate submission</FieldLabel>
        <div className="flex flex-col gap-1 rounded-lg border border-[var(--assessment-outline-variant)] p-1 sm:flex-row">
          {(
            [
              ['github_url', 'GitHub Repo'],
              ['zip_upload', 'ZIP Pack'],
              ['excel_or_pdf', 'Excel / PDF Practical'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setSubmissionType(value)}
              className={`flex-1 rounded-md px-2 py-2 text-xs font-bold ${
                choice.submission_type === value
                  ? 'bg-[var(--assessment-primary)] text-white'
                  : 'text-[var(--assessment-on-surface-variant)]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div
        {...assessmentDrop.getRootProps()}
        className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
          assessmentDrop.isDragActive
            ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5'
            : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]'
        } ${uploading === 'assessment' ? 'opacity-60' : ''}`}
      >
        <input {...assessmentDrop.getInputProps()} />
        <AssessmentMaterialIcon name="upload_file" size={28} className="mx-auto text-[var(--assessment-primary)]" />
        <p className="mt-2 text-sm font-semibold text-[var(--assessment-on-surface)]">
          {uploading === 'assessment'
            ? 'Uploading…'
            : excelMode
              ? 'Slot A — Candidate problem sheet'
              : 'Choose a file or drag & drop it here'}
        </p>
        <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
          {excelMode
            ? 'Problem sheet · .xlsx or .pdf (Max 25 MB) — candidate downloads this'
            : 'Assessment document · .docx or .pdf (Max 25 MB)'}
        </p>
      </div>
      {choice.assessment_document ? (
        <div className="flex items-center gap-3 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2">
          <AssessmentMaterialIcon name="description" size={22} className="text-[var(--assessment-primary)]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--assessment-on-surface)]">
              {choice.assessment_document.filename}
            </p>
            <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
              {excelMode ? 'Candidate problem sheet' : 'Title, description, and checklist filled from this file'}
            </p>
          </div>
          <button
            type="button"
            className="text-xs font-bold text-red-600"
            onClick={() => onChange({ assessment_document: null })}
          >
            Remove
          </button>
        </div>
      ) : null}

      {excelMode ? (
        <>
          <div
            {...answerKeyDrop.getRootProps()}
            className={`cursor-pointer rounded-2xl border-2 border-dashed px-6 py-6 text-center transition ${
              answerKeyDrop.isDragActive
                ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5'
                : 'border-amber-300/80 bg-amber-50/40'
            } ${uploading === 'answer_key' ? 'opacity-60' : ''}`}
          >
            <input {...answerKeyDrop.getInputProps()} />
            <p className="text-sm font-semibold text-[var(--assessment-on-surface)]">
              {uploading === 'answer_key' ? 'Uploading…' : 'Slot B — Master answer key'}
            </p>
            <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
              .xlsx only · never sent to candidates (Max 25 MB)
            </p>
          </div>
          {choice.answer_key ? (
            <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2">
              <AssessmentMaterialIcon name="lock" size={22} className="text-amber-700" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-[var(--assessment-on-surface)]">
                  {choice.answer_key.filename}
                </p>
                <p className="text-[11px] font-semibold text-amber-800">Protected — hidden from candidates</p>
              </div>
              <button
                type="button"
                className="text-xs font-bold text-red-600"
                onClick={() => onChange({ answer_key: null })}
              >
                Remove
              </button>
            </div>
          ) : null}
        </>
      ) : null}

      {uploadError ? <p className="text-xs text-red-600">{uploadError}</p> : null}

      {!excelMode ? (
      <div className="space-y-2">
        <FieldLabel>Supporting datasets</FieldLabel>
        <div
          {...datasetDrop.getRootProps()}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center ${
            datasetDrop.isDragActive
              ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5'
              : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]'
          }`}
        >
          <input {...datasetDrop.getInputProps()} />
          <p className="text-sm font-semibold text-[var(--assessment-on-surface)]">
            {uploading === 'dataset' ? 'Uploading…' : 'Choose a dataset or drag & drop it here'}
          </p>
          <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">.sql, .csv, .json, .txt, .md (Max 25 MB)</p>
        </div>
        <ul className="space-y-1">
          {(choice.supporting_datasets ?? []).map((file) => (
            <li key={file.file_url} className="flex items-center gap-2 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-xs">
              <AssessmentMaterialIcon name="table" size={16} className="text-[var(--assessment-primary)]" />
              <span className="min-w-0 flex-1 truncate font-semibold">{file.filename}</span>
              <button
                type="button"
                className="font-bold text-red-600"
                onClick={() =>
                  onChange({
                    supporting_datasets: (choice.supporting_datasets ?? []).filter((item) => item.file_url !== file.file_url),
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1 sm:col-span-2">
          <FieldLabel>Title</FieldLabel>
          <input
            className={textInputClass()}
            value={choice.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="e.g. Classroom LMS with Teacher & Student roles"
          />
        </label>
        <label className="block space-y-1">
          <FieldLabel>Category</FieldLabel>
          <input
            className={textInputClass()}
            value={choice.category ?? ''}
            onChange={(e) => onChange({ category: e.target.value })}
            placeholder="Full-stack, Backend, Data…"
          />
        </label>
        <label className="block space-y-1">
          <FieldLabel>Difficulty</FieldLabel>
          <select
            className={textInputClass()}
            value={choice.difficulty ?? 'intermediate'}
            onChange={(e) => onChange({ difficulty: e.target.value as ProjectDifficulty })}
          >
            {(Object.keys(PROJECT_DIFFICULTY_LABELS) as ProjectDifficulty[]).map((d) => (
              <option key={d} value={d}>
                {PROJECT_DIFFICULTY_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <FieldLabel>Description (markdown)</FieldLabel>
        <textarea
          rows={6}
          className={`${textInputClass()} font-mono text-xs`}
          value={choice.description_md}
          onChange={(e) => onChange({ description_md: e.target.value })}
          placeholder={'### Objective\nBuild a classroom LMS where…'}
        />
      </label>

      {!excelMode ? (
      <div className="space-y-2">
        <FieldLabel>Must-have requirements</FieldLabel>
        {choice.must_have_requirements.map((r) => (
          <div key={r.id} className="flex items-center gap-2">
            <input
              className={`${textInputClass()} flex-1`}
              value={r.text}
              onChange={(e) =>
                onChange({
                  must_have_requirements: choice.must_have_requirements.map((x) =>
                    x.id === r.id ? { ...x, text: e.target.value } : x,
                  ),
                })
              }
            />
            <button
              type="button"
              onClick={() =>
                onChange({
                  must_have_requirements: choice.must_have_requirements.filter((x) => x.id !== r.id),
                })
              }
              className="text-[var(--assessment-on-surface-variant)] hover:text-red-600"
            >
              <AssessmentMaterialIcon name="close" size={18} />
            </button>
          </div>
        ))}
        <div className="flex gap-2">
          <input
            className={`${textInputClass()} flex-1`}
            placeholder="Add a requirement the repo must satisfy…"
            value={newReq}
            onChange={(e) => setNewReq(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addRequirement())}
          />
          <button
            type="button"
            onClick={addRequirement}
            className="flex items-center gap-1 rounded-lg bg-[var(--assessment-primary)] px-3 py-2 text-xs font-bold text-white"
          >
            <AssessmentMaterialIcon name="add_circle" size={16} />
            Add
          </button>
        </div>
      </div>
      ) : null}

      {documentPack ? (
      <GradingRubricEditor
        rubric={choice.grading_rubric}
        onChange={(grading_rubric) => onChange({ grading_rubric })}
      />
      ) : null}

      {githubMode ? (
      <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block space-y-1">
          <FieldLabel>Tech stack policy</FieldLabel>
          <select
            className={textInputClass()}
            value={choice.tech_stack.mode}
            onChange={(e) =>
              onChange({
                tech_stack: { ...choice.tech_stack, mode: e.target.value as ProjectTechStackMode },
              })
            }
          >
            {(Object.keys(PROJECT_TECH_MODE_LABELS) as ProjectTechStackMode[]).map((m) => (
              <option key={m} value={m}>
                {PROJECT_TECH_MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <FieldLabel>Languages / frameworks</FieldLabel>
          <ListInput
            disabled={choice.tech_stack.mode === 'free_choice'}
            value={choice.tech_stack.languages_frameworks}
            onChange={(languages_frameworks) =>
              onChange({ tech_stack: { ...choice.tech_stack, languages_frameworks } })
            }
            placeholder={choice.tech_stack.mode === 'free_choice' ? 'Any stack' : 'React, Node.js, MongoDB'}
          />
        </label>
      </div>

      <div className="space-y-2">
        <FieldLabel>Deliverables</FieldLabel>
        <div className="flex flex-wrap gap-4">
          {DELIVERABLE_LABELS.map((d) => (
            <label key={d.key} className="flex items-center gap-2 text-xs font-semibold">
              <input
                type="checkbox"
                checked={choice.deliverables[d.key]}
                onChange={(e) =>
                  onChange({ deliverables: { ...choice.deliverables, [d.key]: e.target.checked } })
                }
              />
              {d.label}
            </label>
          ))}
        </div>
      </div>
      </>
      ) : null}

      {/* Attached documents (one URL per line) commented out */}
      {/*
      <label className="block space-y-1">
        <FieldLabel>Attached documents (one URL per line)</FieldLabel>
        <textarea
          className={`${textInputClass()} min-h-[64px] font-mono text-xs`}
          value={(choice.attached_documents ?? []).join('\n')}
          onChange={(e) => onChange({ attached_documents: e.target.value.split('\n') })}
          onBlur={(e) =>
            onChange({
              attached_documents: e.target.value
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean),
            })
          }
          placeholder="https://…/api-spec.pdf"
        />
      </label>
      */}
    </div>
  );
}
