'use client';

import { useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { StatusBadge } from '@/modules/assessments/components/StatusBadge';
import type { RunCodeResponse, SubmitAnswerResponse } from '@/types/assessments';

export function OutputConsole(props: {
  input: string;
  onInputChange: (value: string) => void;
  onRun: () => void;
  onRunTestCases?: () => void;
  onSubmitNext?: () => void;
  isLastQuestion?: boolean;
  running: boolean;
  submittingAnswer?: boolean;
  readOnly?: boolean;
  inputLabel?: string;
  inputPlaceholder?: string;
  showSetupInput?: boolean;
  variant?: 'coding' | 'text';
  result: RunCodeResponse | null;
  evaluation: SubmitAnswerResponse | null;
  error: string | null;
  submitError: string | null;
  passedTests?: number;
  totalTests?: number;
}) {
  const [tab, setTab] = useState<'console' | 'tests'>('console');
  const isText = props.variant === 'text';
  const testsLabel =
    props.totalTests != null
      ? `TESTS (${props.passedTests ?? 0}/${props.totalTests})`
      : 'TESTS';

  return (
    <div className="workspace-console-panel flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]">
        {!isText ? (
          <>
            <button
              type="button"
              onClick={() => setTab('console')}
              className={`flex-1 px-4 py-3 text-xs font-bold tracking-wide ${
                tab === 'console'
                  ? 'border-b-2 border-[var(--assessment-primary)] text-[var(--assessment-primary)]'
                  : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-high)]'
              }`}
            >
              CONSOLE
            </button>
            <button
              type="button"
              onClick={() => setTab('tests')}
              className={`flex-1 px-4 py-3 text-xs font-bold tracking-wide ${
                tab === 'tests'
                  ? 'border-b-2 border-[var(--assessment-primary)] text-[var(--assessment-primary)]'
                  : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-high)]'
              }`}
            >
              {testsLabel}
            </button>
          </>
        ) : (
          <div className="flex-1 px-4 py-3 text-xs font-bold tracking-wide text-[var(--assessment-primary)]">
            ANSWER STATUS
          </div>
        )}
      </div>

      {props.showSetupInput && tab === 'console' ? (
        <div className="shrink-0 border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-3">
          <label className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            {props.inputLabel ?? 'Setup SQL'}
          </label>
          <textarea
            value={props.input}
            onChange={(e) => props.onInputChange(e.target.value)}
            disabled={props.readOnly}
            rows={4}
            className="w-full rounded-lg border border-[var(--assessment-outline-variant)] p-2 font-mono text-xs disabled:opacity-60"
            placeholder={props.inputPlaceholder}
          />
        </div>
      ) : null}

      <div className="workspace-scroll min-h-0 flex-1 overflow-y-auto p-3">
        {isText || tab === 'console' ? (
          <div className="workspace-console-output m-1 min-h-[200px] flex-1 rounded-lg p-4 shadow-inner">
            {isText ? (
              <>
                {props.evaluation ? (
                  <div className="space-y-3 font-mono text-[13px]">
                    <div className="flex items-center gap-2">
                      <AssessmentMaterialIcon name="check_circle" size={14} className="text-green-500" />
                      <span className="font-mono text-xs font-bold text-green-500">ANSWER SAVED</span>
                    </div>
                    <p className="text-white/70">
                      Your response is stored and will be reviewed manually. Use Submit &amp; Next to
                      continue.
                    </p>
                    <StatusBadge status={props.evaluation.status} />
                  </div>
                ) : (
                  <div className="space-y-3 font-mono text-[13px]">
                    <div className="text-white/40">
                      <span className="text-blue-400">codevox@assessment:~$</span> write --answer
                    </div>
                    <div className="border-l-2 border-white/10 pl-3 italic text-white/60">
                      Type your answer in the editor, then click Save Answer.
                    </div>
                  </div>
                )}
              </>
            ) : null}

            {!isText && !props.result && !props.error && !props.submitError ? (
              <>
                <div className="mb-4 flex items-center gap-2">
                  <AssessmentMaterialIcon name="terminal" size={14} className="text-green-500" />
                  <span className="font-mono text-xs font-bold text-green-500">READY TO EXECUTE</span>
                </div>
                <div className="space-y-3 font-mono text-[13px]">
                  <div className="text-white/40">
                    <span className="text-blue-400">codevox@assessment:~$</span> run --preview
                  </div>
                  <div className="border-l-2 border-white/10 pl-3 italic text-white/60">
                    Press &quot;Run Code&quot; to view output here or &quot;Run Test Cases&quot; for
                    automated validation.
                  </div>
                </div>
              </>
            ) : null}

            {!isText && props.error ? (
              <pre className="whitespace-pre-wrap font-mono text-sm text-red-400">{props.error}</pre>
            ) : null}
            {props.submitError ? (
              <pre className="mt-2 whitespace-pre-wrap font-mono text-sm text-red-400">
                {props.submitError}
              </pre>
            ) : null}

            {!isText && props.result ? (
              <div className="space-y-2 font-mono text-[13px]">
                <div className="text-white/40">
                  <span className="text-blue-400">codevox@assessment:~$</span> run
                  <span className="ml-2 text-white/30">
                    ({props.result.executionTime}ms
                    {props.result.timedOut ? ', timed out' : ''})
                  </span>
                </div>
                {props.result.stdout ? (
                  <pre className="whitespace-pre-wrap text-white/90">{props.result.stdout}</pre>
                ) : null}
                {props.result.stderr ? (
                  <pre className="whitespace-pre-wrap text-red-300">{props.result.stderr}</pre>
                ) : null}
                {!props.result.stdout && !props.result.stderr ? (
                  <span className="text-white/50">No output</span>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-4 p-1">
            {props.evaluation ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">Latest evaluation</p>
                    <StatusBadge status={props.evaluation.status} />
                  </div>
                  <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
                    Score: {props.evaluation.score} | {props.evaluation.passedTests}/
                    {props.evaluation.totalTests} passed ({props.evaluation.percentage.toFixed(0)}%)
                  </p>
                  <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                    Execution time: {props.evaluation.executionTime}ms
                  </p>
                </div>
                {props.evaluation.evaluationReview ? (
                  <div className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4 text-sm">
                    <p className="font-semibold">AI review</p>
                    {props.evaluation.evaluationReview.strengths?.length ? (
                      <div className="mt-2">
                        <p className="text-xs font-bold uppercase text-green-700">Strengths</p>
                        <ul className="mt-1 list-disc pl-5 text-[var(--assessment-on-surface-variant)]">
                          {props.evaluation.evaluationReview.strengths.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {props.evaluation.evaluationReview.weaknesses?.length ? (
                      <div className="mt-2">
                        <p className="text-xs font-bold uppercase text-red-700">Weaknesses</p>
                        <ul className="mt-1 list-disc pl-5 text-[var(--assessment-on-surface-variant)]">
                          {props.evaluation.evaluationReview.weaknesses.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {props.evaluation.evaluationReview.recommendations?.length ? (
                      <div className="mt-2">
                        <p className="text-xs font-bold uppercase text-[var(--assessment-primary)]">
                          Recommendations
                        </p>
                        <ul className="mt-1 list-disc pl-5 text-[var(--assessment-on-surface-variant)]">
                          {props.evaluation.evaluationReview.recommendations.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {props.evaluation.cases?.map((testCase) => (
                  <div
                    key={testCase.index}
                    className={`rounded-lg border p-3 text-xs ${
                      testCase.passed
                        ? 'border-green-200 bg-green-50'
                        : 'border-red-200 bg-red-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      <span>
                        Test {testCase.index}
                        {testCase.hidden ? ' (hidden)' : ''}
                      </span>
                      <span className={testCase.passed ? 'text-green-700' : 'text-red-700'}>
                        {testCase.passed ? 'PASSED' : 'FAILED'}
                      </span>
                    </div>
                    {!testCase.hidden && testCase.input ? (
                      <p className="mt-2 text-[var(--assessment-on-surface-variant)]">
                        Input: <code className="font-mono">{testCase.input}</code>
                      </p>
                    ) : null}
                    {!testCase.hidden && testCase.expectedOutput ? (
                      <p className="mt-1 text-[var(--assessment-on-surface-variant)]">
                        Expected: <code className="font-mono">{testCase.expectedOutput}</code>
                      </p>
                    ) : null}
                    {testCase.hidden && !testCase.passed ? (
                      <p className="mt-2 text-[var(--assessment-on-surface-variant)]">
                        Hidden test failed. Ensure your code reads from stdin for every run.
                      </p>
                    ) : null}
                    <p className="mt-1 text-[var(--assessment-on-surface-variant)]">
                      Your output:{' '}
                      <code className="font-mono whitespace-pre-wrap">
                        {testCase.stdout.trim() || '(empty)'}
                      </code>
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 text-center text-sm text-[var(--assessment-on-surface-variant)]">
                Run Test Cases to validate against hidden and visible test cases.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 space-y-2 border-t border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-3">
        {!isText ? (
          <button
            type="button"
            disabled={props.running || props.readOnly}
            onClick={props.onRun}
            className="flex w-full items-center justify-center gap-1 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] py-2.5 text-xs font-bold text-[var(--assessment-on-surface-variant)] transition-all hover:bg-[var(--assessment-surface-container)] disabled:opacity-60"
          >
            <AssessmentMaterialIcon name="play_arrow" size={20} />
            Run Code
          </button>
        ) : null}
        <button
          type="button"
          disabled={props.submittingAnswer || props.readOnly}
          onClick={props.onRunTestCases}
          className="flex w-full items-center justify-center gap-1 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] py-2.5 text-xs font-bold text-[var(--assessment-on-surface-variant)] transition-all hover:bg-[var(--assessment-surface-container-highest,#e2e8f0)] disabled:opacity-60"
        >
          <AssessmentMaterialIcon name={isText ? 'save' : 'checklist'} size={20} />
          {props.submittingAnswer
            ? isText
              ? 'Saving...'
              : 'Evaluating...'
            : isText
              ? 'Save Answer'
              : 'Run Test Cases'}
        </button>
        <button
          type="button"
          disabled={props.submittingAnswer || props.readOnly}
          onClick={props.onSubmitNext}
          className="flex w-full items-center justify-center gap-1 rounded-lg bg-[var(--assessment-primary)] py-3 text-xs font-bold text-white shadow-md transition-all hover:bg-[#295bb5] active:scale-[0.98] disabled:opacity-60"
        >
          <AssessmentMaterialIcon name="rocket_launch" size={20} className="text-white" />
          {props.isLastQuestion ? 'Submit Assessment' : 'Submit & Next'}
        </button>
      </div>
    </div>
  );
}
