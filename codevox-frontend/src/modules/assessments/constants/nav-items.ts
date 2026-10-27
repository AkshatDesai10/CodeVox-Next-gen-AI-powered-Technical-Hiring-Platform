export type AssessmentPermission =
  | 'assessments:read'
  | 'assessments:write'
  | 'assessments:moderate'
  | 'job_profiles:read'
  | 'job_profiles:write';

export type AssessmentNavItem = {
  href: string;
  label: string;
  icon: string;
  permission?: AssessmentPermission | AssessmentPermission[];
};

export type AssessmentNavSection = {
  label: string;
  items: AssessmentNavItem[];
};

export const RECRUITMENT_NAV_SECTIONS: AssessmentNavSection[] = [
  {
    label: 'Recruitment',
    items: [
      { href: '/assessments/job-profiles', label: 'Job Profiles', icon: 'work', permission: ['job_profiles:read', 'assessments:read'] },
      { href: '/assessments/recruitment/leads', label: 'Lead Inbox', icon: 'inbox', permission: ['job_profiles:read', 'assessments:read'] },
      { href: '/assessments/recruitment/interviews', label: 'Interviews', icon: 'groups', permission: ['job_profiles:read', 'assessments:read'] },
      { href: '/assessments/recruitment/time-slots', label: 'Time Slots', icon: 'schedule', permission: ['job_profiles:read', 'assessments:read'] },
      {
        href: '/assessments/recruitment/configurations',
        label: 'Configurations',
        icon: 'tune',
        permission: ['job_profiles:write', 'assessments:write'],
      },
    ],
  },
  {
    label: 'Assessments',
    items: [
      { href: '/assessments', label: 'Dashboard', icon: 'dashboard' },
      { href: '/assessments/candidates', label: 'Candidates', icon: 'groups', permission: 'assessments:read' },
      { href: '/assessments/job-profiles/question-bank', label: 'Question Bank', icon: 'quiz', permission: ['job_profiles:read', 'assessments:read'] },
      { href: '/assessments/job-profiles/problem-bank', label: 'Problem Bank (JP)', icon: 'code', permission: ['job_profiles:read', 'assessments:read'] },
      { href: '/assessments/interview-reports', label: 'Interview Reports', icon: 'monitoring', permission: 'assessments:read' },
      { href: '/assessments/assessment-reports', label: 'Assessment Reports', icon: 'bar_chart', permission: 'job_profiles:read' },
    ],
  },
];

/** @deprecated Use RECRUITMENT_NAV_SECTIONS in the standalone recruitment app. */
export const ASSESSMENT_NAV_SECTIONS = RECRUITMENT_NAV_SECTIONS;
