import { CodingWorkspacePage } from '@/modules/assessments/pages/CodingWorkspacePage';

export default function CodingWorkspaceRoute({
  params,
}: {
  params: Promise<{ candidateId: string; candidateAssessmentId: string }>;
}) {
  return <CodingWorkspacePage params={params} />;
}
