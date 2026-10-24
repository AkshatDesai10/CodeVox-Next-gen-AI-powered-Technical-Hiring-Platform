import type { ReactNode } from 'react';
import { PermissionsProvider } from '@/contexts/permissions-context';
import { AssessmentSidebar } from './AssessmentSidebar';
import { AssessmentTopbar } from './AssessmentTopbar';

export function AssessmentShellClient(props: { children: ReactNode; userName?: string }) {
  return (
    <PermissionsProvider>
      <div className="assessments-root min-h-screen">
        <AssessmentTopbar userName={props.userName} />
        <div className="flex min-h-screen pt-16">
          <AssessmentSidebar />
          <main className="min-w-0 flex-1 p-6">{props.children}</main>
        </div>
      </div>
    </PermissionsProvider>
  );
}
