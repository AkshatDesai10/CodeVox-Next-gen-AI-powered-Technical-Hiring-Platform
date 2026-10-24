'use client';

import type { ReactNode } from 'react';
import '@/modules/job-profiles/styles/codevox-recruiter.css';

/** Full-width Nexus recruiter content - uses the standard assessment sidebar only. */
export function RecruitmentOpsShell(props: { children: ReactNode; title?: string }) {
  return (
    <div className="nexus-recruiter-root -m-6 min-h-[calc(100vh-4rem)] w-[calc(100%+3rem)] p-6">
      {props.children}
    </div>
  );
}
