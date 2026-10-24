import type { ReactNode } from 'react';

export default function CandidateAssessmentsLayout({ children }: { children: ReactNode }) {
  return <div className="assessments-root min-h-screen">{children}</div>;
}
