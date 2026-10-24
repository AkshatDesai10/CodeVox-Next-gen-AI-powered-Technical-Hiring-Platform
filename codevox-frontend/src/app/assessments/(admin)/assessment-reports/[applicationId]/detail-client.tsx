'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { AssessmentReportDetailPage } from '@/modules/assessment-reports/pages/AssessmentReportDetailPage';

export default function AssessmentReportDetailClient() {
  const params = useParams();
  const search = useSearchParams();
  const applicationId = String(params?.applicationId ?? '');
  const stageType = search?.get('stageType');

  if (!applicationId) {
    return <div className="p-6 text-sm">Missing application id.</div>;
  }

  return (
    <AssessmentReportDetailPage
      applicationId={applicationId}
      initialStageType={stageType}
    />
  );
}
