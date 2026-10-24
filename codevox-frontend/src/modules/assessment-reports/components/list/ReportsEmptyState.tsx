'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

export function ReportsEmptyState(props: { onReset: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        <AssessmentMaterialIcon name="description" size={32} />
      </div>
      <h3 className="text-lg font-semibold text-[var(--assessment-on-surface)]">
        No assessment reports found
      </h3>
      <p className="mt-1 max-w-md text-sm text-[var(--assessment-on-surface-variant)]">
        Try adjusting your filters or search query to find candidate assessment reports.
      </p>
      <button
        type="button"
        onClick={props.onReset}
        className="mt-4 rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white"
      >
        Reset All Filters
      </button>
    </div>
  );
}
