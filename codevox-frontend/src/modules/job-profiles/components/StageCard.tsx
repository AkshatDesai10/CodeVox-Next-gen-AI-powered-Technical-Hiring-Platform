'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
export type JobStageType = 'ai_screening' | 'screening' | 'coding' | 'ai_verbal' | 'hr_verbal' | 'panel' | 'project_interview' | 'custom';

const STAGE_TYPE_OPTIONS: { value: JobStageType; label: string }[] = [
  { value: 'ai_screening', label: 'AI Screening' },
  { value: 'screening', label: 'Screening' },
  { value: 'coding', label: 'Coding assessment' },
  { value: 'ai_verbal', label: 'AI verbal' },
  { value: 'hr_verbal', label: 'HR verbal' },
  { value: 'panel', label: 'Panel' },
  { value: 'project_interview', label: 'Build & Defend' },
  { value: 'custom', label: 'Custom' },
];

export function StageCard(props: {
  name: string;
  description?: string;
  stageType?: string;
  mode: 'ai_led' | 'human_led';
  mandatory?: boolean;
  aiSuggested?: boolean;
  disabledTypes?: string[];
  onNameChange?: (name: string) => void;
  onStageTypeChange?: (stageType: JobStageType) => void;
  onModeChange: (mode: 'ai_led' | 'human_led') => void;
  onDelete?: () => void;
}) {
  const isAiForced =
    props.stageType === 'ai_verbal' ||
    props.stageType === 'coding' ||
    props.stageType === 'screening' ||
    props.stageType === 'ai_screening';
  const isHumanForced = props.stageType === 'hr_verbal' || props.stageType === 'panel';
  const displayMode = isAiForced ? 'ai_led' : isHumanForced ? 'human_led' : props.mode;

  return (
    <div
      className={`relative flex flex-col gap-3 rounded-lg border bg-[var(--assessment-surface-container)] p-4 shadow-sm transition-shadow hover:shadow-md sm:flex-row sm:items-center ${
        props.aiSuggested ? 'codevox-ai-sparkle-border' : 'border-[var(--assessment-outline-variant)]'
      }`}
    >
      {props.aiSuggested ? (
        <span className="absolute -top-3 right-4 rounded-full bg-[var(--codevox-secondary)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter text-white">
          AI suggested
        </span>
      ) : null}
      <span className="cursor-grab text-[var(--codevox-outline)]">
        <AssessmentMaterialIcon name="drag_indicator" size={20} />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          {props.onNameChange ? (
            <input
              className="min-w-[140px] flex-1 rounded border border-[var(--assessment-outline-variant)] px-2 py-1 text-sm font-semibold"
              value={props.name}
              onChange={(e) => props.onNameChange?.(e.target.value)}
            />
          ) : (
            <h4 className="text-sm font-semibold">{props.name}</h4>
          )}
          {props.mandatory ? (
            <span 
              className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-700"
              title="This is a core round required by the system workflow and cannot be removed."
            >
              Mandatory
            </span>
          ) : null}
        </div>
        {props.onStageTypeChange ? (
          <select
            className="w-full max-w-xs rounded border border-[var(--assessment-outline-variant)] px-2 py-1 text-xs"
            value={props.stageType ?? 'custom'}
            onChange={(e) => props.onStageTypeChange?.(e.target.value as JobStageType)}
          >
            {STAGE_TYPE_OPTIONS.map((o) => (
              <option 
                key={o.value} 
                value={o.value} 
                disabled={props.disabledTypes?.includes(o.value) && o.value !== props.stageType}
              >
                {o.label}
              </option>
            ))}
          </select>
        ) : props.description ? (
          <p className="text-xs text-[var(--assessment-on-surface-variant)]">{props.description}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex rounded bg-[var(--assessment-surface-container-low)] p-1">
          <button
            type="button"
            disabled={isAiForced || isHumanForced}
            onClick={() => props.onModeChange('ai_led')}
            className={`rounded px-3 py-1 text-[10px] font-bold uppercase ${
              displayMode === 'ai_led'
                ? props.aiSuggested
                  ? 'bg-[var(--codevox-secondary)] text-white shadow-sm'
                  : 'bg-[var(--assessment-primary)] text-white shadow-sm'
                : 'text-[var(--assessment-on-surface-variant)]'
            } disabled:cursor-not-allowed`}
          >
            AI-led
          </button>
          <button
            type="button"
            disabled={isAiForced || isHumanForced}
            onClick={() => props.onModeChange('human_led')}
            className={`rounded px-3 py-1 text-[10px] font-bold uppercase ${
              displayMode === 'human_led'
                ? 'bg-[var(--assessment-primary)] text-white shadow-sm'
                : 'text-[var(--assessment-on-surface-variant)]'
            } disabled:cursor-not-allowed`}
          >
            Human
          </button>
        </div>
        {props.onDelete ? (
          <button
            type="button"
            className="text-[var(--codevox-outline)] hover:text-red-600"
            onClick={props.onDelete}
          >
            âœ•
          </button>
        ) : null}
      </div>
    </div>
  );
}
