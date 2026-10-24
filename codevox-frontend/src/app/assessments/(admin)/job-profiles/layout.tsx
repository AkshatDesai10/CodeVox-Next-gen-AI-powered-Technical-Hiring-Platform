import type { ReactNode } from 'react';
import { NexusRecruiterRoot } from '@/modules/job-profiles/components/NexusRecruiterRoot';

export default function JobProfilesLayout({ children }: { children: ReactNode }) {
  return <NexusRecruiterRoot>{children}</NexusRecruiterRoot>;
}
