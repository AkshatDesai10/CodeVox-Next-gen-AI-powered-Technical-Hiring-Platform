import { AssessmentResultPage } from '@/modules/assessments/pages/AssessmentResultPage';

export default function AssessmentResultRoute({
  params,
}: {
  params: Promise<{ candidateId: string; candidateAssessmentId: string }>;
}) {
  return <AssessmentResultPage params={params} />;
}
