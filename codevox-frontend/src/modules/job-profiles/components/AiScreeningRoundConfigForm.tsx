'use client';

import {
  AI_SCREENING_REQUIREMENT_TOPICS,
  createCustomAiScreeningRequirement,
  normalizeAiScreeningRoundConfig,
  type AiScreeningRequirement,
  type AiScreeningRoundConfig,
  type AiScreeningTopicConfig,
} from '@/modules/job-profiles/lib/ai-screening-round.types';

function requirementTopicId(req: AiScreeningRequirement): string {
  if (!req.predefined) return '';
  return AI_SCREENING_REQUIREMENT_TOPICS[req.id] || '';
}

type Props = {
  config: unknown;
  onChange: (config: AiScreeningRoundConfig) => void;
};

export function AiScreeningRoundConfigForm(props: Props) {
  const config = normalizeAiScreeningRoundConfig(props.config);

  const patch = (partial: Partial<AiScreeningRoundConfig>) => {
    props.onChange({ ...config, ...partial });
  };

  const patchTopic = (id: string, partial: Partial<AiScreeningTopicConfig>) => {
    props.onChange({
      ...config,
      topics: config.topics.map((t) => (t.id === id ? { ...t, ...partial } : t)),
    });
  };

  const patchRequirement = (
    id: string,
    partial: Partial<{ question: string; expectedAnswer: string }>,
  ) => {
    props.onChange({
      ...config,
      screeningRequirements: config.screeningRequirements.map((r) =>
        r.id === id ? { ...r, ...partial } : r,
      ),
    });
  };

  const addCustomRequirement = () => {
    props.onChange({
      ...config,
      screeningRequirements: [
        ...config.screeningRequirements,
        createCustomAiScreeningRequirement(),
      ],
    });
  };

  const removeRequirement = (id: string) => {
    props.onChange({
      ...config,
      screeningRequirements: config.screeningRequirements.filter((r) => r.id !== id),
    });
  };

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div>
          <h4 className="font-title-sm text-sm font-bold uppercase tracking-wide text-[var(--assessment-on-surface)]">
            Screening Settings
          </h4>
          <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
            Cap how long the AI Screening conversation can run. No rubrics, scores, or hiring
            decisions are produced in this stage.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--assessment-on-surface)]">
            Max questions
            <input
              type="number"
              min={1}
              max={40}
              value={config.maxQuestions}
              onChange={(e) =>
                patch({ maxQuestions: Math.max(1, Number(e.target.value) || 1) })
              }
              className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm font-normal"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold text-[var(--assessment-on-surface)]">
            Max time (minutes)
            <input
              type="number"
              min={5}
              max={60}
              value={config.maxTimeMinutes}
              onChange={(e) =>
                patch({ maxTimeMinutes: Math.max(1, Number(e.target.value) || 1) })
              }
              className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm font-normal"
            />
          </label>
        </div>
      </div>

      <div className="space-y-4 border-t border-[var(--assessment-outline-variant)] pt-6">
        <div>
          <h4 className="font-title-sm text-sm font-bold uppercase tracking-wide text-[var(--assessment-on-surface)]">
            Screening Topics
          </h4>
          <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
            The interview follows this order. Logistics topics come last. A catalog question is
            asked only while its topic is in focus, and only when that fact is still missing.
            Turning a topic off skips its questions.
          </p>
        </div>

        <div className="space-y-3">
          {config.topics.map((topic) => {
            const linked = config.screeningRequirements.filter(
              (req) => requirementTopicId(req) === topic.id,
            );
            return (
              <div
                key={topic.id}
                className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-[var(--assessment-on-surface)]">
                    <input
                      type="checkbox"
                      checked={topic.enabled}
                      onChange={(e) => patchTopic(topic.id, { enabled: e.target.checked })}
                      className="h-4 w-4 accent-[var(--assessment-primary)]"
                    />
                    {topic.label}
                  </label>
                  {!topic.enabled && (
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                      Skipped
                    </span>
                  )}
                </div>
                {linked.length > 0 && (
                  <div className={`mt-3 space-y-3 ${topic.enabled ? '' : 'opacity-60'}`}>
                    {linked.map((req) => (
                      <RequirementFields
                        key={req.id}
                        req={req}
                        onPatch={(partial) => patchRequirement(req.id, partial)}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
          Catalog questions are asked only when an expected answer is filled in. Leave one empty
          and that question is skipped.
        </p>
      </div>

      <div className="space-y-4 border-t border-[var(--assessment-outline-variant)] pt-6">
        <div>
          <h4 className="font-title-sm text-sm font-bold uppercase tracking-wide text-[var(--assessment-on-surface)]">
            Additional questions
          </h4>
          <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
            These are not tied to a screening topic. They are asked only after every topic above
            has been covered, at the end of this round.
          </p>
        </div>
        {config.screeningRequirements
          .filter((req) => !req.predefined)
          .map((req) => (
            <RequirementFields
              key={req.id}
              req={req}
              onPatch={(partial) => patchRequirement(req.id, partial)}
              onRemove={() => removeRequirement(req.id)}
            />
          ))}
        <button
          type="button"
          onClick={addCustomRequirement}
          className="rounded-lg border border-dashed border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold text-[var(--assessment-primary)] hover:bg-[var(--assessment-primary-fixed)]/10"
        >
          + Add Screening Requirement
        </button>
      </div>
    </div>
  );
}

function RequirementFields(props: {
  req: AiScreeningRequirement;
  onPatch: (partial: Partial<{ question: string; expectedAnswer: string }>) => void;
  onRemove?: () => void;
}) {
  const { req } = props;
  return (
    <div className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
          {req.predefined ? 'Question for this topic' : 'Custom question'}
        </span>
        {props.onRemove ? (
          <button
            type="button"
            onClick={props.onRemove}
            className="text-xs font-semibold text-[var(--assessment-error)] hover:underline"
          >
            Remove
          </button>
        ) : null}
      </div>
      <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface)]">
        Question
        <input
          type="text"
          value={req.question}
          readOnly={Boolean(req.predefined)}
          onChange={(e) => props.onPatch({ question: e.target.value })}
          placeholder="e.g. Are you comfortable working from Bangalore?"
          className={`rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm font-normal ${
            req.predefined ? 'bg-[var(--assessment-surface-container-low)]' : 'bg-[var(--assessment-surface-container)]'
          }`}
        />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface)]">
        Expected answer / requirement (optional)
        <input
          type="text"
          value={req.expectedAnswer}
          onChange={(e) => props.onPatch({ expectedAnswer: e.target.value })}
          placeholder="e.g. ₹10–15 LPA, B.Tech CS, ≤ 60 days, Yes"
          className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm font-normal"
        />
      </label>
    </div>
  );
}
