import type { Recommendation, ReportStatus, StageEvalStatus } from '../types/assessment-report';

export function scoreBarColor(score: number | null | undefined): string {
  if (score == null) return 'bg-[var(--assessment-outline-variant)]';
  if (score >= 80) return 'bg-emerald-500';
  if (score >= 60) return 'bg-amber-500';
  return 'bg-rose-500';
}

export function formatPct(score: number | null | undefined): string {
  if (score == null) return '—';
  return `${Math.round(score * 10) / 10}%`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    let dateStr = iso;
    if (!dateStr.includes('Z') && !/\+\d{2}(:\d{2})?/.test(dateStr) && !/-\d{2}(:\d{2})?/.test(dateStr)) {
      dateStr = dateStr.replace(' ', 'T');
      if (!dateStr.endsWith('Z')) {
        dateStr += 'Z';
      }
    }
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—';
  
  let dateStr = iso;
  if (!dateStr.includes('Z') && !/\+\d{2}(:\d{2})?/.test(dateStr) && !/-\d{2}(:\d{2})?/.test(dateStr)) {
    dateStr = dateStr.replace(' ', 'T');
    if (!dateStr.endsWith('Z')) {
      dateStr += 'Z';
    }
  }

  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${Math.max(1, mins)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function reportStatusLabel(status: ReportStatus): string {
  switch (status) {
    case 'passed':
      return 'Passed';
    case 'completed':
    case 'under_review':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'in_progress':
      return 'In Progress';
    default:
      return status;
  }
}

export function recommendationLabel(rec: Recommendation): string {
  switch (rec) {
    case 'strong_hire':
      return 'Strong Hire';
    case 'hire':
      return 'Hire';
    case 'under_review':
      return 'Under Review';
    case 'evaluating':
      return 'Evaluating';
    case 'reject':
      return 'Reject';
    case 'flagged':
      return 'Flagged';
    case 'disqualified':
      return 'Disqualified';
    case 'retake':
      return 'Retake';
    default:
      return '—';
  }
}

export function roundPillText(item: {
  label: string;
  scorePct: number | null;
  status: StageEvalStatus;
  endedByCandidate?: boolean;
}): string {
  if (item.endedByCandidate) return `${item.label}: Self-terminated`;
  if (item.status === 'skipped') return `${item.label}: Skipped`;
  if (item.status === 'pending') return `${item.label}: Pending`;
  if (item.status === 'in_progress') return `${item.label}: In Progress`;
  if (item.status === 'evaluating') return `${item.label}: Evaluating`;
  if (item.status === 'in_review') return `${item.label}: In Review`;
  if (item.status === 'failed') return `${item.label}: Failed`;
  return `${item.label}: Completed`;
}

export function stageStatusLabel(status: StageEvalStatus): string {
  switch (status) {
    case 'completed':
      return 'Completed';
    case 'in_review':
      return 'In Review';
    case 'in_progress':
      return 'In Progress';
    case 'evaluating':
      return 'Evaluating';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'pending':
    default:
      return 'Pending';
  }
}

export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null) return '—';
  const m = Math.round(minutes);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function roundPillClass(status: StageEvalStatus): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'in_review':
      return 'bg-amber-50 text-amber-800 border-amber-200';
    case 'in_progress':
    case 'evaluating':
      return 'bg-sky-50 text-sky-700 border-sky-200';
    case 'failed':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    case 'skipped':
    case 'pending':
    default:
      return 'bg-slate-50 text-slate-600 border-slate-200';
  }
}

export function downloadCsv(
  filename: string,
  rows: Array<Record<string, string | number | null | undefined>>,
) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const csv = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escape(r[h])).join(',')),
  ].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
