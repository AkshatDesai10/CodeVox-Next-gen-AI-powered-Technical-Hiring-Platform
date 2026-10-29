'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
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

type TabMode = 'single' | 'bulk';
type BulkInputMode = 'excel' | 'paste';

export interface ParsedCandidateRow {
  name: string;
  email: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function todayIsoLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseEmailPaste(raw: string) {
  const tokens = raw
    .split(/[,;\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicateCount = 0;
  for (const token of tokens) {
    const email = token.toLowerCase();
    if (!EMAIL_RE.test(email)) {
      invalid.push(token);
      continue;
    }
    if (seen.has(email)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(email);
    valid.push(email);
  }
  return { valid, invalid, duplicateCount, totalTokens: tokens.length };
}

function parseExcelBuffer(buffer: ArrayBuffer): {
  candidates: ParsedCandidateRow[];
  invalidCount: number;
  duplicateCount: number;
} {
  const wb = XLSX.read(buffer, { type: 'array' });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return { candidates: [], invalidCount: 0, duplicateCount: 0 };
  const ws = wb.Sheets[firstSheetName];
  const rawRows: Array<Record<string, unknown>> = XLSX.utils.sheet_to_json(ws, { defval: '' });

  const seen = new Set<string>();
  const candidates: ParsedCandidateRow[] = [];
  let invalidCount = 0;
  let duplicateCount = 0;

  for (const row of rawRows) {
    let name = '';
    let email = '';

    // First, look for matching keys
    for (const [key, val] of Object.entries(row)) {
      const k = key.trim().toLowerCase().replace(/[^a-z]/g, '');
      const strVal = String(val ?? '').trim();
      if (!email && (k === 'email' || k === 'emailaddress' || k === 'mail' || k === 'candidateemail')) {
        email = strVal;
      } else if (!name && (k === 'name' || k === 'fullname' || k === 'candidatename' || k === 'firstname')) {
        name = strVal;
      }
    }

    // Fallback: If not found by header name, detect email by regex in any column
    if (!email) {
      for (const val of Object.values(row)) {
        const strVal = String(val ?? '').trim();
        if (EMAIL_RE.test(strVal)) {
          email = strVal;
          break;
        }
      }
    }

    // Fallback: If name still empty, pick first non-email non-empty string column
    if (!name) {
      for (const val of Object.values(row)) {
        const strVal = String(val ?? '').trim();
        if (strVal && strVal !== email && !EMAIL_RE.test(strVal)) {
          name = strVal;
          break;
        }
      }
    }

    const normEmail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(normEmail)) {
      if (email.trim()) invalidCount += 1;
      continue;
    }
    if (seen.has(normEmail)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(normEmail);
    candidates.push({
      name: name.trim(),
      email: normEmail,
    });
  }

  return { candidates, invalidCount, duplicateCount };
}

function downloadSampleExcelTemplate() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Full Name', 'Email Address'],
    ['Ram Sharma', 'ram.sharma@example.com'],
    ['Priya Verma', 'priya.verma@example.com'],
    ['Akshat Desai', 'akshat.desai@example.com'],
  ]);
  ws['!cols'] = [{ wch: 25 }, { wch: 35 }];
  XLSX.utils.book_append_sheet(wb, ws, 'Candidates');
  XLSX.writeFile(wb, 'candidates_bulk_invite_template.xlsx');
}

function computeWaterfallPreview(slots: RecruitmentTimeSlot[], candidateCount: number) {
  const allocation: Array<{
    id: string;
    label: string;
    capacity: number;
    remainingBefore: number;
    assigned: number;
    remainingAfter: number;
  }> = [];
  let left = candidateCount;
  for (const slot of slots) {
    const remainingBefore = Math.max(0, Number(slot.remaining ?? 0));
    if (remainingBefore <= 0) continue;
    const assigned = Math.min(remainingBefore, left);
    allocation.push({
      id: slot.id,
      label: slot.display_label || `${slot.start_time} – ${slot.end_time}`,
      capacity: Number(slot.capacity ?? 0),
      remainingBefore,
      assigned,
      remainingAfter: remainingBefore - assigned,
    });
    left -= assigned;
    if (left <= 0) break;
  }
  const totalRemaining = slots.reduce((sum, s) => sum + Math.max(0, Number(s.remaining ?? 0)), 0);
  return { allocation, totalRemaining, overflow: Math.max(0, candidateCount - totalRemaining) };
}

export function AddCandidateDialog({ open, onClose, onCreated }: Props) {
  const [tab, setTab] = useState<TabMode>('bulk');
  const [bulkInputMode, setBulkInputMode] = useState<BulkInputMode>('excel');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [jobProfileId, setJobProfileId] = useState('');
  const [selectedDate, setSelectedDate] = useState(todayIsoLocal);
  const [slotId, setSlotId] = useState('');
  const [resume, setResume] = useState<File | null>(null);
  const [bulkEmailsRaw, setBulkEmailsRaw] = useState('');
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [excelCandidates, setExcelCandidates] = useState<ParsedCandidateRow[]>([]);
  const [excelStats, setExcelStats] = useState<{ invalidCount: number; duplicateCount: number }>({
    invalidCount: 0,
    duplicateCount: 0,
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ sent: number; total: number } | null>(null);
  const [bulkResult, setBulkResult] = useState<BulkInviteResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['job-profiles', 'active-for-manual-candidate'],
    queryFn: () => listJobProfiles({ status: 'active', pageSize: 200 }),
    enabled: open,
  });

  const slotsQuery = useQuery({
    queryKey: ['recruitment-time-slots-available', selectedDate],
    queryFn: () =>
      listRecruitmentTimeSlots({
        availableOnly: true,
        forDate: selectedDate || undefined,
      }),
    enabled: open && Boolean(selectedDate),
  });

  const minDate = useMemo(() => todayIsoLocal(), []);
  const profiles = profilesQuery.data?.items ?? [];
  const slots: RecruitmentTimeSlot[] = slotsQuery.data?.items ?? [];

  const emailParse = useMemo(() => parseEmailPaste(bulkEmailsRaw), [bulkEmailsRaw]);

  // Candidates list depending on input mode
  const effectiveCandidates: ParsedCandidateRow[] = useMemo(() => {
    if (bulkInputMode === 'excel') {
      return excelCandidates;
    }
    return emailParse.valid.map((em) => ({ name: '', email: em }));
  }, [bulkInputMode, excelCandidates, emailParse.valid]);

  const waterfall = useMemo(
    () => computeWaterfallPreview(slots, effectiveCandidates.length),
    [slots, effectiveCandidates.length],
  );

  if (!open) return null;

  const resetAndClose = () => {
    setName('');
    setEmail('');
    setJobProfileId('');
    setSlotId('');
    setResume(null);
    setBulkEmailsRaw('');
    setExcelFile(null);
    setExcelCandidates([]);
    setExcelStats({ invalidCount: 0, duplicateCount: 0 });
    setBulkResult(null);
    setBulkProgress(null);
    setError('');
    setCopiedKey(null);
    setTab('bulk');
    setBulkInputMode('excel');
    onClose();
  };

  const handleExcelUpload = async (file: File | null) => {
    if (!file) {
      setExcelFile(null);
      setExcelCandidates([]);
      return;
    }
    setError('');
    setExcelFile(file);
    try {
      const buffer = await file.arrayBuffer();
      const result = parseExcelBuffer(buffer);
      setExcelCandidates(result.candidates);
      setExcelStats({
        invalidCount: result.invalidCount,
        duplicateCount: result.duplicateCount,
      });
      if (result.candidates.length === 0) {
        setError('No valid candidates found in the Excel file. Please ensure there is a Name and Email column.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read Excel file.');
      setExcelCandidates([]);
    }
  };

  const copyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 1500);
    } catch {
      setError('Could not copy to clipboard');
    }
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
    if (!selectedDate || !slotId) {
      setError('Select the interview date and time.');
      return;
    }
    setSubmitting(true);
    try {
      await createManualCandidate({
        name: name.trim(),
        email: email.trim(),
        jobProfileId,
        slotId,
        slotDate: selectedDate,
        resume,
      });
      resetAndClose();
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the candidate.');
    } finally {
      setSubmitting(false);
    }
  };

  const submitBulk = async () => {
    setError('');
    if (!jobProfileId) {
      setError('Select a job role.');
      return;
    }
    if (!selectedDate) {
      setError('Select an interview date.');
      return;
    }
    if (!effectiveCandidates.length) {
      setError(
        bulkInputMode === 'excel'
          ? 'Upload an Excel file with valid candidates first.'
          : 'Paste at least one valid candidate email address.',
      );
      return;
    }
    if (waterfall.overflow > 0) {
      setError(
        `Total capacity is ${waterfall.totalRemaining} across ${waterfall.allocation.length || slots.length} slots, but ${effectiveCandidates.length} candidates provided. Please add another slot or reduce ${waterfall.overflow} candidates.`,
      );
      return;
    }

    setSubmitting(true);
    setBulkProgress({ sent: 0, total: effectiveCandidates.length });
    const items: BulkInviteResult['items'] = [];
    const failed: BulkInviteResult['failed'] = [];
    const allocationMap = new Map<
      string,
      { slot_id: string; slot_label: string; assigned_count: number; remaining: number }
    >();

    try {
      for (let i = 0; i < effectiveCandidates.length; i += 1) {
        const cand = effectiveCandidates[i];
        setBulkProgress({ sent: i, total: effectiveCandidates.length });
        try {
          const chunk = await bulkInviteCandidates({
            jobProfileId,
            slotDate: selectedDate,
            candidates: [cand],
            emails: [cand.email],
          });
          items.push(...(chunk.items ?? []));
          for (const row of chunk.failed ?? []) failed.push(row);
          for (const row of chunk.allocation ?? []) {
            const prev = allocationMap.get(row.slot_id);
            if (prev) {
              prev.assigned_count += row.assigned_count;
              prev.remaining = row.remaining;
            } else {
              allocationMap.set(row.slot_id, { ...row });
            }
          }
        } catch (err) {
          failed.push({
            email: cand.email,
            error: err instanceof Error ? err.message : 'Invite failed',
          });
        }
        setBulkProgress({ sent: i + 1, total: effectiveCandidates.length });
      }

      setBulkResult({
        total: effectiveCandidates.length,
        invited: items.length,
        failed,
        allocation: Array.from(allocationMap.values()),
        items,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send bulk invites.');
    } finally {
      setSubmitting(false);
      setBulkProgress(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs"
      onClick={resetAndClose}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface)] p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-candidate-title"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="add-candidate-title" className="text-xl font-black text-[var(--assessment-on-surface)]">
              Candidate Invitation Center
            </h2>
            <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)] leading-relaxed">
              Invite candidates directly or in bulk via Excel. Candidates receive magic links with auto-capacity distribution across interview slots.
            </p>
          </div>
          <button
            type="button"
            onClick={resetAndClose}
            className="rounded-lg p-1 text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-low)]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {!bulkResult ? (
          <div className="mb-5 flex gap-1 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] p-1">
            <button
              type="button"
              onClick={() => {
                setTab('bulk');
                setError('');
              }}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition-all ${
                tab === 'bulk'
                  ? 'bg-[var(--assessment-primary)] text-white shadow-xs'
                  : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container)]'
              }`}
            >
              🚀 Bulk Invite (Excel / Multi)
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('single');
                setError('');
              }}
              className={`flex-1 rounded-lg px-3 py-2 text-xs font-bold transition-all ${
                tab === 'single'
                  ? 'bg-[var(--assessment-primary)] text-white shadow-xs'
                  : 'text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container)]'
              }`}
            >
              👤 Single Candidate
            </button>
          </div>
        ) : null}

        {bulkResult ? (
          <div className="flex flex-col gap-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs font-medium text-emerald-900 flex items-center gap-3">
              <span className="material-symbols-outlined text-2xl text-emerald-600">check_circle</span>
              <div>
                <p className="font-bold text-sm">Successfully invited {bulkResult.invited} of {bulkResult.total} candidates.</p>
                {bulkResult.failed.length ? (
                  <p className="text-amber-800 mt-0.5">
                    {bulkResult.failed.length} had delivery issues — copy their direct magic links below.
                  </p>
                ) : null}
              </div>
            </div>

            {bulkResult.allocation.length ? (
              <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] p-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)] mb-2">Slot Allocation Summary</p>
                <ul className="space-y-1 text-xs text-[var(--assessment-on-surface)]">
                  {bulkResult.allocation.map((row) => (
                    <li key={row.slot_id} className="flex justify-between">
                      <span className="font-semibold">{row.slot_label}</span>
                      <span>{row.assigned_count} assigned {row.remaining > 0 ? `(${row.remaining} left)` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">Generated Magic Links</p>
              <button
                type="button"
                className="rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)] hover:bg-slate-50 shadow-2xs"
                onClick={() =>
                  void copyText(
                    'all',
                    bulkResult.items
                      .map((item) => `${item.email}\t${item.interview_url}`)
                      .join('\n'),
                  )
                }
              >
                {copiedKey === 'all' ? 'Copied ✓' : 'Copy All Links'}
              </button>
            </div>

            <ul className="max-h-60 space-y-2 overflow-y-auto">
              {bulkResult.items.map((item) => (
                <li
                  key={item.invite_token}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="truncate font-bold text-[var(--assessment-on-surface)]">
                      {item.email}
                    </div>
                    <div className="truncate text-[11px] text-[var(--assessment-on-surface-variant)]">
                      {item.slot_label}
                    </div>
                    {!item.email_sent ? (
                      <div className="text-[10px] font-semibold text-amber-700">Email not sent — use copy link</div>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-2.5 py-1 text-xs font-bold hover:bg-slate-100"
                    onClick={() => void copyText(item.invite_token, item.interview_url)}
                  >
                    {copiedKey === item.invite_token ? 'Copied' : 'Copy'}
                  </button>
                </li>
              ))}
            </ul>

            {error ? (
              <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>
            ) : null}

            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={resetAndClose}
                className="rounded-xl bg-[var(--assessment-primary)] px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        ) : tab === 'single' ? (
          <>
            <div className="flex flex-col gap-3.5">
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                Full Name
                <input
                  className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-3 py-2.5 text-xs font-normal text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Ram Sharma"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                Email Address
                <input
                  type="email"
                  className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-3 py-2.5 text-xs font-normal text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ram.sharma@example.com"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                Target Job Role
                <select
                  className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-3 py-2.5 text-xs font-normal text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
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
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                Resume (Optional)
                <input
                  type="file"
                  accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  className="w-full text-xs text-[var(--assessment-on-surface-variant)]"
                  onChange={(e) => setResume(e.target.files?.[0] ?? null)}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                Interview Date
                <input
                  type="date"
                  min={minDate}
                  className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-3 py-2.5 text-xs font-normal text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
                  value={selectedDate}
                  onChange={(e) => {
                    setSelectedDate(e.target.value);
                    setSlotId('');
                  }}
                />
              </label>

              {!selectedDate ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Select a date to see available time slots.
                </div>
              ) : slotsQuery.isLoading ? (
                <p className="text-xs text-[var(--assessment-on-surface-variant)]">Loading available times...</p>
              ) : slots.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  No open time slots for this date. Add slots under Hiring → Time Slots, or pick another day.
                </div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold text-[var(--assessment-on-surface-variant)]">Choose Time Slot</span>
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                    {slots.map((slot) => {
                      const checked = slotId === slot.id;
                      return (
                        <li key={slot.id}>
                          <label
                            className={`flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-xs transition-colors ${
                              checked
                                ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/15 font-bold text-[var(--assessment-primary)]'
                                : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] text-[var(--assessment-on-surface)] hover:border-[var(--assessment-primary)]'
                            }`}
                          >
                            <div className="flex items-center gap-2.5">
                              <input
                                type="radio"
                                name="manual-candidate-slot"
                                checked={checked}
                                onChange={() => setSlotId(slot.id)}
                              />
                              <span>{slot.display_label || `${slot.start_time} – ${slot.end_time}`}</span>
                            </div>
                            <span className="text-[11px] text-[var(--assessment-on-surface-variant)] font-normal">
                              {slot.remaining} seats left
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">{error}</div>
              ) : null}
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={resetAndClose}
                className="rounded-xl border border-[var(--assessment-outline-variant)] px-4 py-2 text-xs font-semibold text-[var(--assessment-on-surface-variant)] hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void submitSingle()}
                className="rounded-xl bg-[var(--assessment-primary)] px-5 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-60"
              >
                {submitting ? 'Sending...' : 'Create & Send Magic Link'}
              </button>
            </div>
          </>
        ) : (
          /* Bulk Invite Tab */
          <>
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                  Target Job Role
                  <select
                    className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-3 py-2.5 text-xs font-normal text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
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
                <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
                  Interview Date
                  <input
                    type="date"
                    min={minDate}
                    className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-3 py-2.5 text-xs font-normal text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                  />
                </label>
              </div>

              {/* Mode Toggle: Excel File vs Text Paste */}
              <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] pb-2">
                <div className="flex items-center gap-1.5 p-1 bg-[var(--assessment-surface-container-low)] rounded-xl border border-[var(--assessment-outline-variant)]">
                  <button
                    type="button"
                    onClick={() => {
                      setBulkInputMode('excel');
                      setError('');
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      bulkInputMode === 'excel'
                        ? 'bg-[var(--assessment-primary)] text-white shadow-xs'
                        : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">description</span>
                    Excel / CSV File
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setBulkInputMode('paste');
                      setError('');
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
                      bulkInputMode === 'paste'
                        ? 'bg-[var(--assessment-primary)] text-white shadow-xs'
                        : 'text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-on-surface)]'
                    }`}
                  >
                    <span className="material-symbols-outlined text-[16px]">edit_note</span>
                    Paste Emails
                  </button>
                </div>

                {bulkInputMode === 'excel' && (
                  <button
                    type="button"
                    onClick={downloadSampleExcelTemplate}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--assessment-primary)] hover:text-indigo-900 transition-colors"
                  >
                    <span className="material-symbols-outlined text-[15px]">download</span>
                    Download Template (.xlsx)
                  </button>
                )}
              </div>

              {/* Excel Upload Section */}
              {bulkInputMode === 'excel' ? (
                <div className="flex flex-col gap-3">
                  <label className="group relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)]/60 px-4 py-6 text-center hover:bg-[var(--assessment-surface-container-high)] hover:border-[var(--assessment-primary)] transition-colors">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
                      className="absolute inset-0 cursor-pointer opacity-0"
                      onChange={(e) => void handleExcelUpload(e.target.files?.[0] ?? null)}
                    />
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm">
                      <span className="material-symbols-outlined text-2xl">upload_file</span>
                    </div>
                    {excelFile ? (
                      <div>
                        <p className="text-xs font-semibold text-[var(--assessment-on-surface)]">{excelFile.name}</p>
                        <p className="text-[11px] text-[var(--assessment-primary)] font-semibold mt-0.5">
                          {excelCandidates.length} candidate{excelCandidates.length === 1 ? '' : 's'} detected · Click to replace
                        </p>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-semibold text-[var(--assessment-on-surface)]">
                          Drop candidates Excel (.xlsx, .xls, .csv) here
                        </p>
                        <p className="text-[11px] text-[var(--assessment-on-surface-variant)] mt-0.5">
                          Must contain columns: <span className="font-semibold text-[var(--assessment-on-surface)]">Full Name</span> &amp; <span className="font-semibold text-[var(--assessment-on-surface)]">Email Address</span>
                        </p>
                      </div>
                    )}
                  </label>

                  {/* Excel Candidates Preview */}
                  {excelCandidates.length > 0 && (
                    <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] overflow-hidden shadow-2xs">
                      <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] bg-slate-50 px-3 py-2">
                        <span className="text-[11px] font-bold text-[var(--assessment-on-surface)] uppercase tracking-wider">
                          Candidates Preview ({excelCandidates.length})
                        </span>
                        {excelStats.duplicateCount > 0 && (
                          <span className="text-[10px] text-[var(--assessment-on-surface-variant)] font-medium">
                            {excelStats.duplicateCount} duplicate(s) filtered
                          </span>
                        )}
                      </div>
                      <div className="max-h-36 overflow-y-auto divide-y divide-slate-100">
                        {excelCandidates.map((c, idx) => (
                          <div key={idx} className="flex items-center justify-between px-3 py-1.5 text-xs">
                            <span className="font-bold text-[var(--assessment-on-surface)] truncate mr-2">
                              {c.name || <span className="italic text-slate-400 font-normal">No name</span>}
                            </span>
                            <span className="text-[var(--assessment-on-surface-variant)] font-mono-data text-[11px] shrink-0">{c.email}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* Textarea Paste Section */
                <div className="flex flex-col gap-2">
                  <textarea
                    rows={4}
                    className="w-full rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-3 py-2.5 text-xs font-normal text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)] focus:ring-2 focus:ring-[var(--assessment-primary)]/20 font-mono-data"
                    value={bulkEmailsRaw}
                    onChange={(e) => setBulkEmailsRaw(e.target.value)}
                    placeholder="Paste emails separated by comma, space, or new lines"
                  />
                  <div className="text-[11px] text-[var(--assessment-on-surface-variant)] flex gap-2">
                    <span className="font-semibold text-[var(--assessment-on-surface)]">Valid: {emailParse.valid.length}</span>
                    {emailParse.invalid.length ? <span>· Invalid: {emailParse.invalid.length}</span> : null}
                    {emailParse.duplicateCount ? <span>· Duplicates: {emailParse.duplicateCount}</span> : null}
                  </div>
                </div>
              )}

              {/* Slot Allocation Waterfall Preview */}
              {!selectedDate ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  Select an interview date to view slot capacity.
                </div>
              ) : slotsQuery.isLoading ? (
                <p className="text-xs text-[var(--assessment-on-surface-variant)]">Loading slot capacity...</p>
              ) : slots.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  No open time slots for this date. Please add slots or select another date.
                </div>
              ) : (
                <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] p-3.5">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[var(--assessment-on-surface)]">
                      Auto-Capacity Allocation Preview
                    </span>
                    <span className="rounded-md bg-white border border-[var(--assessment-outline-variant)] px-2 py-0.5 text-[11px] font-bold text-[var(--assessment-primary)] shadow-2xs">
                      Total Capacity: {waterfall.totalRemaining}
                    </span>
                  </div>

                  {effectiveCandidates.length === 0 ? (
                    <p className="text-xs text-[var(--assessment-on-surface-variant)] italic">
                      Upload an Excel sheet or paste emails to see how candidates are assigned across slots.
                    </p>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-[var(--assessment-on-surface)]">
                      {waterfall.allocation.map((row) => (
                        <li key={row.id} className="flex items-center justify-between rounded-lg bg-white p-2 border border-[var(--assessment-outline-variant)] shadow-2xs">
                          <span className="font-semibold">{row.label}</span>
                          <span className="text-emerald-700 font-bold">
                            {row.assigned} assigned {row.remainingAfter > 0 ? `(${row.remainingAfter} remaining)` : ''}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {waterfall.overflow > 0 ? (
                    <div className="mt-2 rounded-xl border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 font-medium">
                      ⚠️ Capacity limit reached: {waterfall.totalRemaining} available across {waterfall.allocation.length || slots.length} slots, but {effectiveCandidates.length} candidates uploaded. Please add another slot or reduce {waterfall.overflow} candidates.
                    </div>
                  ) : null}
                </div>
              )}

              {error ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800 font-medium">{error}</div>
              ) : null}

              {submitting && bulkProgress ? (
                <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] p-3">
                  <div className="mb-2 flex items-center justify-between text-xs font-semibold text-[var(--assessment-on-surface)]">
                    <span>
                      {bulkProgress.sent}/{bulkProgress.total} invites sent
                      {bulkProgress.sent < bulkProgress.total
                        ? ` · sending invite ${bulkProgress.sent + 1}...`
                        : ''}
                    </span>
                    <span className="font-mono-data text-[var(--assessment-primary)]">
                      {Math.round((bulkProgress.sent / Math.max(bulkProgress.total, 1)) * 100)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--assessment-surface-container-low)]">
                    <div
                      className="h-full rounded-full bg-[var(--assessment-primary)] transition-all duration-300"
                      style={{
                        width: `${Math.round((bulkProgress.sent / Math.max(bulkProgress.total, 1)) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={resetAndClose}
                disabled={submitting}
                className="rounded-xl border border-[var(--assessment-outline-variant)] px-4 py-2 text-xs font-semibold text-[var(--assessment-on-surface-variant)] hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting || waterfall.overflow > 0 || !effectiveCandidates.length}
                onClick={() => void submitBulk()}
                className="rounded-xl bg-[var(--assessment-primary)] px-5 py-2 text-xs font-bold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {submitting && bulkProgress
                  ? bulkProgress.sent < bulkProgress.total
                    ? `Sending ${bulkProgress.sent + 1}/${bulkProgress.total}...`
                    : `${bulkProgress.sent}/${bulkProgress.total} sent`
                  : submitting
                    ? 'Sending...'
                    : `Send ${effectiveCandidates.length > 0 ? `${effectiveCandidates.length} ` : ''}Bulk Invites`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
