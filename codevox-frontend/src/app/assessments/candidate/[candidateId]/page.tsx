import { CandidateAssignmentsPage } from '@/modules/assessments/pages/CandidateAssignmentsPage';

export default function CandidateAssignmentsRoute({
  params,
}: {
  params: Promise<{ candidateId: string }>;
}) {
  return <CandidateAssignmentsPage params={params} />;
}
