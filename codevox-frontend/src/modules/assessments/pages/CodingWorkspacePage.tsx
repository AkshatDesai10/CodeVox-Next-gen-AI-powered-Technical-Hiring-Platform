'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAssessmentAttempt,
  runAssessmentCode,
  saveAssessmentDraft,
  startAssessment,
  submitAssessment,
  submitAssessmentAnswer,
  respondInterview,
} from '@/lib/assessments-api';
import { McqEditor } from '@/modules/assessments/components/McqEditor';
import { SystemDesignPanel } from '@/modules/assessments/components/SystemDesignPanel';
import { InterviewQuestionPanel } from '@/modules/assessments/components/InterviewQuestionPanel';
import { QuestionContextPanel } from '@/modules/assessments/components/dynamic/QuestionContextPanel';
import { getMcqOptions, getStarterCode } from '@/modules/assessments/utils/extract-question-display';
import { assessmentQuestionToGeneric } from '@/modules/assessments/utils/assessment-question-adapter';
import { normalizeAssessmentQuestions } from '@/modules/assessments/utils/normalize-questions';
import { AssessmentTimer } from '@/modules/assessments/components/AssessmentTimer';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { CodingEditor } from '@/modules/assessments/components/CodingEditor';
import { IdeWorkspace } from '@/modules/assessments/components/ide/IdeWorkspace';
import { OutputConsole } from '@/modules/assessments/components/OutputConsole';
import {
  hasMeaningfulSource,
  shouldUseIdeWorkspace,
} from '@/lib/workspace-api';
import { TextAnswerEditor } from '@/modules/assessments/components/TextAnswerEditor';
import type { RunCodeResponse, SubmitAnswerResponse } from '@/types/assessments';
import '@/modules/assessments/styles/workspace.css';

const DEFAULT_SQL_SETUP = `CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT NOT NULL,
  salary INTEGER NOT NULL
);
INSERT INTO employees (id, name, dept, salary) VALUES
  (1, 'Alice', 'Eng', 9000),
  (2, 'Bob', 'Eng', 8500),
  (3, 'Carol', 'Eng', 8500),
  (4, 'Dave', 'Sales', 7000),
  (5, 'Eve', 'Sales', 6500)`;

function isExecutableSqlSetup(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^[a-zA-Z_][a-zA-Z0-9_]*\s*\([^)]*\)\s*$/.test(trimmed)) return false;
  return /^(CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|WITH|PRAGMA|BEGIN|COMMIT|--|\/\*)/i.test(
    trimmed,
  );
}

function customInputForQuestion(language: string, testCaseInput?: string) {
  if (language.toUpperCase() === 'SQL') {
    if (testCaseInput && isExecutableSqlSetup(testCaseInput)) return testCaseInput;
    return DEFAULT_SQL_SETUP;
  }
  return testCaseInput ?? '';
}

function isCodingQuestion(questionType: string | undefined) {
  const t = (questionType ?? 'CODING').toUpperCase();
  return t === 'CODING';
}

function isMcqQuestion(questionType: string | undefined) {
  return (questionType ?? '').toUpperCase() === 'MCQ';
}

function defaultCode(language: string) {
  const key = language.toUpperCase();
  if (key === 'PHP') {
    return "<?php\n$input = trim(stream_get_contents(STDIN));\necho $input;\n";
  }
  if (key === 'PYTHON') {
    return `import ast
import sys

raw = sys.stdin.read().strip()
arr_part, target_part = raw.rsplit(',', 1)
nums = ast.literal_eval(arr_part.strip())
target = int(target_part.strip())

# Return all index pairs whose values sum to target.
pairs = []
seen = {}
for i, num in enumerate(nums):
    complement = target - num
    if complement in seen:
        for j in seen[complement]:
            pairs.append([j, i])
    seen.setdefault(num, []).append(i)

print(pairs)
`;
  }
  if (key === 'SQL') {
    return `SELECT e.*
FROM employees e
WHERE salary = (
    SELECT MAX(salary)
    FROM employees e2
    WHERE e2.dept = e.dept
      AND e2.salary < (
          SELECT MAX(salary)
          FROM employees e3
          WHERE e3.dept = e.dept
      )
);`;
  }
  return "const fs = require('fs');\nconst input = fs.readFileSync(0, 'utf8').trim();\nconsole.log(input);\n";
}

function isQuestionGraded(status: string | undefined) {
  return Boolean(status && status !== 'PENDING' && status !== 'RUNNING');
}

function questionNavClass(status: string | undefined, active: boolean) {
  if (active) {
    return 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)] text-white shadow-sm';
  }
  switch (status?.toUpperCase()) {
    case 'PASSED':
      return 'border-green-200 bg-green-100 text-green-700';
    case 'PARTIAL':
      return 'border-amber-200 bg-amber-100 text-amber-800';
    case 'FAILED':
    case 'ERROR':
      return 'border-red-200 bg-red-100 text-red-700';
    default:
      return 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container)]';
  }
}

export function CodingWorkspacePageContent({
  candidateId,
  candidateAssessmentId,
  embedded = false,
}: {
  candidateId: string;
  candidateAssessmentId: string;
  embedded?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeIndex, setActiveIndex] = useState(0);
  const [codeByQuestion, setCodeByQuestion] = useState<Record<string, string>>({});
  const [languageByQuestion, setLanguageByQuestion] = useState<Record<string, string>>({});
  const [customInputByQuestion, setCustomInputByQuestion] = useState<Record<string, string>>(
    {},
  );
  const activeQuestionIdRef = useRef<string | null>(null);
  const [runResult, setRunResult] = useState<RunCodeResponse | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [evaluationByQuestion, setEvaluationByQuestion] = useState<
    Record<string, SubmitAnswerResponse>
  >({});
  const [submitAnswerError, setSubmitAnswerError] = useState<string | null>(null);
  const [navExpanded, setNavExpanded] = useState(true);

  const { data, isLoading, error } = useQuery({
    queryKey: ['assessment-attempt', candidateAssessmentId],
    queryFn: async () => {
      const attempt = (await getAssessmentAttempt(candidateAssessmentId)).data;
      let questions = normalizeAssessmentQuestions(attempt.questions);

      if (!questions.length && attempt.candidateId && attempt.assessment?.id) {
        const started = (
          await startAssessment(attempt.candidateId, attempt.assessment.id)
        ).data;
        questions = normalizeAssessmentQuestions(started.questions);
        return { ...attempt, ...started, questions };
      }

      return { ...attempt, questions };
    },
  });

  const questions = data?.questions ?? [];
  const activeQuestion = questions[activeIndex];
  const readOnly = data?.status === 'SUBMITTED' || data?.status === 'GRADED';

  const submissionByQuestion = useMemo(() => {
    const map = new Map<
      string,
      { questionId: string; status: string; language: string; sourceCode: string }
    >();
    for (const submission of data?.submissions ?? []) {
      map.set(submission.questionId, submission);
    }
    return map;
  }, [data?.submissions]);

  const activeLanguage = useMemo(() => {
    if (!activeQuestion) return 'PYTHON';
    return (
      languageByQuestion[activeQuestion.id] ??
      activeQuestion.language?.toUpperCase() ??
      'PYTHON'
    );
  }, [activeQuestion, languageByQuestion]);

  const activeCustomInput = useMemo(() => {
    if (!activeQuestion) return '';
    const stored = customInputByQuestion[activeQuestion.id];
    if (stored !== undefined) return stored;
    return customInputForQuestion(activeLanguage, activeQuestion.testCases[0]?.input);
  }, [activeLanguage, activeQuestion, customInputByQuestion]);

  const activeCode = useMemo(() => {
    if (!activeQuestion) return '';
    const stored = codeByQuestion[activeQuestion.id];
    if (hasMeaningfulSource(stored)) return stored!;
    if (!isCodingQuestion(activeQuestion.questionType)) return stored ?? '';
    const starter = getStarterCode(assessmentQuestionToGeneric(activeQuestion));
    return starter || defaultCode(activeLanguage);
  }, [activeLanguage, activeQuestion, codeByQuestion]);

  const activeSubmitLanguage = useMemo(() => {
    if (!activeQuestion) return 'TEXT';
    if (isMcqQuestion(activeQuestion.questionType)) return 'MCQ';
    return isCodingQuestion(activeQuestion.questionType) ? activeLanguage : 'TEXT';
  }, [activeLanguage, activeQuestion]);

  const activeEvaluation =
    activeQuestion != null ? evaluationByQuestion[activeQuestion.id] ?? null : null;

  const useIde = activeQuestion
    ? shouldUseIdeWorkspace(activeLanguage, activeQuestion.questionType)
    : false;

  const handleIdeSerializedChange = useCallback(
    (serialized: string) => {
      if (!activeQuestion) return;
      setCodeByQuestion((prev) => {
        if (prev[activeQuestion.id] === serialized) return prev;
        return { ...prev, [activeQuestion.id]: serialized };
      });
    },
    [activeQuestion],
  );

  const gradedCount = useMemo(() => {
    return questions.filter((q) => {
      const status = submissionByQuestion.get(q.id)?.status ?? evaluationByQuestion[q.id]?.status;
      return status && status !== 'PENDING' && status !== 'RUNNING';
    }).length;
  }, [evaluationByQuestion, questions, submissionByQuestion]);

  useEffect(() => {
    if (!data) return;
    setLanguageByQuestion((prev) => {
      const next = { ...prev };
      for (const question of data.questions) {
        const submission = data.submissions.find((s) => s.questionId === question.id);
        next[question.id] =
          submission?.language ?? question.language?.toUpperCase() ?? 'PYTHON';
      }
      return next;
    });
    setCodeByQuestion((prev) => {
      const next = { ...prev };
      for (const question of data.questions) {
        const submission = data.submissions.find((s) => s.questionId === question.id);
        const coding = isCodingQuestion(question.questionType);
        const generic = assessmentQuestionToGeneric(question);
        const lang =
          submission?.language ?? question.language?.toUpperCase() ?? 'PYTHON';
        const submissionCode = submission?.sourceCode;
        const starter =
          coding ? getStarterCode(generic) || defaultCode(lang) : '';
        if (hasMeaningfulSource(submissionCode)) {
          next[question.id] = submissionCode!;
        } else if (!(question.id in next)) {
          next[question.id] = starter;
        }
      }
      return next;
    });
  }, [data]);

  useEffect(() => {
    if (activeQuestion) activeQuestionIdRef.current = activeQuestion.id;
  }, [activeQuestion?.id]);

  useEffect(() => {
    if (!data?.questions?.length || !activeQuestionIdRef.current) return;
    const idx = data.questions.findIndex((q) => q.id === activeQuestionIdRef.current);
    if (idx >= 0) setActiveIndex((current) => (current === idx ? current : idx));
  }, [data?.questions]);

  useEffect(() => {
    if (!activeQuestion || readOnly) return;
    const timer = window.setTimeout(() => {
      void saveAssessmentDraft({
        candidate_assessment_id: candidateAssessmentId,
        question_id: activeQuestion.id,
        language: activeSubmitLanguage,
        source_code: activeCode,
      }).catch(() => undefined);
    }, 7000);
    return () => window.clearTimeout(timer);
  }, [activeCode, activeSubmitLanguage, activeQuestion, candidateAssessmentId, readOnly]);

  const runMutation = useMutation({
    mutationFn: () => {
      const question = activeQuestion!;
      const lang = activeLanguage.toUpperCase();
      const input =
        lang === 'SQL' && isExecutableSqlSetup(activeCustomInput)
          ? activeCustomInput
          : undefined;
      return runAssessmentCode({
        question_id: question.id,
        language: activeLanguage,
        source_code: activeCode,
        input,
      });
    },
    onSuccess: (response) => {
      setRunResult(response.data);
      setRunError(null);
    },
    onError: (err) => {
      setRunError(String(err));
      setRunResult(null);
    },
  });

  const submitAnswerMutation = useMutation({
    mutationFn: () =>
      submitAssessmentAnswer({
        candidate_assessment_id: candidateAssessmentId,
        question_id: activeQuestion!.id,
        language: activeSubmitLanguage,
        source_code: activeCode,
      }),
    onSuccess: (response) => {
      setEvaluationByQuestion((prev) => ({
        ...prev,
        [activeQuestion!.id]: response.data,
      }));
      setSubmitAnswerError(null);
      void queryClient.invalidateQueries({
        queryKey: ['assessment-attempt', candidateAssessmentId],
      });
    },
    onError: (err) => {
      setSubmitAnswerError(String(err));
    },
  });

  const submitMutation = useMutation({
    mutationFn: () => submitAssessment(candidateAssessmentId),
    onSuccess: () => {
      router.push(
        `/assessments/candidate/${candidateId}/attempt/${candidateAssessmentId}/result`,
      );
    },
  });

  const submitCurrentAnswer = async () => {
    if (!activeQuestion || !activeCode.trim()) return null;
    const status =
      evaluationByQuestion[activeQuestion.id]?.status ??
      submissionByQuestion.get(activeQuestion.id)?.status;
    if (isQuestionGraded(status)) return null;
    const response = await submitAssessmentAnswer({
      candidate_assessment_id: candidateAssessmentId,
      question_id: activeQuestion.id,
      language: activeSubmitLanguage,
      source_code: activeCode,
    });
    setEvaluationByQuestion((prev) => ({
      ...prev,
      [activeQuestion.id]: response.data,
    }));
    setSubmitAnswerError(null);
    void queryClient.invalidateQueries({
      queryKey: ['assessment-attempt', candidateAssessmentId],
    });
    return response.data;
  };

  const finalizeAssessment = async () => {
    if (!window.confirm('Submit assessment? You cannot change answers after submit.')) {
      return;
    }
    await submitMutation.mutateAsync();
  };

  const handleHeaderSubmit = async () => {
    if (readOnly || submitMutation.isPending) return;
    try {
      setSubmitAnswerError(null);
      await saveCurrentDraft();
      await submitCurrentAnswer();
      await finalizeAssessment();
    } catch (err) {
      setSubmitAnswerError(String(err));
    }
  };

  const saveCurrentDraft = async () => {
    if (!activeQuestion || readOnly) return;
    await saveAssessmentDraft({
      candidate_assessment_id: candidateAssessmentId,
      question_id: activeQuestion.id,
      language: activeSubmitLanguage,
      source_code: activeCode,
    }).catch(() => undefined);
  };

  const goToQuestion = async (index: number) => {
    if (index < 0 || index >= questions.length || index === activeIndex) return;
    await saveCurrentDraft();
    setActiveIndex(index);
    setRunResult(null);
    setRunError(null);
    setSubmitAnswerError(null);
  };

  const handleRunTestCases = async () => {
    await saveCurrentDraft();
    submitAnswerMutation.mutate();
  };

  const handleSubmitNext = async () => {
    await saveCurrentDraft();
    try {
      setSubmitAnswerError(null);
      if (activeCode.trim()) {
        const response = await submitAnswerMutation.mutateAsync();
        setEvaluationByQuestion((prev) => ({
          ...prev,
          [activeQuestion!.id]: response.data,
        }));
      }
      if (activeIndex < questions.length - 1) {
        await goToQuestion(activeIndex + 1);
        return;
      }
      await finalizeAssessment();
    } catch (err) {
      setSubmitAnswerError(String(err));
    }
  };

  const handleInterviewSave = async () => {
    if (!activeQuestion || readOnly) return;
    await saveCurrentDraft();
    await respondInterview({
      candidate_assessment_id: candidateAssessmentId,
      question_id: activeQuestion.id,
      transcript: activeCode,
    });
  };

  if (isLoading) {
    return (
      <div
        className={`flex items-center justify-center bg-[var(--assessment-surface)] ${embedded ? 'h-full' : 'h-screen'}`}
      >
        Loading workspace...
      </div>
    );
  }
  if (error || !data) {
    return (
      <div
        className={`flex items-center justify-center text-red-600 ${embedded ? 'h-full' : 'h-screen'}`}
      >
        Failed to load assessment workspace.
      </div>
    );
  }
  if (!activeQuestion) {
    return (
      <div
        className={`flex items-center justify-center text-red-600 ${embedded ? 'h-full' : 'h-screen'}`}
      >
        No questions found for this assessment.
      </div>
    );
  }

  const isSql = activeLanguage.toUpperCase() === 'SQL';
  const isCoding = isCodingQuestion(activeQuestion.questionType);
  const isMcq = isMcqQuestion(activeQuestion.questionType);
  const isInterview = activeQuestion.questionType?.toUpperCase() === 'INTERVIEW';
  const isSystemDesign = activeQuestion.questionType?.toUpperCase() === 'SYSTEM_DESIGN';
  const activeGeneric = assessmentQuestionToGeneric(activeQuestion);
  const mcqOptions = getMcqOptions(activeGeneric);
  const isLastQuestion = activeIndex === questions.length - 1;
  const evalPassed = activeEvaluation?.passedTests;
  const evalTotal = activeEvaluation?.totalTests;

  return (
    <div
      className={`workspace-shell flex flex-col bg-[var(--assessment-surface)] ${
        embedded ? 'h-full min-h-0' : ''
      }`}
    >
      {!embedded ? (
        <header className="flex h-14 shrink-0 items-center justify-between bg-[var(--assessment-primary)] px-4 text-white shadow-md">
          <div className="flex min-w-0 items-center gap-6">
            <h1 className="shrink-0 text-lg font-bold">Candidate Assessment</h1>
            <div className="hidden h-6 w-px bg-white/20 sm:block" />
            <div className="hidden min-w-0 items-center gap-2 sm:flex">
              <span className="text-xs font-semibold uppercase tracking-wider opacity-80">
                Title:
              </span>
              <span className="truncate text-sm font-semibold">{data.assessment.title}</span>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4">
              <div className="hidden items-center gap-1 text-white/90 sm:flex">
                <AssessmentMaterialIcon name="assignment" size={20} className="text-white" />
                <span className="text-xs font-semibold">
                  Progress: {Math.max(activeIndex + 1, gradedCount)}/{questions.length}
                </span>
              </div>
              <AssessmentTimer
                variant="header"
                durationMinutes={data.assessment.durationMinutes}
                startedAt={data.startedAt}
              />
            </div>
            <div className="flex items-center border-l border-white/20 pl-4">
              <button
                type="button"
                disabled={
                  readOnly ||
                  submitMutation.isPending ||
                  submitAnswerMutation.isPending
                }
                title="Submit assessment for grading"
                onClick={() => void handleHeaderSubmit()}
                className="rounded-lg bg-[var(--assessment-surface-container)] px-6 py-1.5 text-xs font-bold text-[var(--assessment-primary)] transition-all hover:bg-[var(--assessment-on-primary-container)] active:scale-95 disabled:opacity-60"
              >
                {submitMutation.isPending ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </header>
      ) : null}

      <main className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="relative flex min-h-0 w-[30%] min-w-[280px] flex-col border-r border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]">
          <div className={`min-h-0 flex-1 ${navExpanded ? 'pb-44' : 'pb-12'}`}>
            <QuestionContextPanel question={activeGeneric} />
          </div>

          <footer className="absolute inset-x-0 bottom-0 z-40 border-t border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]">
            <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)]/50 px-4 py-2">
              <span className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                Question Navigator
              </span>
              <button
                type="button"
                onClick={() => setNavExpanded((v) => !v)}
                className="text-[var(--assessment-on-surface-variant)]"
                aria-label={navExpanded ? 'Collapse navigator' : 'Expand navigator'}
              >
                <AssessmentMaterialIcon
                  name={navExpanded ? 'keyboard_arrow_down' : 'keyboard_arrow_up'}
                  size={18}
                />
              </button>
            </div>
            {navExpanded ? (
              <div className="grid max-h-36 grid-cols-5 gap-2 overflow-y-auto p-4">
                {questions.map((question, index) => {
                  const status =
                    evaluationByQuestion[question.id]?.status ??
                    submissionByQuestion.get(question.id)?.status;
                  return (
                    <button
                      key={question.id}
                      type="button"
                      onClick={() => void goToQuestion(index)}
                      className={`workspace-question-nav-square flex items-center justify-center rounded-lg border text-xs font-bold ${questionNavClass(
                        status,
                        index === activeIndex,
                      )}`}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </footer>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-[1_1_50%] flex-col border-r border-black/10">
          {isCoding && useIde ? (
            <IdeWorkspace
              key={activeQuestion.id}
              candidateAssessmentId={candidateAssessmentId}
              language={activeLanguage}
              initialSource={activeCode}
              readOnly={readOnly}
              running={runMutation.isPending}
              onRun={() => runMutation.mutate()}
              onSerializedChange={handleIdeSerializedChange}
            />
          ) : isCoding ? (
            <CodingEditor
              language={activeLanguage}
              value={activeCode}
              readOnly={readOnly}
              running={runMutation.isPending}
              autosaveEnabled={!readOnly}
              onRun={() => runMutation.mutate()}
              onLanguageChange={(language) => {
                if (!activeQuestion) return;
                setLanguageByQuestion((prev) => ({ ...prev, [activeQuestion.id]: language }));
                if (language.toUpperCase() === 'SQL' && activeQuestion) {
                  setCustomInputByQuestion((prev) => {
                    const current = prev[activeQuestion.id];
                    return {
                      ...prev,
                      [activeQuestion.id]: isExecutableSqlSetup(current ?? '')
                        ? (current ?? '')
                        : DEFAULT_SQL_SETUP,
                    };
                  });
                }
              }}
              onChange={(value) => {
                if (!activeQuestion) return;
                setCodeByQuestion((prev) => ({ ...prev, [activeQuestion.id]: value }));
              }}
            />
          ) : isMcq ? (
            <McqEditor
              options={mcqOptions}
              value={activeCode}
              readOnly={readOnly}
              onChange={(value) => {
                if (!activeQuestion) return;
                setCodeByQuestion((prev) => ({ ...prev, [activeQuestion.id]: value }));
              }}
            />
          ) : isSystemDesign ? (
            <SystemDesignPanel
              value={activeCode}
              readOnly={readOnly}
              onChange={(value) => {
                if (!activeQuestion) return;
                setCodeByQuestion((prev) => ({ ...prev, [activeQuestion.id]: value }));
              }}
            />
          ) : isInterview ? (
            <InterviewQuestionPanel
              value={activeCode}
              readOnly={readOnly}
              onChange={(value) => {
                if (!activeQuestion) return;
                setCodeByQuestion((prev) => ({ ...prev, [activeQuestion.id]: value }));
              }}
              onSave={() => void handleInterviewSave()}
            />
          ) : (
            <TextAnswerEditor
              value={activeCode}
              readOnly={readOnly}
              autosaveEnabled={!readOnly}
              onChange={(value) => {
                if (!activeQuestion) return;
                setCodeByQuestion((prev) => ({ ...prev, [activeQuestion.id]: value }));
              }}
            />
          )}
        </section>

        <section className="flex min-h-0 w-[22%] min-w-[220px] flex-col">
          <OutputConsole
            variant={isCoding ? 'coding' : 'text'}
            input={activeCustomInput}
            onInputChange={(value) => {
              if (!activeQuestion) return;
              setCustomInputByQuestion((prev) => ({
                ...prev,
                [activeQuestion.id]: value,
              }));
            }}
            onRun={() => runMutation.mutate()}
            onRunTestCases={() => void handleRunTestCases()}
            onSubmitNext={() => void handleSubmitNext()}
            isLastQuestion={isLastQuestion}
            running={runMutation.isPending}
            submittingAnswer={submitAnswerMutation.isPending}
            readOnly={readOnly}
            showSetupInput={isSql}
            inputLabel="Setup SQL (CREATE / INSERT)"
            inputPlaceholder="CREATE TABLE ...; INSERT INTO ..."
            result={runResult}
            evaluation={activeEvaluation}
            error={runError}
            submitError={submitAnswerError}
            passedTests={evalPassed}
            totalTests={evalTotal ?? activeQuestion.testCases.length}
          />
        </section>
      </main>
    </div>
  );
}

export function CodingWorkspacePage({
  params,
}: {
  params: Promise<{ candidateId: string; candidateAssessmentId: string }>;
}) {
  const { candidateId, candidateAssessmentId } = use(params);
  return (
    <CodingWorkspacePageContent
      candidateId={candidateId}
      candidateAssessmentId={candidateAssessmentId}
    />
  );
}
