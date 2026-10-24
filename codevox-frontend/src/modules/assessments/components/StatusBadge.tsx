'use client';

function statusClass(status: string) {
  return `assessment-badge assessment-badge-${status.toLowerCase()}`;
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={statusClass(status)}>{status.replace('_', ' ')}</span>;
}
