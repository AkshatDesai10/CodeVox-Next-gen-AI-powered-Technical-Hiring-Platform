import { AssessmentStartPage } from '@/modules/assessments/pages/AssessmentStartPage';

export default function AssessmentStartRoute({
  params,
}: {
  params: Promise<{ candidateId: string; assessmentId: string }>;
}) {
  return <AssessmentStartPage params={params} />;
}
