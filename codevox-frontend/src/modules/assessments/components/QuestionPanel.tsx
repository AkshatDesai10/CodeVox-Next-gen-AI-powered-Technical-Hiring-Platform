'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type { AssessmentQuestionDto } from '@/types/assessments';

function typeBadgeLabel(type: string) {
  if (type === 'CODING') return 'Backend';
  if (type === 'SHORT_ANSWER') return 'Theory';
  return type.replace('_', ' ');
}

export function QuestionPanel(props: { question: AssessmentQuestionDto }) {
  const { question } = props;

  return (
    <div className="workspace-scroll flex h-full flex-col overflow-y-auto p-6">
      <div className="mb-6 flex items-center gap-2">
        <span className="rounded-full bg-[var(--color-primary-fixed-dim,#93c5fd)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-[var(--color-on-primary-container)]">
          {typeBadgeLabel(question.questionType)}
        </span>
        <span className="rounded-full bg-[var(--assessment-surface-container)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-[var(--assessment-on-surface-variant)]">
          {question.difficulty}
        </span>
        <span className="rounded-full bg-[var(--assessment-surface-container)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight text-[var(--assessment-on-surface-variant)]">
          {question.marks} marks
        </span>
      </div>

      <h2 className="mb-4 text-2xl font-semibold text-[var(--assessment-primary)]">
        {question.title}
      </h2>

      <div className="space-y-4 text-[var(--assessment-on-surface-variant)]">
        <p className="whitespace-pre-wrap text-base leading-6">{question.description}</p>

        <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--color-surface-container,#f1f5f9)] p-4">
          <h3 className="mb-2 flex items-center gap-1 text-xs font-bold uppercase text-[var(--assessment-on-surface)]">
            <AssessmentMaterialIcon name="info" size={16} />
            Constraints
          </h3>
          <p className="text-sm opacity-80">
            Memory limit: 128MB. Time limit per execution: 5 seconds. Read input from stdin
            (sample inputs are shown below). Run your code, then use Run Test Cases - hidden
            tests use different stdin.
          </p>
        </div>

        {question.testCases.length > 0 ? (
          <div className="space-y-4 pt-2">
            {question.testCases.map((tc, index) => (
              <div key={tc.id}>
                <h3 className="mb-2 text-xs font-bold uppercase text-[var(--assessment-on-surface)]">
                  Test Case {index + 1}
                  {index === 0 ? ': Standard Flow' : ''}
                </h3>
                <div className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface)] p-4 font-mono text-sm">
                  <div className="mb-2 flex justify-between gap-4">
                    <span className="opacity-60">Input:</span>
                    <span className="text-right font-bold text-[var(--assessment-primary)]">
                      {tc.input}
                    </span>
                  </div>
                  <div className="flex justify-between gap-4">
                    <span className="opacity-60">Expected:</span>
                    <span className="text-right font-bold text-[var(--assessment-on-surface)]">
                      {tc.expectedOutput}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
