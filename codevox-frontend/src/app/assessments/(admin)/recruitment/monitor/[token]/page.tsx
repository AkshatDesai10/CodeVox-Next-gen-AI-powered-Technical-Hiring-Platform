import { Suspense } from 'react';
import { AdminInterviewMonitorPage } from '@/modules/recruitment/pages/AdminInterviewMonitorPage';

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading monitor...</p>}>
      <AdminInterviewMonitorPage />
    </Suspense>
  );
}
