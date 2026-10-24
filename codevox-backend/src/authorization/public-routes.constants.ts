/** Routes that skip JWT and route-permission guards (no bearer token). */

export type PublicRouteDef = {
  method: string;
  path: string;
};

export const PUBLIC_ROUTES: readonly PublicRouteDef[] = [
  { method: 'GET', path: '/health' },

  /** Candidate assessment execution — no JWT (candidate_id in request) */
  { method: 'POST', path: '/api/assessment/start' },
  { method: 'GET', path: '/api/assessment/assessments/:assessmentId/questions' },
  { method: 'GET', path: '/api/assessment/candidate/:candidateId/assignments' },
  { method: 'GET', path: '/api/assessment/result/:candidateAssessmentId' },
  { method: 'POST', path: '/api/assessment/run-code' },
  { method: 'POST', path: '/api/assessment/save-draft' },
  { method: 'POST', path: '/api/assessment/submit-answer' },
  { method: 'POST', path: '/api/assessment/submit' },
  { method: 'POST', path: '/api/assessment/interview/respond' },
  { method: 'GET', path: '/api/assessment/:candidateAssessmentId' },
  { method: 'POST', path: '/api/assessment/workspace/:candidateAssessmentId/provision' },
  { method: 'GET', path: '/api/assessment/workspace/:candidateAssessmentId' },
  { method: 'GET', path: '/api/assessment/workspace/:candidateAssessmentId/files' },
  { method: 'GET', path: '/api/assessment/workspace/:candidateAssessmentId/files/content' },
  { method: 'PUT', path: '/api/assessment/workspace/:candidateAssessmentId/files' },
  { method: 'POST', path: '/api/assessment/workspace/:candidateAssessmentId/files/sync' },
  { method: 'DELETE', path: '/api/assessment/workspace/:candidateAssessmentId/files' },
  { method: 'POST', path: '/api/assessment/workspace/:candidateAssessmentId/exec' },
  { method: 'POST', path: '/api/assessment/workspace/:candidateAssessmentId/teardown' },

  /** Autonomous multi-stage interview — token-scoped candidate session (no JWT) */
  { method: 'GET', path: '/api/autonomous-interview/session/:token' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/init' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/candidate-ready' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/voice-message' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/consent' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/identity-verify' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/liveness-verify' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/voice-enroll' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/voice-check' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/proctor-events' },
  { method: 'POST', path: '/api/autonomous-interview/final-submit' },
  { method: 'POST', path: '/api/autonomous-interview/voice-chat-sync' },
  { method: 'POST', path: '/api/autonomous-interview/save-intro-results' },
  { method: 'POST', path: '/api/autonomous-interview/assessment-active' },
  { method: 'POST', path: '/api/autonomous-interview/screen-share-ready' },
  { method: 'POST', path: '/api/autonomous-interview/shift-to-sandbox' },
  { method: 'POST', path: '/api/autonomous-interview/defend-assessment-started' },
  { method: 'POST', path: '/api/autonomous-interview/complete' },
  { method: 'POST', path: '/api/autonomous-interview/complete-screening' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/force-complete' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/merged-recording' },
  { method: 'POST', path: '/api/autonomous-interview/retry-screening-analyzer' },
  { method: 'GET', path: '/api/autonomous-interview/proctor-events/:token' },

  /** Take-home assessment — token-scoped candidate submission */
  { method: 'GET', path: '/api/take-home/submissions/:token' },
  { method: 'POST', path: '/api/take-home/submissions/:token/start' },
  { method: 'POST', path: '/api/take-home/submissions/:token/submit' },

  /** Build & Defend (project interview) — token-scoped candidate project selection + submission */
  { method: 'GET', path: '/api/project-interview/submissions/:token' },
  { method: 'GET', path: '/api/project-interview/submissions/:token/projects/:projectId/files' },
  { method: 'POST', path: '/api/project-interview/submissions/:token/select' },
  { method: 'POST', path: '/api/project-interview/submissions/:token/submit' },
  { method: 'POST', path: '/api/project-interview/submissions/:token/submit-zip' },
  { method: 'POST', path: '/api/project-interview/sessions/:token/leave-build' },

  /** Coding round — token-scoped candidate session (no JWT) */
  { method: 'GET', path: '/api/coding-round/:token' },
  { method: 'POST', path: '/api/coding-round/:token/run' },
  { method: 'POST', path: '/api/coding-round/:token/submit' },

  /** Candidate Portal — demo/invite token-scoped dashboard (no JWT) */
  { method: 'GET', path: '/api/candidate/portal/:token/dashboard' },
  { method: 'POST', path: '/api/candidate/portal/:token/consent' },
  { method: 'POST', path: '/api/candidate/portal/:token/preferences' },
  { method: 'POST', path: '/api/candidate/portal/:token/face-capture' },
  { method: 'POST', path: '/api/candidate/portal/:token/start' },
  { method: 'POST', path: '/api/candidate/portal/demo-link' },

  /** Job profiles — public list for candidate demo dropdown (no JWT) */
  { method: 'GET', path: '/api/job-profiles/public/list' },
];
