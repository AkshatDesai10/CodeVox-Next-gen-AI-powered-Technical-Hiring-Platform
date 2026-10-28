'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { RecruitmentOpsShell } from '@/modules/recruitment/components/RecruitmentOpsShell';
import {
  draftInterviewResultAi,
  getRecruitmentInterview,
  updateInterviewChecklist,
  updateInterviewStatus,
} from '@/modules/recruitment/lib/recruitment-api';

const STATUS_FLOW = [
  'Scheduled',
  'In Progress',
  'Completed',
  'Result Pending',
  'Result Declared',
];

export function InterviewDetailPage() {
  const params = useParams();
  const id = String(params?.id ?? '');
  const queryClient = useQueryClient();
  const [resultForm, setResultForm] = useState({ result: '', remark: '' });
  const [actionReason, setActionReason] = useState('');

  const detailQuery = useQuery({
    queryKey: ['recruitment-interview', id],
    queryFn: () => getRecruitmentInterview(id),
  });

  const statusMutation = useMutation({
    mutationFn: (body: Parameters<typeof updateInterviewStatus>[1]) =>
      updateInterviewStatus(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recruitment-interview', id] }),
  });

  const checklistMutation = useMutation({
    mutationFn: (body: Record<string, boolean>) => updateInterviewChecklist(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recruitment-interview', id] }),
  });

  const aiDraftMutation = useMutation({
    mutationFn: () => draftInterviewResultAi(id),
    onSuccess: (draft) => {
      setResultForm({
        result: String(draft.interview_result ?? ''),
        remark: String(draft.interview_remark ?? ''),
      });
    },
  });

  if (detailQuery.isLoading) {
    return (
      <RecruitmentOpsShell title="Interview">
        <p className="text-sm">Loading...</p>
      </RecruitmentOpsShell>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <RecruitmentOpsShell title="Interview">
        <p className="text-sm text-red-600">Interview not found.</p>
      </RecruitmentOpsShell>
    );
  }

  const data = detailQuery.data as {
    interview: Record<string, unknown>;
    lead: Record<string, unknown> | null;
    all_rounds: Array<Record<string, unknown>>;
    checklist: Record<string, boolean> | null;
    status_history: Array<{ from_status: string | null; to_status: string; changed_at: string }>;
    ai_brief: string | null;
  };

  const interview = data.interview;
  const leadId = String(interview.lead_id ?? '');

  return (
    <RecruitmentOpsShell title="Interview Detail">
      <div className="space-y-6">
        <div>
          <Link
            href="/assessments/recruitment/interviews"
            className="text-sm text-[var(--assessment-on-surface-variant)]"
          >
            ← Interviews
          </Link>
          <h1 className="mt-2 font-display-lg">{String(interview.candidate_name ?? 'Interview')}</h1>
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            {String(interview.course_name)} | {String(interview.interview_type)} |{' '}
            {String(interview.effective_status ?? interview.interview_status)}
          </p>
          {data.ai_brief ? (
            <p className="mt-2 text-sm">
              <span className="font-semibold text-[var(--codevox-tertiary)]">AI brief: </span>
              {data.ai_brief}
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {interview.meeting_url ? (
            <a
              href={String(interview.meeting_url)}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              Join meeting
            </a>
          ) : null}
          {leadId ? (
            <Link
              href={`/assessments/recruitment/leads/${leadId}`}
              className="rounded-lg border px-4 py-2 text-sm font-semibold"
            >
              View lead
            </Link>
          ) : null}
        </div>

        <section className="codevox-card grid gap-4 p-4 md:grid-cols-2">
          <Info label="Date" value={`${interview.appointment_date} ${interview.appointment_time}`} />
          <Info label="Mode" value={String(interview.interview_mode ?? '-')} />
          <Info label="Interview status" value={String(interview.interview_status ?? '-')} />
          <Info label="Portal status" value={String(interview.portal_status ?? '-')} />
          <Info label="Remarks" value={String(interview.remarks_desc ?? '-')} />
          <Info label="Recruiter" value={String(interview.created_by_name ?? '-')} />
        </section>

        <section className="codevox-card p-4">
          <h2 className="mb-3 font-semibold">Status lifecycle</h2>
          <div className="flex flex-wrap gap-2">
            {STATUS_FLOW.map((s) => (
              <button
                key={s}
                type="button"
                className="rounded border px-3 py-1 text-xs font-semibold hover:bg-[var(--assessment-surface-container-low)]"
                onClick={() => statusMutation.mutate({ portal_status: s })}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border border-red-300 px-3 py-1 text-xs text-red-700"
              onClick={() =>
                statusMutation.mutate({
                  portal_status: 'No-show',
                  no_show_reason: actionReason || 'No show',
                })
              }
            >
              No-show
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1 text-xs"
              onClick={() =>
                statusMutation.mutate({
                  portal_status: 'Rescheduled',
                  reschedule_reason: actionReason || 'Rescheduled',
                })
              }
            >
              Reschedule
            </button>
            <button
              type="button"
              className="rounded border px-3 py-1 text-xs"
              onClick={() =>
                statusMutation.mutate({
                  portal_status: 'Cancelled',
                  cancel_reason: actionReason || 'Cancelled',
                })
              }
            >
              Cancel
            </button>
          </div>
          <input
            className="mt-2 w-full max-w-md rounded border px-3 py-2 text-sm"
            placeholder="Reason for no-show / reschedule / cancel"
            value={actionReason}
            onChange={(e) => setActionReason(e.target.value)}
          />
        </section>

        <section className="codevox-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold">Post-interview result</h2>
            <button
              type="button"
              className="text-sm text-[var(--assessment-primary)]"
              onClick={() => aiDraftMutation.mutate()}
            >
              AI draft result
            </button>
          </div>
          <div className="space-y-3">
            <input
              className="w-full rounded border px-3 py-2 text-sm"
              placeholder="Interview result"
              value={resultForm.result}
              onChange={(e) => setResultForm((f) => ({ ...f, result: e.target.value }))}
            />
            <textarea
              className="w-full rounded border px-3 py-2 text-sm"
              rows={3}
              placeholder="Interview remark"
              value={resultForm.remark}
              onChange={(e) => setResultForm((f) => ({ ...f, remark: e.target.value }))}
            />
            <button
              type="button"
              className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm text-white"
              onClick={() =>
                statusMutation.mutate({
                  portal_status: 'Result Declared',
                  result: resultForm.result,
                  remark: resultForm.remark,
                })
              }
            >
              Save result
            </button>
          </div>
        </section>

        <section className="codevox-card p-4">
          <h2 className="mb-3 font-semibold">Pre-interview checklist</h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ['consent_acknowledged', 'Consent acknowledged'],
                ['remarks_sent', 'Remarks sent'],
                ['reminder_24h_sent', '24h reminder'],
                ['reminder_1h_sent', '1h reminder'],
                ['reminder_15m_sent', '15m reminder'],
                ['candidate_confirmed', 'Candidate confirmed'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={data.checklist?.[key] ?? false}
                  onChange={(e) => checklistMutation.mutate({ [key]: e.target.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </section>

        <section className="codevox-card p-4">
          <h2 className="mb-3 font-semibold">All rounds</h2>
          <ul className="space-y-2 text-sm">
            {data.all_rounds?.map((r) => (
              <li key={String(r.id)} className="rounded border p-2">
                {String(r.interview_type)} | {String(r.appointment_date)} |{' '}
                {String(r.interview_status)}
              </li>
            ))}
          </ul>
        </section>

        <section className="codevox-card p-4">
          <h2 className="mb-3 font-semibold">Status history</h2>
          <ul className="space-y-1 text-sm">
            {data.status_history?.map((h, i) => (
              <li key={i}>
                {h.from_status ?? '-'} → {h.to_status}{' '}
                <span className="text-xs text-[var(--assessment-on-surface-variant)]">
                  {new Date(h.changed_at).toLocaleString()}
                </span>
              </li>
            )) ?? <li>No history</li>}
          </ul>
        </section>
      </div>
    </RecruitmentOpsShell>
  );
}

function Info(props: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase text-[var(--assessment-on-surface-variant)]">
        {props.label}
      </p>
      <p className="text-sm font-medium">{props.value}</p>
    </div>
  );
}
