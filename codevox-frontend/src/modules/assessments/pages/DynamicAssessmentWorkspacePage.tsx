'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  evaluateEngineQuestion,
  getEngineSession,
  startEngineSession,
  submitEngineAssessment,
  submitEngineQuestion,
} from '@/lib/assessment-engine-api';
import {
  DynamicAssessmentRenderer,
  buildQuestionResponse,
} from '@/modules/assessments/components/dynamic/DynamicAssessmentRenderer';
import { QuestionContextPanel } from '@/modules/assessments/components/dynamic/QuestionContextPanel';
import { getMcqOptions, getStarterCode } from '@/modules/assessments/utils/extract-question-display';
import type { GenericQuestion } from '@/types/assessment-engine';

export function DynamicAssessmentWorkspacePage(props: {
  sessionId?: string;
  candidateId: string;
  templateId?: string;
  assessmentId?: string;
}) {
  const [sessionId, setSessionId] = useState(props.sessionId ?? '');
  const [candidateAssessmentId, setCandidateAssessmentId] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});

  const startMutation = useMutation({
    mutationFn: () =>
      startEngineSession({
        candidate_id: props.candidateId,
        template_id: props.templateId,
        assessment_id: props.assessmentId,
      }),
    onSuccess: (res) => {
      setSessionId(res.data.sessionId);
      setCandidateAssessmentId(res.data.candidateAssessmentId);
    },
  });

  const sessionQuery = useQuery({
    queryKey: ['engine-session', sessionId],
    enabled: Boolean(sessionId),
    queryFn: async () => (await getEngineSession(sessionId)).data,
  });

  const submitQuestionMutation = useMutation({
    mutationFn: async (questionId: string) => {
      const question = questions.find((q) => q.id === questionId);
      if (!question) throw new Error('Question not found');
      const responseJson = buildQuestionResponse(question, answers[questionId] ?? {});
      await submitEngineQuestion({
        candidate_assessment_id: candidateAssessmentId,
        question_id: questionId,
        response_json: responseJson,
      });
      return evaluateEngineQuestion({
        candidate_assessment_id: candidateAssessmentId,
        question_id: questionId,
      });
    },
  });

  const submitAssessmentMutation = useMutation({
    mutationFn: () => submitEngineAssessment(candidateAssessmentId),
  });

  const questions: GenericQuestion[] = sessionQuery.data?.questions ?? [];
  const assessment = sessionQuery.data?.assessment;
  const activeQuestion = questions[activeIndex];
  const readOnly =
    sessionQuery.data?.status === 'SUBMITTED' || sessionQuery.data?.status === 'GRADED';

  const progressLabel = useMemo(() => {
    if (!questions.length) return '0/0';
    return `${activeIndex + 1}/${questions.length}`;
  }, [activeIndex, questions.length]);

  useEffect(() => {
    if (!activeQuestion) return;
    setAnswers((prev) => {
      const current = prev[activeQuestion.id];
      if (current && (current.sourceCode !== undefined || current.answer !== undefined || current.text)) {
        return prev;
      }
      const starterCode = getStarterCode(activeQuestion);
      const mcqOptions = getMcqOptions(activeQuestion);
      const next: Record<string, unknown> = { ...current };
      if (starterCode) {
        next.sourceCode = starterCode;
        next.language = activeQuestion.language ?? 'PYTHON';
      }
      if (activeQuestion.questionType?.toUpperCase() === 'MCQ' && mcqOptions.length) {
        next.options = mcqOptions;
      }
      return { ...prev, [activeQuestion.id]: next };
    });
  }, [activeQuestion]);

  if (!sessionId && !startMutation.isPending) {
    return (
      <div className="p-6">
        <button
          type="button"
          onClick={() => startMutation.mutate()}
          className="rounded-lg bg-[var(--assessment-primary)] px-6 py-3 text-sm font-bold text-white"
        >
          Start Assessment
        </button>
      </div>
    );
  }

  if (!assessment || !activeQuestion) {
    return <div className="p-6">Loading assessment...</div>;
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      <header className="border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-6 py-4">
        <h1 className="text-xl font-bold">{assessment.title}</h1>
        <p className="text-sm text-[var(--assessment-on-surface-variant)]">
          {assessment.role ?? 'Technical'} | {progressLabel} questions
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-[32%] min-w-[300px] shrink-0 overflow-y-auto border-r border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]">
          <QuestionContextPanel question={activeQuestion} />
        </aside>

        <aside className="w-56 shrink-0 overflow-y-auto border-r p-4 lg:w-64">
          <p className="mb-2 text-xs font-bold uppercase text-[var(--assessment-on-surface-variant)]">
            Questions
          </p>
          {questions.map((q, index) => (
            <button
              key={q.id}
              type="button"
              onClick={() => setActiveIndex(index)}
              className={`mb-2 w-full rounded-lg px-3 py-2 text-left text-sm ${
                index === activeIndex
                  ? 'bg-[var(--assessment-primary)] text-white'
                  : 'bg-[var(--assessment-surface-container)]'
              }`}
            >
              <span className="font-medium">{index + 1}. {q.title}</span>
              <span className="mt-0.5 block text-xs opacity-80">
                {q.questionType} | {q.marks}m
              </span>
            </button>
          ))}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col bg-[#1e1e1e]">
          <div className="min-h-0 flex-1">
            <DynamicAssessmentRenderer
              question={activeQuestion}
              value={answers[activeQuestion.id] ?? {}}
              readOnly={readOnly}
              onChange={(data) =>
                setAnswers((prev) => ({ ...prev, [activeQuestion.id]: data }))
              }
            />
          </div>
          <footer className="flex gap-2 border-t p-4">
            <button
              type="button"
              disabled={readOnly || submitQuestionMutation.isPending}
              onClick={() => submitQuestionMutation.mutate(activeQuestion.id)}
              className="rounded-lg border px-4 py-2 text-sm font-semibold"
            >
              Save & Evaluate
            </button>
            {activeIndex < questions.length - 1 ? (
              <button
                type="button"
                onClick={() => setActiveIndex((i) => i + 1)}
                className="rounded-lg bg-[var(--assessment-secondary,#295bb5)] px-4 py-2 text-sm font-bold text-white"
              >
                Next Question
              </button>
            ) : (
              <button
                type="button"
                disabled={readOnly || submitAssessmentMutation.isPending}
                onClick={() => submitAssessmentMutation.mutate()}
                className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-bold text-white"
              >
                Submit Assessment
              </button>
            )}
          </footer>
        </main>
      </div>
    </div>
  );
}
