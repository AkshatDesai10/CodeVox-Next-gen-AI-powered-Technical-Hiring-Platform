'use client';

import { useState } from 'react';
import { onboardCandidate } from '@/lib/candidate-api';

type Props = {
  token: string;
  jobTitle: string;
  email: string;
  needsName: boolean;
  needsResume: boolean;
  assignedSlotLabel?: string | null;
  initialName?: string;
  onComplete: () => void | Promise<void>;
};

export function CandidatePortalOnboardingGate({
  token,
  jobTitle,
  email,
  needsName,
  needsResume,
  assignedSlotLabel,
  initialName,
  onComplete,
}: Props) {
  const starterName =
    initialName && initialName.trim().toLowerCase() !== 'pending' ? initialName.trim() : '';
  const [name, setName] = useState(starterName);
  const [resume, setResume] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError(null);
    const trimmed = name.trim();
    if (needsName && !trimmed) {
      setError('Please enter your full name.');
      return;
    }
    if (needsResume && !resume) {
      setError('Please upload your resume (PDF or DOCX).');
      return;
    }
    if (!trimmed) {
      setError('Please enter your full name.');
      return;
    }

    setBusy(true);
    try {
      await onboardCandidate(token, { name: trimmed, resume });
      await onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#090414]/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-[#160A30] p-8 shadow-2xl">
        <div className="mb-1 text-xs font-bold uppercase tracking-widest text-[#C4B5FD]">
          Welcome
        </div>
        <h2 className="text-2xl font-extrabold tracking-tight text-white">Complete your profile</h2>
        <p className="mt-2 text-sm text-[#94A3B8]">
          Confirm a few details before you enter the assessment dashboard.
        </p>

        <div className="mt-6 space-y-4">
          <LockedField label="Job role" value={jobTitle} />
          <LockedField label="Email" value={email} />
          {assignedSlotLabel ? (
            <LockedField label="Assigned slot" value={assignedSlotLabel} />
          ) : null}

          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            Full name{needsName ? ' *' : ''}
            <input
              className="rounded-xl border border-white/10 bg-[#090414] px-3 py-2.5 text-sm font-normal normal-case tracking-normal text-white outline-none placeholder:text-[#64748B] focus:border-[#7C3AED]/60 focus:ring-2 focus:ring-[#7C3AED]/30"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your full name"
              disabled={busy}
              autoComplete="name"
            />
          </label>

          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
            Resume{needsResume ? ' *' : ' (optional)'}
            <input
              type="file"
              accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              className="w-full text-sm font-normal normal-case tracking-normal text-[#C4B5FD] file:mr-3 file:rounded-lg file:border-0 file:bg-[#7C3AED]/20 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-[#C4B5FD]"
              onChange={(e) => setResume(e.target.files?.[0] ?? null)}
              disabled={busy}
            />
            <span className="text-[11px] font-normal normal-case tracking-normal text-[#64748B]">
              PDF or DOCX, up to 8MB
            </span>
          </label>

          {error ? (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={() => void submit()}
          className="mt-6 w-full rounded-xl bg-[#7C3AED] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-purple-500/20 transition hover:bg-[#6D28D9] disabled:opacity-60"
        >
          {busy ? 'Saving...' : 'Save & Enter Assessment'}
        </button>
      </div>
    </div>
  );
}

function LockedField(props: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-[#94A3B8]">
        {props.label}
      </span>
      <div className="rounded-xl border border-white/5 bg-[#090414]/70 px-3 py-2.5 text-sm text-[#C4B5FD]">
        {props.value}
      </div>
    </div>
  );
}
