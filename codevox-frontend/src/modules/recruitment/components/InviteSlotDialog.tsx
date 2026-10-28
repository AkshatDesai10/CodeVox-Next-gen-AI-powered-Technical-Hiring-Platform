'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  listRecruitmentTimeSlots,
  type RecruitmentTimeSlot,
} from '@/modules/recruitment/lib/recruitment-api';

type Props = {
  open: boolean;
  title?: string;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (input: { slotId: string; slotDate: string }) => void;
};

function todayIsoLocal() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function InviteSlotDialog({
  open,
  title = 'Schedule magic link',
  submitting = false,
  onClose,
  onConfirm,
}: Props) {
  const [selectedDate, setSelectedDate] = useState(todayIsoLocal);
  const [selectedId, setSelectedId] = useState('');

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

  if (!open) return null;

  const items: RecruitmentTimeSlot[] = slotsQuery.data?.items ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg rounded-xl border border-[var(--assessment-outline-variant)] bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--assessment-on-surface)]">{title}</h2>
            <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
              Pick a date on the calendar, then choose a configured time slot.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-low)]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <label className="mb-4 flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
          Interview date
          <input
            type="date"
            min={minDate}
            className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)] outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
            value={selectedDate}
            onChange={(e) => {
              setSelectedDate(e.target.value);
              setSelectedId('');
            }}
          />
        </label>

        {!selectedDate ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Select a date to see available slots.
          </div>
        ) : slotsQuery.isLoading ? (
          <p className="text-sm">Loading available slots...</p>
        ) : items.length === 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            No open time slots available for this date. Add slots under{' '}
            <strong>Hiring → Time Slots</strong>, or pick another day.
          </div>
        ) : (
          <ul className="max-h-72 space-y-2 overflow-y-auto">
            {items.map((slot) => {
              const checked = selectedId === slot.id;
              return (
                <li key={slot.id}>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2 ${
                      checked
                        ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5'
                        : 'border-[var(--assessment-outline-variant)] hover:bg-[var(--assessment-surface-container-low)]'
                    }`}
                  >
                    <input
                      type="radio"
                      name="invite-slot"
                      className="mt-1"
                      checked={checked}
                      onChange={() => setSelectedId(slot.id)}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-[var(--assessment-on-surface)]">
                        {slot.display_label}
                      </span>
                      <span className="block text-xs text-[var(--assessment-on-surface-variant)]">
                        {slot.remaining} of {slot.capacity} seats left on {selectedDate}
                      </span>
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedDate || !selectedId || submitting || items.length === 0}
            onClick={() => onConfirm({ slotId: selectedId, slotDate: selectedDate })}
            className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {submitting ? 'Sending...' : 'Send Magic Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
