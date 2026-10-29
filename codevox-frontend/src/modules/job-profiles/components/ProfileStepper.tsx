'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

type Step = { id: number; label: string };

export function ProfileStepper(props: {
  steps: Step[];
  activeStep: number;
  variant?: 'wizard' | 'toolbar';
  onStepClick?: (stepId: number) => void;
  onSaveDraft?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  saving?: boolean;
}) {
  const variant = props.variant ?? 'wizard';

  if (variant === 'toolbar') {
    return (
      <div className="codevox-card mb-6 flex flex-wrap items-center justify-between gap-4 px-6 py-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-6">
          {props.steps.map((step, idx) => {
            const active = step.id === props.activeStep;
            const done = step.id < props.activeStep;
            const clickable = Boolean(props.onStepClick) && step.id !== props.activeStep;
            return (
              <div key={step.id} className="flex items-center gap-6">
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => props.onStepClick?.(step.id)}
                  className={`flex items-center gap-2 ${
                    active ? 'border-b-2 border-[var(--assessment-primary)] font-bold text-[var(--assessment-primary)]' : done ? 'font-bold text-[var(--assessment-primary)]' : 'text-[var(--codevox-outline)]'
                  } ${clickable ? 'cursor-pointer hover:text-[var(--assessment-primary)]' : 'cursor-default'}`}
                >
                  {done ? (
                    <AssessmentMaterialIcon name="check_circle" size={20} />
                  ) : (
                    <span
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold ${
                        active
                          ? 'bg-[var(--assessment-primary)] text-white'
                          : 'border border-[var(--assessment-outline-variant)]'
                      }`}
                    >
                      {step.id}
                    </span>
                  )}
                  <span className="font-title-sm text-sm">
                    {step.id}. {step.label}
                  </span>
                </button>
                {idx < props.steps.length - 1 ? (
                  <div className="hidden h-px w-12 bg-[var(--assessment-outline-variant)] sm:block" />
                ) : null}
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          {props.onSaveDraft ? (
            <button
              type="button"
              onClick={props.onSaveDraft}
              disabled={props.saving}
              className="border border-[var(--assessment-primary)] px-6 py-2 font-label-caps text-[var(--assessment-primary)] transition-colors hover:bg-[var(--assessment-surface-container-low)]"
            >
              Save draft
            </button>
          ) : null}
          {props.onContinue ? (
            <button
              type="button"
              onClick={props.onContinue}
              disabled={props.continueDisabled || props.saving}
              className="bg-[var(--assessment-primary)] px-6 py-2 font-label-caps text-white transition-colors hover:bg-[var(--assessment-primary-container)] disabled:opacity-50"
            >
              {props.saving ? 'Saving...' : (props.continueLabel ?? 'Continue')}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 flex items-center justify-between px-6">
      {props.steps.map((step, idx) => {
        const active = step.id === props.activeStep;
        const done = step.id < props.activeStep;
        return (
          <div key={step.id} className="flex flex-1 items-center">
            <div
              className={`flex flex-1 flex-col items-center gap-2 pb-2 ${
                active ? 'codevox-stepper-active' : 'text-[var(--codevox-outline)]'
              }`}
            >
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full font-bold ${
                  active || done
                    ? 'bg-[var(--assessment-primary)] text-white'
                    : 'border-2 border-[var(--assessment-outline-variant)]'
                }`}
              >
                {done ? <AssessmentMaterialIcon name="check" size={16} /> : step.id}
              </div>
              <span className="font-title-sm text-sm">{step.label}</span>
            </div>
            {idx < props.steps.length - 1 ? (
              <div className="mb-6 h-px w-24 bg-[var(--assessment-outline-variant)]" />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
