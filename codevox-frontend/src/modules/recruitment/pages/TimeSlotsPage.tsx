'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';
import { RecruitmentOpsShell } from '@/modules/recruitment/components/RecruitmentOpsShell';
import {
  createRecruitmentTimeSlot,
  deleteRecruitmentTimeSlot,
  listRecruitmentTimeSlots,
  updateRecruitmentTimeSlot,
  type RecruitmentTimeSlot,
} from '@/modules/recruitment/lib/recruitment-api';

type SlotForm = {
  label: string;
  start_time: string;
  end_time: string;
  timezone: string;
  capacity: string;
  notes: string;
  status: 'open' | 'closed';
};

const emptyForm = (): SlotForm => ({
  label: '',
  start_time: '10:00',
  end_time: '11:00',
  timezone: 'Asia/Kolkata',
  capacity: '5',
  notes: '',
  status: 'open',
});

function bumpHour(timeHhMm: string) {
  const match = timeHhMm.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '11:00';
  const next = (Number(match[1]) + 1) % 24;
  return `${String(next).padStart(2, '0')}:${match[2]}`;
}

export function TimeSlotsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<SlotForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['recruitment-time-slots'],
    queryFn: () => listRecruitmentTimeSlots(),
  });

  const items = listQuery.data?.items ?? [];

  const saveMutation = useMutation({
    mutationFn: async () => {
      const start = form.start_time.slice(0, 5);
      const end = form.end_time.slice(0, 5);
      if (!start || !end) throw new Error('Start and end time are required');
      if (end <= start) throw new Error('End time must be after start time');
      const body = {
        label: form.label.trim() || undefined,
        start_time: start.length === 5 ? `${start}:00` : start,
        end_time: end.length === 5 ? `${end}:00` : end,
        timezone: form.timezone.trim() || 'Asia/Kolkata',
        capacity: Math.max(1, Number(form.capacity) || 1),
        notes: form.notes.trim() || undefined,
        status: form.status,
      };
      if (editingId) return updateRecruitmentTimeSlot(editingId, body);
      return createRecruitmentTimeSlot(body);
    },
    onSuccess: () => {
      setForm(emptyForm());
      setEditingId(null);
      void queryClient.invalidateQueries({ queryKey: ['recruitment-time-slots'] });
    },
    onError: (err: Error) => alert(err.message || 'Failed to save time slot'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRecruitmentTimeSlot(id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recruitment-time-slots'] }),
    onError: (err: Error) => alert(err.message || 'Failed to delete time slot'),
  });

  const sorted = useMemo(
    () => [...items].sort((a, b) => a.start_time.localeCompare(b.start_time)),
    [items],
  );

  const startEdit = (slot: RecruitmentTimeSlot) => {
    setEditingId(slot.id);
    setForm({
      label: slot.label ?? '',
      start_time: slot.start_time.slice(0, 5),
      end_time: slot.end_time.slice(0, 5),
      timezone: slot.timezone || 'Asia/Kolkata',
      capacity: String(slot.capacity ?? 1),
      notes: slot.notes ?? '',
      status: slot.status === 'closed' ? 'closed' : 'open',
    });
  };

  return (
    <RecruitmentOpsShell>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-headline-md text-[var(--assessment-on-surface)]">Time Slots</h1>
          <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
            Configure reusable daily time windows. When sending a magic link, pick a calendar date
            and one of these slots.
          </p>
        </div>

        <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-[var(--assessment-on-surface)]">
            {editingId ? 'Edit slot' : 'Add slot'}
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <Field label="Label (optional)">
              <input
                className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="Morning batch"
              />
            </Field>
            <Field label="Start">
              <input
                type="time"
                className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
                value={form.start_time}
                onChange={(e) => {
                  const start = e.target.value;
                  setForm((f) => {
                    const end = f.end_time && f.end_time > start ? f.end_time : bumpHour(start);
                    return { ...f, start_time: start, end_time: end };
                  });
                }}
                required
              />
            </Field>
            <Field label="End">
              <input
                type="time"
                className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
                value={form.end_time}
                onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                required
              />
            </Field>
            <Field label="Timezone">
              <input
                className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
                value={form.timezone}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              />
            </Field>
            <Field label="Capacity / day">
              <input
                type="number"
                min={1}
                className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
                value={form.capacity}
                onChange={(e) => setForm((f) => ({ ...f, capacity: e.target.value }))}
              />
            </Field>
            <Field label="Status">
              <select
                className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
                value={form.status}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    status: e.target.value === 'closed' ? 'closed' : 'open',
                  }))
                }
              >
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </Field>
            <Field label="Notes">
              <input
                className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </Field>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saveMutation.isPending || !form.start_time || !form.end_time}
              onClick={() => saveMutation.mutate()}
              className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving...' : editingId ? 'Update slot' : 'Create slot'}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyForm());
                }}
                className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
              >
                Cancel
              </button>
            ) : null}
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-white">
          {listQuery.isLoading ? (
            <p className="p-4 text-sm">Loading slots...</p>
          ) : sorted.length === 0 ? (
            <p className="p-4 text-sm text-[var(--assessment-on-surface-variant)]">
              No time slots configured yet.
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--assessment-surface-container-low)] text-xs uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                <tr>
                  <th className="px-4 py-3">Slot</th>
                  <th className="px-4 py-3">Capacity / day</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((slot) => (
                  <tr key={slot.id} className="border-t border-[var(--assessment-outline-variant)]">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[var(--assessment-on-surface)]">
                        {slot.display_label}
                      </div>
                      {slot.notes ? (
                        <div className="text-xs text-[var(--assessment-on-surface-variant)]">
                          {slot.notes}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{slot.capacity}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          slot.status === 'open'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {slot.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        className="mr-2 text-xs font-semibold text-[var(--assessment-primary)] hover:underline"
                        onClick={() => startEdit(slot)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="text-xs font-semibold text-red-600 hover:underline"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (confirm('Delete this time slot?')) deleteMutation.mutate(slot.id);
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </RecruitmentOpsShell>
  );
}

function Field(props: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
      {props.label}
      {props.children}
    </label>
  );
}
