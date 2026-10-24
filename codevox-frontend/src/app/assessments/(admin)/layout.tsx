import type { ReactNode } from 'react';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { RecruitmentAssessmentShell } from '@/components/RecruitmentAssessmentShell';
import { authOptions } from '@/libs/auth';

export default async function AssessmentsAdminLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.access_token) redirect('/signin');

  return <RecruitmentAssessmentShell>{children}</RecruitmentAssessmentShell>;
}
