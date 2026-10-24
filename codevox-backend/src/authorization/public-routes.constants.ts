export const PUBLIC_ROUTES: Array<{ method: string; path: string }> = [
  { method: 'POST', path: '/api/auth/login' },
  { method: 'POST', path: '/api/auth/register' },
  { method: 'POST', path: '/api/auth/refresh' },
  { method: 'POST', path: '/api/auth/reset-password-request' },
  { method: 'POST', path: '/api/auth/reset-password' },
  { method: 'GET', path: '/api/auth/verify-email' },
  { method: 'POST', path: '/api/auth/resend-verification' },

  /** Candidate portal — token scoped, no auth */
  { method: 'GET', path: '/api/candidate-portal/:token' },
  { method: 'POST', path: '/api/candidate-portal/:token/start' },
  { method: 'POST', path: '/api/candidate-portal/:token/complete-coding-challenge' },
  { method: 'POST', path: '/api/candidate-portal/:token/reset' },
  { method: 'POST', path: '/api/candidate-portal/apply/:slug' },
  { method: 'POST', path: '/api/candidate-portal/apply-json/:slug' },
  { method: 'POST', path: '/api/candidate-portal/parse-resume' },
  { method: 'POST', path: '/api/candidate-portal/demo-session' },

  /** Job profile public endpoints (previews, specs) */
  { method: 'GET', path: '/api/job-profiles/public/:slug' },
  { method: 'GET', path: '/api/job-profiles/public/:slug/round-spec' },
  { method: 'GET', path: '/api/job-profiles/public/:slug/preview-rounds' },
  { method: 'POST', path: '/api/job-profiles/public/:slug/preview-rounds' },

  /** Autonomous interview — token scoped, no JWT */
  { method: 'GET', path: '/api/autonomous-interview/session/:token' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/request-code-editor' },
  { method: 'POST', path: '/api/autonomous-interview/consent' },
  { method: 'POST', path: '/api/autonomous-interview/verify-identity' },
  { method: 'POST', path: '/api/autonomous-interview/start' },
  { method: 'POST', path: '/api/autonomous-interview/start-pipeline' },
  { method: 'POST', path: '/api/autonomous-interview/livekit-token' },
  { method: 'POST', path: '/api/autonomous-interview/proctor-event' },
  { method: 'POST', path: '/api/autonomous-interview/sync-chat' },
  { method: 'POST', path: '/api/autonomous-interview/sync-chat-turn' },
  { method: 'POST', path: '/api/autonomous-interview/agent-response' },
  { method: 'POST', path: '/api/autonomous-interview/complete' },
  { method: 'POST', path: '/api/autonomous-interview/complete-screening' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/force-complete' },
  { method: 'POST', path: '/api/autonomous-interview/session/:token/merged-recording' },
  { method: 'POST', path: '/api/autonomous-interview/retry-screening-analyzer' },
  { method: 'GET', path: '/api/autonomous-interview/proctor-events/:token' },

  /** Build & Defend (project interview) — token-scoped candidate project selection + submission */
  { method: 'GET', path: '/api/project-interview/submissions/:token' },
  { method: 'GET', path: '/api/project-interview/submissions/:token/projects/:projectId/files' },
  { method: 'POST', path: '/api/project-interview/submissions/:token/select' },
  { method: 'POST', path: '/api/project-interview/submissions/:token/submit' },
  { method: 'POST', path: '/api/project-interview/submissions/:token/submit-zip' },
  { method: 'POST', path: '/api/project-interview/sessions/:token/leave-build' },

  /** Coding round — token-scoped candidate session (no JWT) */
  { method: 'GET', path: '/api/coding-round/session/:token' },
  { method: 'POST', path: '/api/coding-round/start' },
  { method: 'POST', path: '/api/coding-round/run' },
  { method: 'POST', path: '/api/coding-round/submit' },
  { method: 'POST', path: '/api/coding-round/heartbeat' },
  { method: 'POST', path: '/api/coding-round/proctor-event' },

  /** Public assessment report (read-only for candidates or recruiters via token) */
  { method: 'GET', path: '/api/assessment-reports/candidate/:token' },

  /** LiveKit webhook (signature verified via webhook receiver) */
  { method: 'POST', path: '/api/autonomous-interview/livekit-webhook' },

  /** Candidate Portal Files (static asset downloads / resumes / face photos) */
  { method: 'GET', path: '/api/candidate-portal/files/:filename' },
  { method: 'GET', path: '/api/candidate-portal/files/resumes/:filename' },
  { method: 'GET', path: '/api/candidate-portal/files/reference-faces/:filename' },
  { method: 'GET', path: '/api/candidate-portal/files/project-zips/:filename' },
];
