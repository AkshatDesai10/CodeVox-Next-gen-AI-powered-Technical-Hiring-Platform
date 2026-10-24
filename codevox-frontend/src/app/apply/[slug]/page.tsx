import '@/modules/assessments/styles/assessment-theme.css';
import '@/modules/job-profiles/styles/codevox-recruiter.css';
import { PublicApplyPage } from '@/modules/job-profiles/pages/PublicApplyPage';
import { AssessmentHeadAssets } from '@/modules/assessments/layout/AssessmentHeadAssets';

export default function PublicApplyRoute() {
  return (
    <>
      <AssessmentHeadAssets />
      <PublicApplyPage />
    </>
  );
}

