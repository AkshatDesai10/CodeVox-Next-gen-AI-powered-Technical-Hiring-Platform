import { AutonomousInterviewPage } from '@/modules/autonomous-interview/pages/AutonomousInterviewPage';
import { AssessmentHeadAssets } from '@/modules/assessments/layout/AssessmentHeadAssets';
import '@/modules/assessments/styles/assessment-theme.css';
import '@/modules/autonomous-interview/styles/conversation-session.css';

export default async function AutonomousInterviewRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <>
      <AssessmentHeadAssets />
      <AutonomousInterviewPage candidateToken={token} />
    </>
  );
}
