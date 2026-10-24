'use client';

import { CodingEditor } from '@/modules/assessments/components/CodingEditor';
import { McqEditor } from '@/modules/assessments/components/McqEditor';
import { SystemDesignPanel } from '@/modules/assessments/components/SystemDesignPanel';
import { TextAnswerEditor } from '@/modules/assessments/components/TextAnswerEditor';
import { InterviewQuestionPanel } from '@/modules/assessments/components/InterviewQuestionPanel';
import type { GenericQuestion, QuestionComponent } from '@/types/assessment-engine';
import { getMcqOptions } from '@/modules/assessments/utils/extract-question-display';

export function resolveQuestionComponent(question: GenericQuestion): QuestionComponent {
  const ui = question.questionJson?.uiComponent as QuestionComponent | undefined;
  if (ui) return ui;

  switch (question.questionType.toUpperCase()) {
    case 'CODING':
      return question.language?.toUpperCase() === 'SQL' ? 'sql_editor' : 'code_editor';
    case 'MCQ':
      return 'mcq';
    case 'SYSTEM_DESIGN':
      return 'architecture';
    case 'INTERVIEW':
      return 'voice';
    default:
      return 'text_response';
  }
}

export function DynamicAssessmentRenderer(props: {
  question: GenericQuestion;
  value: Record<string, unknown>;
  readOnly?: boolean;
  onChange: (data: Record<string, unknown>) => void;
}) {
  const { question, value, readOnly, onChange } = props;
  const component = resolveQuestionComponent(question);
  const config = { ...question.questionJson, language: question.language } as Record<
    string,
    unknown
  >;
  const mcqOptions =
    (value.options as Array<{ label: string; text: string }> | undefined) ??
    (config.options as Array<{ label: string; text: string }> | undefined) ??
    getMcqOptions(question);
  const text = String(value.text ?? value.sourceCode ?? value.architecture ?? value.transcript ?? '');

  switch (component) {
    case 'code_editor':
    case 'sql_editor':
      return (
        <CodingEditor
          language={String(config.language ?? value.language ?? 'PYTHON')}
          value={String(value.sourceCode ?? '')}
          readOnly={readOnly}
          running={false}
          autosaveEnabled={!readOnly}
          onRun={() => undefined}
          onLanguageChange={(language) => onChange({ ...value, language })}
          onChange={(sourceCode) => onChange({ ...value, sourceCode, language: value.language ?? config.language })}
        />
      );
    case 'mcq':
      return (
        <McqEditor
          options={mcqOptions}
          value={String(value.answer ?? '')}
          readOnly={readOnly}
          onChange={(answer) => onChange({ ...value, answer, options: mcqOptions })}
        />
      );
    case 'architecture':
    case 'diagram':
      return (
        <SystemDesignPanel
          value={text}
          readOnly={readOnly}
          onChange={(architecture) => onChange({ ...value, architecture })}
        />
      );
    case 'voice':
      return (
        <InterviewQuestionPanel
          value={text}
          readOnly={readOnly}
          onChange={(transcript) => onChange({ ...value, transcript, text: transcript })}
          onSave={() => undefined}
        />
      );
    case 'file_upload':
      return (
        <div className="space-y-3 p-6">
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">{question.description}</p>
          <input
            type="file"
            disabled={readOnly}
            onChange={(e) => {
              const file = e.target.files?.[0];
              onChange({ ...value, fileName: file?.name ?? '', fileSize: file?.size ?? 0 });
            }}
            className="text-sm"
          />
        </div>
      );
    case 'text_response':
    default:
      return (
        <TextAnswerEditor
          value={text}
          readOnly={readOnly}
          autosaveEnabled={!readOnly}
          onChange={(t) => onChange({ ...value, text: t })}
        />
      );
  }
}

export function buildQuestionResponse(
  question: GenericQuestion,
  value: Record<string, unknown>,
): Record<string, unknown> {
  const component = resolveQuestionComponent(question);
  if (component === 'code_editor' || component === 'sql_editor') {
    return { language: value.language ?? question.language, sourceCode: value.sourceCode ?? '' };
  }
  if (component === 'mcq') return { answer: value.answer };
  if (component === 'architecture' || component === 'diagram') {
    return { architecture: value.architecture ?? value.text };
  }
  if (component === 'voice') return { transcript: value.transcript ?? value.text };
  return value;
}
