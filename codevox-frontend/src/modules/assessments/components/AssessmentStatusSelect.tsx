'use client';

import { useMutation } from '@tanstack/react-query';
import { updateAssessmentStatus } from '@/lib/assessments-api';

export const ASSESSMENT_STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED'] as const;
export type AssessmentStatusValue = (typeof ASSESSMENT_STATUSES)[number];

type Props = {
  assessmentId: string;
  value: string;
  onUpdated?: (status: string) => void;
  className?: string;
};

export function AssessmentStatusSelect({ assessmentId, value, onUpdated, className }: Props) {
  const mutation = useMutation({
    mutationFn: (status: AssessmentStatusValue) =>
      updateAssessmentStatus(assessmentId, { status }),
    onSuccess: (res) => {
      const status = (res.data as { status?: string })?.status ?? value;
      onUpdated?.(status);
    },
  });

  return (
    <select
      value={value}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as AssessmentStatusValue)}
      className={
        className ??
        'rounded-lg border border-[var(--assessment-outline-variant)] px-2 py-1 text-xs font-semibold'
      }
    >
      {ASSESSMENT_STATUSES.map((status) => (
        <option key={status} value={status}>
          {status}
        </option>
      ))}
    </select>
  );
}
