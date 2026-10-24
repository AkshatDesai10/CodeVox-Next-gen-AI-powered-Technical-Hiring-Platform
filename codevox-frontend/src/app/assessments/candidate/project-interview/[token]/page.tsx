import { ProjectInterviewCandidatePage } from '@/modules/assessments/pages/ProjectInterviewCandidatePage';

export default async function ProjectInterviewCandidateRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ProjectInterviewCandidatePage token={token} />;
}
