'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

export function TextAnswerEditor(props: {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  autosaveEnabled?: boolean;
}) {
  return (
    <div className="workspace-code-editor-bg flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/5 bg-neutral-900 px-4">
        <div className="flex items-center gap-2 text-white">
          <AssessmentMaterialIcon name="edit_note" size={18} className="text-white" />
          <span className="text-sm font-medium">Your Answer</span>
        </div>
        {props.autosaveEnabled ? (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-white/50">
            Autosave on
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 p-4">
        <textarea
          value={props.value}
          onChange={(e) => props.onChange(e.target.value)}
          readOnly={props.readOnly}
          placeholder="Type your answer here. Explain your reasoning, list steps, or paste corrected SQL as requested."
          className="h-full min-h-[320px] w-full resize-none rounded-lg border border-white/10 bg-[#1e1e1e] p-4 font-mono text-sm leading-6 text-white/90 placeholder:text-white/30 focus:border-[var(--assessment-primary)] focus:outline-none disabled:opacity-60"
        />
      </div>
    </div>
  );
}
