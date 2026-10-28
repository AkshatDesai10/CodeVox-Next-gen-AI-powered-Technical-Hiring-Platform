'use client';

import type { ReactNode } from 'react';
import '@/modules/job-profiles/styles/codevox-recruiter.css';

/** CodeVox recruiter page chrome (tokens + full-width content). Uses the standard assessment left sidebar. */
export function CodeVoxRecruiterRoot(props: { children: ReactNode }) {
  return (
    <div className="codevox-recruiter-root -m-6 min-h-[calc(100vh-4rem)] w-[calc(100%+3rem)] p-6">
      {props.children}
    </div>
  );
}
