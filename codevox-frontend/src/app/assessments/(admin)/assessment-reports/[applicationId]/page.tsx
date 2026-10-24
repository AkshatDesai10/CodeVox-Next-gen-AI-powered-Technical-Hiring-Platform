import { Suspense } from 'react';
import AssessmentReportDetailClient from './detail-client';

export default function AssessmentReportDetailRoute() {
  return (
    <Suspense fallback={<div className="p-6 text-sm">Loading report...</div>}>
      <AssessmentReportDetailClient />
    </Suspense>
  );
}
