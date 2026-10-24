'use client';

import { TextAnswerEditor } from '@/modules/assessments/components/TextAnswerEditor';

export function InterviewQuestionPanel(props: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  onSave?: () => void;
  saving?: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TextAnswerEditor
        value={props.value}
        onChange={props.onChange}
        readOnly={props.readOnly}
        autosaveEnabled={!props.readOnly}
      />
      {props.onSave ? (
        <div className="border-t border-white/10 bg-neutral-900 p-3">
          <button
            type="button"
            disabled={props.readOnly || props.saving}
            onClick={props.onSave}
            className="w-full rounded-lg bg-[var(--assessment-primary)] py-2.5 text-sm font-bold text-white disabled:opacity-60"
          >
            {props.saving ? 'Saving response...' : 'Save Interview Response'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
