'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { listJobProfiles } from '@/modules/job-profiles/lib/job-profiles-api';
import {
  bulkInviteCandidates,
  createManualCandidate,
  listRecruitmentTimeSlots,
  type BulkInviteResult,
  type RecruitmentTimeSlot,
} from '@/modules/recruitment/lib/recruitment-api';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

type DialogTab = 'single' | 'bulk';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

function todayIsoLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseEmailPaste(raw: string) {
  const tokens = raw
    .split(/[,;\s\n\r]+/)
    .map((t) => t.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const validEmails: string[] = [];
  let invalid = 0;
  let duplicatesRemoved = 0;

  for (const token of tokens) {
    if (!EMAIL_RE.test(token)) {
      invalid += 1;
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) {
      duplicatesRemoved += 1;
      continue;
    }
    seen.add(key);
    validEmails.push(token);
  }

  return {
    validEmails,
    invalid,
    duplicatesRemoved,
    rawTokenCount: tokens.length,
  };
}

function buildWaterfallPreview(slots: RecruitmentTimeSlot[], emailCount: number) {
  const ordered = [...slots]
    .filter((s) => (s.remaining ?? 0) > 0)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));

  let leftover = emailCount;
  const rows: Array<{
    slot: RecruitmentTimeSlot;
    assigned: number;
    remainingAfter: number;
  }> = [];
  let totalRemaining = 0;

  for (const slot of ordered) {
    const remaining = Math.max(0, Number(slot.remaining ?? 0));
    totalRemaining += remaining;
    const assigned = leftover > 0 ? Math.min(remaining, leftover) : 0;
    leftover -= assigned;
    rows.push({
      slot,
      assigned,
      remainingAfter: remaining - assigned,
    });
  }

  return { rows, totalRemaining, slotCount: ordered.length };
}

function formatLinksForWhatsApp(items: BulkInviteResult['items']) {
  return items
    .filter((item) => item.interview_url)
    .map((item) => `${item.email}\n${item.interview_url}`)
    .join('\n\n');
}

export function AddCandidateDialog({ open, onClose, onCreated }: Props) {
  const [tab, setTab] = useState<DialogTab>('single');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [jobProfileId, setJobProfileId] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [bulkJobProfileId, setBulkJobProfileId] = useState('');
  const [slotDate, setSlotDate] = useState(todayIsoLocal);
  const [emailsRaw, setEmailsRaw] = useState('');
  const [bulkResult, setBulkResult] = useState<BulkInviteResult | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['job-profiles', 'active-for-manual-candidate'],
    queryFn: () => listJobProfiles({ status: 'active', pageSize: 200 }),
    enabled: open,
  });

  const slotsQuery = useQuery({
    queryKey: ['recruitment-time-slots-available', slotDate],
    queryFn: () =>
      listRecruitmentTimeSlots({
        availableOnly: true,
        forDate: slotDate || undefined,
      }),
    enabled: open && tab === 'bulk' && Boolean(slotDate) && Boolean(bulkJobProfileId),
  });

  const profiles = profilesQuery.data?.items ?? [];
  const slots: RecruitmentTimeSlot[] = slotsQuery.data?.items ?? [];
  const parsed = useMemo(() => parseEmailPaste(emailsRaw), [emailsRaw]);
  const waterfall = useMemo(
    () => buildWaterfallPreview(slots, parsed.validEmails.length),
    [slots, parsed.validEmails.length],
  );

  const capacityOverflow =
    Boolean(bulkJobProfileId) &&
    Boolean(slotDate) &&
    parsed.validEmails.length > 0 &&
    !slotsQuery.isLoading &&
    parsed.validEmails.length > waterfall.totalRemaining;

  const capacityAlert = capacityOverflow
    ? `Total capacity is ${waterfall.totalRemaining} across ${waterfall.slotCount} slots, but ${parsed.validEmails.length} emails pasted. Please add another slot or reduce ${parsed.validEmails.length - waterfall.totalRemaining} candidates.`
    : waterfall.totalRemaining === 0 &&
        Boolean(bulkJobProfileId) &&
        Boolean(slotDate) &&
        parsed.validEmails.length > 0 &&
        !slotsQuery.isLoading
      ? 'No open time slots with remaining capacity for the selected date. Please add or reopen a slot.'
      : '';

  const minDate = useMemo(() => todayIsoLocal(), []);

  if (!open) return null;

  const resetBulk = () => {
    setBulkJobProfileId('');
    setSlotDate(todayIsoLocal());
    setEmailsRaw('');
    setBulkResult(null);
    setCopiedAll(false);
    setCopiedEmail(null);
  };

  const handleClose = () => {
    setError('');
    setBulkResult(null);
    onClose();
  };

  const submitSingle = async () => {
    setError('');
    if (!name.trim() || !email.trim().includes('@')) {
      setError('Enter the candidate name and a valid email.');
      return;
    }
    if (!jobProfileId) {
      setError('Select a job role.');
      return;
    }
    setSubmitting(true);
    try {
      await createManualCandidate({
        name: name.trim(),
        email: email.trim(),
        jobProfileId,
        resume,
      });
      setName('');
      setEmail('');
      setJobProfileId('');
      setResume(null);
      onCreated();
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitBulk = async () => {
    setError('');
    if (!bulkJobProfileId) {
      setError('Select a job role.');
      return;
    }
    if (!slotDate) {
      setError('Select an interview date.');
      return;
    }
    if (!parsed.validEmails.length) {
      setError('Provide at least one valid email.');
      return;
    }
    if (capacityOverflow || waterfall.totalRemaining === 0) {
      setError(capacityAlert || 'Not enough capacity for these emails.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await bulkInviteCandidates({
        emails: parsed.validEmails,
        jobProfileId: bulkJobProfileId,
        slotDate,
      });
      setBulkResult(result);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk invite failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const copyText = async (text: string, emailKey?: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (emailKey) {
        setCopiedEmail(emailKey);
        setTimeout(() => setCopiedEmail(null), 1500);
      } else {
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 1500);
      }
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const inputClass =
    'w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)] outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30';
  const labelClass =
    'flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-candidate-title"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="add-candidate-title" className="text-lg font-semibold text-[var(--assessment-on-surface)]">
              Add candidate
            </h2>
            <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
              {tab === 'single'
                ? 'Create the candidate here. They get a magic link by email and open their dashboard directly.'
                : 'Paste emails and auto-allocate interview slots by capacity.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded p-1 text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-low)]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {!bulkResult ? (
          <div className="mb-4 flex gap-1 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-1">
            <button
              type="button"
              onClick={() => {
                setTab('single');
                setError('');
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                tab === 'single'
                  ? 'bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface)] shadow-sm'
                  : 'text-[var(--assessment-on-surface-variant)]'
              }`}
            >
              Single
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('bulk');
                setError('');
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition ${
                tab === 'bulk'
                  ? 'bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface)] shadow-sm'
                  : 'text-[var(--assessment-on-surface-variant)]'
              }`}
            >
              Bulk Invite (Auto Slot Allocation)
            </button>
          </div>
        ) : null}

        {bulkResult ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
              Invited {bulkResult.invited} candidate{bulkResult.invited === 1 ? '' : 's'}
              {bulkResult.skipped ? ` · ${bulkResult.skipped} skipped` : ''}
              {bulkResult.failed ? ` · ${bulkResult.failed} failed` : ''}
            </div>

            {bulkResult.allocation && bulkResult.allocation.length > 0 ? (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                  Allocation
                </h3>
                <ul className="space-y-1 text-sm text-[var(--assessment-on-surface)]">
                  {bulkResult.allocation.map((row) => (
                    <li key={row.slot_id}>
                      {row.slot_label}: {row.assigned} candidate{row.assigned === 1 ? '' : 's'} assigned
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                  Magic links
                </h3>
                <button
                  type="button"
                  onClick={() => void copyText(formatLinksForWhatsApp(bulkResult.items))}
                  className="rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-1.5 text-xs font-semibold text-[var(--assessment-on-surface)] hover:bg-[var(--assessment-surface-container-low)]"
                >
                  {copiedAll ? 'Copied!' : 'Copy All Links'}
                </button>
              </div>
              <ul className="max-h-56 space-y-2 overflow-y-auto">
                {bulkResult.items.map((item) => (
                  <li
                    key={`${item.email}-${item.invite_token ?? item.status}`}
                    className="rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium text-[var(--assessment-on-surface)]">
                          {item.email}
                        </div>
                        <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                          {item.slot_label || item.status}
                          {item.error ? ` · ${item.error}` : ''}
                        </div>
                        {item.interview_url ? (
                          <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--assessment-primary)]">
                            {item.interview_url}
                          </div>
                        ) : null}
                      </div>
                      {item.interview_url ? (
                        <button
                          type="button"
                          onClick={() =>
                            void copyText(`${item.email}\n${item.interview_url}`, item.email)
                          }
                          className="shrink-0 text-xs font-semibold text-[var(--assessment-primary)] hover:underline"
                        >
                          {copiedEmail === item.email ? 'Copied' : 'Copy'}
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="mt-1 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  resetBulk();
                  setTab('bulk');
                }}
                className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
              >
                Invite more
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white"
              >
                Done
              </button>
            </div>
          </div>
        ) : tab === 'single' ? (
          <>
            <div className="flex flex-col gap-3">
              <label className={labelClass}>
                Name
                <input
                  className={inputClass}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Candidate name"
                />
              </label>
              <label className={labelClass}>
                Email
                <input
                  type="email"
                  className={inputClass}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@email.com"
                />
              </label>
              <label className={labelClass}>
                Job role
                <select
                  className={inputClass}
                  value={jobProfileId}
                  onChange={(e) => setJobProfileId(e.target.value)}
                >
                  <option value="">Select a role</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Resume (optional)
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="w-full text-sm font-normal text-[var(--assessment-on-surface)]"
                  onChange={(e) => setResume(e.target.files?.[0] ?? null)}
                />
              </label>
              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitSingle()}
                className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {submitting ? 'Sending...' : 'Create and send link'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-3">
              <label className={labelClass}>
                Job role
                <select
                  className={inputClass}
                  value={bulkJobProfileId}
                  onChange={(e) => setBulkJobProfileId(e.target.value)}
                >
                  <option value="">Select a role</option>
                  {profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.title}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Interview date
                <input
                  type="date"
                  min={minDate}
                  className={inputClass}
                  value={slotDate}
                  onChange={(e) => setSlotDate(e.target.value)}
                />
              </label>
              <label className={labelClass}>
                Emails
                <textarea
                  className={`${inputClass} min-h-[120px] resize-y font-mono`}
                  value={emailsRaw}
                  onChange={(e) => setEmailsRaw(e.target.value)}
                  placeholder="Paste emails separated by commas, spaces, or new lines"
                />
              </label>

              {emailsRaw.trim() ? (
                <div className="flex flex-wrap gap-2 text-xs text-[var(--assessment-on-surface-variant)]">
                  <span className="rounded-md bg-[var(--assessment-surface-container-low)] px-2 py-1 font-semibold">
                    Valid: {parsed.validEmails.length}
                  </span>
                  <span className="rounded-md bg-[var(--assessment-surface-container-low)] px-2 py-1 font-semibold">
                    Invalid: {parsed.invalid}
                  </span>
                  <span className="rounded-md bg-[var(--assessment-surface-container-low)] px-2 py-1 font-semibold">
                    Duplicates removed: {parsed.duplicatesRemoved}
                  </span>
                </div>
              ) : null}

              {bulkJobProfileId && slotDate ? (
                <div className="rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-3">
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                    Capacity preview
                  </h3>
                  {slotsQuery.isLoading ? (
                    <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                      Loading available slots...
                    </p>
                  ) : waterfall.rows.length === 0 && waterfall.totalRemaining === 0 ? (
                    <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                      No open slots with remaining capacity for this date.
                    </p>
                  ) : (
                    <>
                      <ul className="space-y-1 text-sm text-[var(--assessment-on-surface)]">
                        {waterfall.rows.map(({ slot, assigned, remainingAfter }) => (
                          <li key={slot.id}>
                            {slot.display_label || `${slot.start_time} – ${slot.end_time}`}:{' '}
                            {assigned} candidate{assigned === 1 ? '' : 's'} assigned ({remainingAfter}{' '}
                            seat{remainingAfter === 1 ? '' : 's'} remaining)
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                        Total available capacity: {waterfall.totalRemaining}
                      </p>
                    </>
                  )}
                </div>
              ) : null}

              {capacityAlert ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  {capacityAlert}
                </div>
              ) : null}

              {error ? (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {error}
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={handleClose}
                className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  submitting ||
                  !parsed.validEmails.length ||
                  !bulkJobProfileId ||
                  !slotDate ||
                  Boolean(capacityAlert)
                }
                onClick={() => void submitBulk()}
                className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {submitting ? 'Sending...' : 'Send invites'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
