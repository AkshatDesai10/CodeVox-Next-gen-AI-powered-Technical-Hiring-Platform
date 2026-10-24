'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

export function AiAdaptiveBlock(props: {
  title?: string;
  description?: string;
  branchLabel?: string;
}) {
  return (
    <div className="nexus-glass-ai p-4">
      <div className="mb-2 flex items-center gap-2">
        <AssessmentMaterialIcon name="auto_awesome" className="text-[var(--nexus-secondary)]" />
        <span className="font-label-caps text-[var(--nexus-on-secondary-container)]">
          {props.title ?? 'AI Adaptive Branch'}
        </span>
      </div>
      <p className="font-mono-data text-sm text-[var(--assessment-on-surface-variant)]">
        {props.description ??
          'Follow-up questions generated from candidate responses using JD + rubric context.'}
      </p>
      {props.branchLabel ? (
        <p className="mt-2 font-mono-data text-xs text-[var(--nexus-secondary)]">
          → {props.branchLabel}
        </p>
      ) : null}
    </div>
  );
}
