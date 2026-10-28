import type { ReactNode } from 'react';
import { CodeVoxRecruiterRoot } from '@/modules/job-profiles/components/CodeVoxRecruiterRoot';

export default function JobProfilesLayout({ children }: { children: ReactNode }) {
  return <CodeVoxRecruiterRoot>{children}</CodeVoxRecruiterRoot>;
}
