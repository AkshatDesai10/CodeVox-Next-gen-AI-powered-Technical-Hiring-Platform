'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { DynamicAssessmentWorkspacePage } from '@/modules/assessments/pages/DynamicAssessmentWorkspacePage';

export default function EngineSessionPage() {
  return (
    <Suspense fallback={<div className="p-6">Loading assessment...</div>}>
      <EngineSessionContent />
    </Suspense>
  );
}

function EngineSessionContent() {
  const params = useSearchParams();
  const templateId = params?.get('templateId') ?? undefined;
  const assessmentId = params?.get('assessmentId') ?? undefined;
  const candidateId = params?.get('candidateId') ?? '1';

  if (!templateId && !assessmentId) {
    return <div className="p-6">Missing templateId or assessmentId query parameter.</div>;
  }

  return (
    <DynamicAssessmentWorkspacePage
      candidateId={candidateId}
      templateId={templateId}
      assessmentId={assessmentId}
    />
  );
}
