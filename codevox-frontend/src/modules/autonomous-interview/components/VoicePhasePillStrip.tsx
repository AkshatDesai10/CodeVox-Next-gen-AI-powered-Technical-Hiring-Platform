'use client';

export const VOICE_PHASE_PILLS = [
  { id: 'screening', label: 'AI Screening' },
  { id: 'transition', label: 'Transition' },
  { id: 'technical', label: 'Technical Deep Dive' },
] as const;

export type VoicePhasePillId = (typeof VOICE_PHASE_PILLS)[number]['id'];

type Props = {
  active: VoicePhasePillId;
  className?: string;
};

export function VoicePhasePillStrip({ active, className = '' }: Props) {
  const activeIndex = VOICE_PHASE_PILLS.findIndex((p) => p.id === active);

  return (
    <div
      className={`voice-phase-pill-strip flex flex-wrap items-center gap-1.5 ${className}`}
      role="list"
      aria-label="Interview phase progress"
    >
      {VOICE_PHASE_PILLS.map((pill, index) => {
        const isActive = pill.id === active;
        const isDone = index < activeIndex;
        return (
          <span
            key={pill.id}
            role="listitem"
            className={`voice-phase-pill ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}`}
          >
            {pill.label}
          </span>
        );
      })}
    </div>
  );
}
