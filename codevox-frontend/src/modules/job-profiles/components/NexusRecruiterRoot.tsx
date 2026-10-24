'use client';

import type { ReactNode } from 'react';
import '@/modules/job-profiles/styles/codevox-recruiter.css';

/** Nexus recruiter page chrome (tokens + full-width content). Uses the standard assessment left sidebar. */
export function NexusRecruiterRoot(props: { children: ReactNode }) {
  return (
    <div className="nexus-recruiter-root -m-6 min-h-[calc(100vh-4rem)] w-[calc(100%+3rem)] p-6">
      {props.children}
    </div>
  );
}
