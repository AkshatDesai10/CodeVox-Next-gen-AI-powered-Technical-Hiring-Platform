import { Suspense } from 'react';
import { LeadInboxPage } from '@/modules/recruitment/pages/LeadInboxPage';

export default function Page() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading leads...</p>}>
      <LeadInboxPage />
    </Suspense>
  );
}
