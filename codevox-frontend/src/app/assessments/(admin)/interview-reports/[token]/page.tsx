import { InterviewReportDetailPage } from '@/modules/autonomous-interview/pages/InterviewReportDetailPage';

export default async function InterviewReportDetailRoute({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <InterviewReportDetailPage token={decodeURIComponent(token)} />;
}
