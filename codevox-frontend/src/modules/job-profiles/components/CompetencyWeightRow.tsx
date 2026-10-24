'use client';

import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

export function CompetencyWeightRow(props: {
  name: string;
  category: string;
  targetScore: number;
  weightPct?: number;
  aiIdentified?: boolean;
  onWeightChange?: (val: number) => void;
  onDelete?: () => void;
}) {
  return (
    <tr
      className={`border-b border-[var(--assessment-outline-variant)] transition-colors hover:bg-[var(--assessment-surface-container-low)] ${
        props.aiIdentified ? 'nexus-ai-sparkle-border' : ''
      }`}
    >
      <td className="px-4 py-3">
        <span
          className={`text-sm font-semibold ${props.aiIdentified ? 'text-[var(--nexus-secondary)]' : ''}`}
        >
          {props.name}
        </span>
        <div
          className={`mt-1 text-[10px] font-bold uppercase tracking-widest ${
            props.aiIdentified ? 'text-[var(--nexus-secondary)]/70' : 'text-[var(--assessment-on-surface-variant)]'
          }`}
        >
          {props.aiIdentified ? 'AI identified' : `${props.category} skill`}
        </div>
      </td>
      <td className={`px-4 py-3 font-mono-data ${props.aiIdentified ? 'text-[var(--nexus-secondary)]' : ''}`}>
        {props.targetScore.toFixed(1)} / 10
      </td>
      <td className="px-4 py-3 text-right">
        {props.onWeightChange ? (
          <div className="flex items-center justify-end gap-1 font-mono-data text-sm">
            <input
              type="number"
              min={0}
              max={100}
              step={1}
              value={props.weightPct ?? 0}
              onChange={(e) => {
                let val = Number(e.target.value);
                if (val > 100) val = 100;
                if (val < 0) val = 0;
                props.onWeightChange?.(val);
              }}
              className={`w-16 rounded border px-2 py-1 text-right ${
                props.aiIdentified
                  ? 'border-[var(--nexus-secondary)]/30 text-[var(--nexus-secondary)]'
                  : 'border-[var(--assessment-outline-variant)] text-[var(--assessment-on-surface)]'
              }`}
            />
            <span className="text-[var(--assessment-on-surface-variant)]">%</span>
          </div>
        ) : (
          <span className="font-mono-data text-sm text-[var(--assessment-on-surface-variant)]">
            {props.weightPct ?? 0}%
          </span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-3">
          {props.aiIdentified && (
            <span title="AI Suggested" className="flex items-center">
              <AssessmentMaterialIcon name="auto_fix_high" size={18} className="text-[var(--nexus-secondary)]" />
            </span>
          )}
          {props.onDelete ? (
            <button type="button" className="text-[var(--assessment-on-surface-variant)] hover:text-red-600 transition-colors" onClick={props.onDelete} title="Remove competency">
              <AssessmentMaterialIcon name="delete" size={18} />
            </button>
          ) : (
            <AssessmentMaterialIcon name="tune" size={18} className="text-[var(--nexus-outline)]" />
          )}
        </div>
      </td>
    </tr>
  );
}
