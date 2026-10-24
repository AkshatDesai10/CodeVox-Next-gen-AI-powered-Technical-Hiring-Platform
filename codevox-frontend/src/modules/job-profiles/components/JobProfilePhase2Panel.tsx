'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  diffJobProfileVersions,
  listCompetencyLibrary,
  listJobProfileVersions,
  listQuestionLibrary,
  submitJobProfileForApproval,
  updateJobProfilePhase2Config,
  type JobProfileSummary,
} from '@/modules/job-profiles/lib/job-profiles-api';

export function JobProfilePhase2Panel(props: {
  profileId: string;
  profile: JobProfileSummary;
  onAddCompetency: (row: { name: string; category: string; target_score: number; weight_pct: number }) => void;
  onAddQuestion: (row: { prompt: string; kind: string }) => void;
  showOrgLibraries?: boolean;
  showVersionHistory?: boolean;
  showStallNotifications?: boolean;
}) {
  const queryClient = useQueryClient();
  const [diffFrom, setDiffFrom] = useState('');
  const [diffTo, setDiffTo] = useState('');
  const [diffResult, setDiffResult] = useState<Array<{ path: string; before: unknown; after: unknown }> | null>(
    null,
  );

  const compliance = (props.profile.compliance_config ?? {}) as {
    approval_required?: boolean;
    disclosure_text?: string;
    retention_days?: number;
  };
  const threshold = (props.profile.threshold_config ?? {}) as {
    auto_advance_min_score?: number;
    auto_reject_max_score?: number;
    require_human_review?: boolean;
  };
  const notification = (props.profile.notification_config ?? {}) as { stall_days_threshold?: number };

  const versionsQuery = useQuery({
    queryKey: ['job-profile-versions', props.profileId],
    queryFn: () => listJobProfileVersions(props.profileId),
  });

  const competencyLibQuery = useQuery({
    queryKey: ['competency-library', props.profile.department],
    queryFn: () => listCompetencyLibrary(props.profile.department ?? undefined),
  });

  const questionLibQuery = useQuery({
    queryKey: ['question-library', props.profile.department],
    queryFn: () => listQuestionLibrary(props.profile.department ?? undefined),
  });

  const configMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      updateJobProfilePhase2Config(props.profileId, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['job-profile', props.profileId] }),
  });

  const approvalMutation = useMutation({
    mutationFn: () => submitJobProfileForApproval(props.profileId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['job-profile', props.profileId] }),
  });

  return (
    <div className="space-y-6">
      <section className="nexus-card p-5">
        <h2 className="font-headline-md mb-4">Compliance & approval</h2>
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={compliance.approval_required ?? false}
            onChange={(e) =>
              configMutation.mutate({
                compliance_config: { ...compliance, approval_required: e.target.checked },
              })
            }
          />
          Require approval before publish
        </label>
        <textarea
          className="mb-2 w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
          rows={2}
          placeholder="Candidate disclosure text"
          defaultValue={compliance.disclosure_text ?? ''}
          onBlur={(e) =>
            configMutation.mutate({
              compliance_config: { ...compliance, disclosure_text: e.target.value },
            })
          }
        />
        {props.profile.status === 'draft' && compliance.approval_required ? (
          <button
            type="button"
            disabled={approvalMutation.isPending}
            onClick={() => approvalMutation.mutate()}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Submit for approval
          </button>
        ) : null}
      </section>

      <section className="nexus-card p-5">
        <h2 className="font-headline-md mb-4">Progression mode</h2>
        <p className="mb-4 text-xs text-[var(--assessment-on-surface-variant)]">
          Controls whether candidates unlock the next round after every round, or only when they meet a score threshold.
        </p>
        {(() => {
          const progression = (props.profile.progression_config ?? {}) as {
            mode?: 'sequential' | 'elimination';
            elimination_threshold?: number;
          };
          const mode = progression.mode === 'elimination' ? 'elimination' : 'sequential';
          return (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() =>
                    configMutation.mutate({
                      progression_config: {
                        ...progression,
                        mode: 'sequential',
                        elimination_threshold: progression.elimination_threshold ?? 50,
                      },
                    })
                  }
                  className={`rounded-lg border p-3 text-left text-sm ${
                    mode === 'sequential'
                      ? 'border-2 border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5'
                      : 'border-[var(--assessment-outline-variant)]'
                  }`}
                >
                  <p className="font-bold">Sequential</p>
                  <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                    Complete all rounds in order. HR decides after the last round.
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() =>
                    configMutation.mutate({
                      progression_config: {
                        ...progression,
                        mode: 'elimination',
                        elimination_threshold: progression.elimination_threshold ?? 50,
                      },
                    })
                  }
                  className={`rounded-lg border p-3 text-left text-sm ${
                    mode === 'elimination'
                      ? 'border-2 border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5'
                      : 'border-[var(--assessment-outline-variant)]'
                  }`}
                >
                  <p className="font-bold">Elimination</p>
                  <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
                    Candidate must hit the threshold to unlock the next round.
                  </p>
                </button>
              </div>
              {mode === 'elimination' ? (
                <div>
                  <label className="mb-1 block text-xs font-semibold">
                    Elimination threshold (0–100)
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="w-full rounded-lg border px-3 py-2 text-sm sm:max-w-xs"
                    defaultValue={progression.elimination_threshold ?? 50}
                    onBlur={(e) =>
                      configMutation.mutate({
                        progression_config: {
                          mode: 'elimination',
                          elimination_threshold: Number(e.target.value),
                        },
                      })
                    }
                  />
                </div>
              ) : null}
            </div>
          );
        })()}
      </section>

      <section className="nexus-card p-5">
        <h2 className="font-headline-md mb-4">Auto-advance thresholds</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold">Auto-advance min score</label>
            <input
              type="number"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              defaultValue={threshold.auto_advance_min_score ?? 7.5}
              onBlur={(e) =>
                configMutation.mutate({
                  threshold_config: {
                    ...threshold,
                    auto_advance_min_score: Number(e.target.value),
                  },
                })
              }
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">Auto-reject max score</label>
            <input
              type="number"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              defaultValue={threshold.auto_reject_max_score ?? 4}
              onBlur={(e) =>
                configMutation.mutate({
                  threshold_config: {
                    ...threshold,
                    auto_reject_max_score: Number(e.target.value),
                  },
                })
              }
            />
          </div>
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={threshold.require_human_review !== false}
            onChange={(e) =>
              configMutation.mutate({
                threshold_config: { ...threshold, require_human_review: e.target.checked },
              })
            }
          />
          Mandatory human review gate
        </label>
      </section>

      {props.showOrgLibraries ? (
        <section className="nexus-card p-5">
          <h2 className="font-headline-md mb-4">Org libraries</h2>
          <div className="grid gap-4 md:grid-cols-1">
            <div>
              <p className="mb-2 font-label-caps text-xs">Competencies</p>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                {(competencyLibQuery.data ?? []).map((c) => (
                  <li key={c.id} className="flex justify-between gap-2">
                    <span>{c.name}</span>
                    <button
                      type="button"
                      className="text-xs text-[var(--assessment-primary)]"
                      onClick={() =>
                        props.onAddCompetency({
                          name: c.name,
                          category: c.category,
                          target_score: c.default_target_score ?? 8,
                          weight_pct: c.default_weight_pct ?? 10,
                        })
                      }
                    >
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      ) : null}

      {props.showVersionHistory ? (
        <section className="nexus-card p-5">
          <h2 className="font-headline-md mb-4">Version history</h2>
          <ul className="mb-4 space-y-1 text-sm">
            {(versionsQuery.data ?? []).map((v) => (
              <li key={v.id} className="flex justify-between">
                <span>v{v.version_number}</span>
                <span className="text-xs text-[var(--assessment-on-surface-variant)]">
                  {new Date(v.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-end gap-2">
            <input
              placeholder="From v"
              value={diffFrom}
              onChange={(e) => setDiffFrom(e.target.value)}
              className="w-20 rounded border px-2 py-1 text-sm"
            />
            <input
              placeholder="To v"
              value={diffTo}
              onChange={(e) => setDiffTo(e.target.value)}
              className="w-20 rounded border px-2 py-1 text-sm"
            />
            <button
              type="button"
              className="rounded bg-[var(--assessment-primary)] px-3 py-1 text-xs font-semibold text-white"
              onClick={async () => {
                const res = await diffJobProfileVersions(
                  props.profileId,
                  parseInt(diffFrom, 10),
                  parseInt(diffTo, 10),
                );
                setDiffResult(res.changes);
              }}
            >
              Diff
            </button>
          </div>
          {diffResult?.length ? (
            <ul className="mt-3 space-y-1 text-xs">
              {diffResult.map((c) => (
                <li key={c.path}>
                  <strong>{c.path}</strong> changed
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {props.showStallNotifications ? (
        <section className="nexus-card p-5">
          <h2 className="font-headline-md mb-2">Stall notifications</h2>
          <label className="text-sm">
            Alert after{' '}
            <input
              type="number"
              className="mx-1 w-16 rounded border px-2 py-1"
              defaultValue={notification.stall_days_threshold ?? 7}
              onBlur={(e) =>
                configMutation.mutate({
                  notification_config: {
                    ...notification,
                    stall_days_threshold: Number(e.target.value),
                  },
                })
              }
            />{' '}
            days in stage
          </label>
        </section>
      ) : null}
    </div>
  );
}
