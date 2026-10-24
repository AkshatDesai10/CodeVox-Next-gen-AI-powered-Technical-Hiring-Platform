'use client';

import Link from 'next/link';

export function AssessmentTopbar(props: { userName?: string }) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-[var(--assessment-outline-variant)]/40 bg-[var(--assessment-surface-container)] px-6 shadow-sm">
      <Link href="/assessments" className="text-lg font-bold text-[var(--assessment-primary)]">
        CodeVox Assessment
      </Link>
      <div className="text-sm text-[var(--assessment-on-surface-variant)]">
        {props.userName ? `Signed in as ${props.userName}` : 'Assessment Console'}
      </div>
    </header>
  );
}
