'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import {
  getFollowUpQuestions,
  getMcqOptions,
  getQuestionConstraints,
  getQuestionPromptForDisplay,
  getQuestionRequirements,
  getSampleTestCases,
  getSqlSchemaHint,
  getStarterCode,
  hasDatabaseSchema,
} from '@/modules/assessments/utils/extract-question-display';
import type { GenericQuestion } from '@/types/assessment-engine';

function typeLabel(type: string) {
  switch (type.toUpperCase()) {
    case 'CODING':
      return 'Coding';
    case 'MCQ':
      return 'Multiple choice';
    case 'SHORT_ANSWER':
      return 'Short answer';
    case 'SYSTEM_DESIGN':
      return 'System design';
    case 'INTERVIEW':
      return 'Interview';
    default:
      return type.replace(/_/g, ' ');
  }
}

function questionKind(type: string) {
  const t = type.toUpperCase();
  if (t === 'MCQ') return 'mcq';
  if (t === 'CODING') return 'coding';
  if (t === 'SYSTEM_DESIGN') return 'system_design';
  if (t === 'INTERVIEW') return 'interview';
  if (t === 'SHORT_ANSWER') return 'text';
  return 'other';
}

export function QuestionContextPanel({ question }: { question: GenericQuestion }) {
  const kind = questionKind(question.questionType);
  const prompt = getQuestionPromptForDisplay(question);
  const constraints = getQuestionConstraints(question);
  const requirements = getQuestionRequirements(question);
  const followUps = getFollowUpQuestions(question);
  const sampleTests = getSampleTestCases(question);
  const sqlSchema = getSqlSchemaHint(question);
  const starterCode = getStarterCode(question);
  const mcqOptions = getMcqOptions(question);
  const isSql = question.language?.toUpperCase() === 'SQL';
  const showSchema = hasDatabaseSchema(question);

  return (
    <div className="workspace-scroll h-full overflow-y-auto p-6">
      <div className="mb-4 flex flex-wrap gap-2">
        <span className="rounded-full bg-[var(--color-primary-fixed-dim,#93c5fd)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-[var(--color-on-primary-container)]">
          {typeLabel(question.questionType)}
        </span>
        {question.language ? (
          <span className="rounded-full bg-[var(--assessment-surface-container)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-[var(--assessment-on-surface-variant)]">
            {question.language}
          </span>
        ) : null}
        <span className="rounded-full bg-[var(--assessment-surface-container)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-[var(--assessment-on-surface-variant)]">
          {question.difficulty}
        </span>
        <span className="rounded-full bg-[var(--assessment-surface-container)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-[var(--assessment-on-surface-variant)]">
          {question.marks} marks
        </span>
        {question.estimatedDuration ? (
          <span className="rounded-full bg-[var(--assessment-surface-container)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-[var(--assessment-on-surface-variant)]">
            ~{question.estimatedDuration} min
          </span>
        ) : null}
      </div>

      <h2 className="mb-4 text-2xl font-semibold text-[var(--assessment-primary)]">{question.title}</h2>

      {kind === 'coding' && starterCode ? (
        <p className="mb-4 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--color-surface-container,#f1f5f9)] px-4 py-3 text-sm text-[var(--assessment-on-surface-variant)]">
          The starter code to debug is loaded in the editor on the right. Fix it there and run
          tests before submitting.
        </p>
      ) : null}

      {kind === 'mcq' ? (
        <p className="mb-4 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--color-surface-container,#f1f5f9)] px-4 py-3 text-sm text-[var(--assessment-on-surface-variant)]">
          Read the question below, then select one answer in the editor on the right.
        </p>
      ) : null}

      {prompt ? (
        <div className="mb-6 whitespace-pre-wrap text-base leading-7 text-[var(--assessment-on-surface-variant)]">
          {prompt}
        </div>
      ) : null}

      {kind === 'mcq' && mcqOptions.length > 0 ? (
        <section className="mb-6">
          <h3 className="mb-3 text-xs font-bold uppercase text-[var(--assessment-on-surface)]">
            Answer options
          </h3>
          <ul className="space-y-2">
            {mcqOptions.map((opt) => (
              <li
                key={opt.label}
                className="flex gap-3 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface)] px-4 py-3 text-sm"
              >
                <span className="shrink-0 font-bold text-[var(--assessment-primary)]">
                  {opt.label}.
                </span>
                <span className="text-[var(--assessment-on-surface-variant)]">{opt.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {requirements.length > 0 ? (
        <section className="mb-6">
          <h3 className="mb-2 text-xs font-bold uppercase text-[var(--assessment-on-surface)]">
            Requirements
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--assessment-on-surface-variant)]">
            {requirements.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {constraints.length > 0 ? (
        <section className="mb-6">
          <h3 className="mb-2 text-xs font-bold uppercase text-[var(--assessment-on-surface)]">
            Constraints
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--assessment-on-surface-variant)]">
            {constraints.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {followUps.length > 0 ? (
        <section className="mb-6">
          <h3 className="mb-2 text-xs font-bold uppercase text-[var(--assessment-on-surface)]">
            Topics to address
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--assessment-on-surface-variant)]">
            {followUps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {showSchema && sqlSchema ? (
        <section className="mb-6">
          <h3 className="mb-2 flex items-center gap-1 text-xs font-bold uppercase text-[var(--assessment-on-surface)]">
            <AssessmentMaterialIcon name="database" size={16} />
            Database tables &amp; sample data
          </h3>
          <p className="mb-3 text-sm text-[var(--assessment-on-surface-variant)]">
            {isSql
              ? 'These tables are set up for this question. Use them when writing your SQL query in the editor.'
              : 'Reference schema for this problem - use these table and column names in your solution.'}
          </p>
          <pre className="overflow-x-auto rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface)] p-4 font-mono text-xs leading-5">
            {sqlSchema}
          </pre>
        </section>
      ) : null}

      {kind === 'coding' ? (
        <div className="mb-6 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--color-surface-container,#f1f5f9)] p-4">
          <h3 className="mb-2 flex items-center gap-1 text-xs font-bold uppercase text-[var(--assessment-on-surface)]">
            <AssessmentMaterialIcon name="info" size={16} />
            How to answer
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--assessment-on-surface-variant)]">
            <li>
              Use <strong>{question.language ?? 'the required language'}</strong> in the editor.
            </li>
            {isSql ? (
              <li>
                {showSchema
                  ? 'Write a SQL query using the tables shown above.'
                  : 'Write a SQL query that satisfies the problem statement.'}
              </li>
            ) : (
              <li>Read input from stdin unless the problem states otherwise.</li>
            )}
            <li>Sample cases below are for practice; hidden cases are used for final scoring.</li>
          </ul>
        </div>
      ) : null}

      {kind === 'text' || kind === 'interview' || kind === 'system_design' ? (
        <div className="mb-6 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--color-surface-container,#f1f5f9)] p-4">
          <h3 className="mb-2 flex items-center gap-1 text-xs font-bold uppercase text-[var(--assessment-on-surface)]">
            <AssessmentMaterialIcon name="edit_note" size={16} />
            How to answer
          </h3>
          <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--assessment-on-surface-variant)]">
            {kind === 'system_design' ? (
              <>
                <li>Describe components, data flow, and trade-offs clearly.</li>
                <li>Cover scalability, reliability, and key APIs where relevant.</li>
              </>
            ) : kind === 'interview' ? (
              <>
                <li>Answer in your own words in the text editor on the right.</li>
                <li>Structure your response with examples from your experience where helpful.</li>
              </>
            ) : (
              <>
                <li>Type your answer in the text editor on the right.</li>
                <li>Be specific - include reasoning, steps, or corrected code/SQL if asked.</li>
              </>
            )}
          </ul>
        </div>
      ) : null}

      {sampleTests.length > 0 ? (
        <section className="space-y-4">
          <h3 className="text-xs font-bold uppercase text-[var(--assessment-on-surface)]">
            Sample test cases
          </h3>
          {sampleTests.map((tc, index) => (
            <div
              key={`${tc.input}-${index}`}
              className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface)] p-4 font-mono text-sm"
            >
              <p className="mb-2 text-xs font-bold uppercase text-[var(--assessment-on-surface-variant)]">
                Example {index + 1}
              </p>
              <div className="mb-2">
                <span className="text-[var(--assessment-on-surface-variant)]">Input:</span>
                <pre className="mt-1 whitespace-pre-wrap break-all text-[var(--assessment-primary)]">
                  {tc.input || '-'}
                </pre>
              </div>
              {tc.expectedOutput && !tc.isHidden ? (
                <div>
                  <span className="text-[var(--assessment-on-surface-variant)]">Expected output:</span>
                  <pre className="mt-1 whitespace-pre-wrap break-all text-[var(--assessment-on-surface)]">
                    {tc.expectedOutput}
                  </pre>
                </div>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}
    </div>
  );
}
