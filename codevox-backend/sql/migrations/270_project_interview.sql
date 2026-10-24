-- "Build & Defend" round: candidate picks a project, submits a GitHub repo, then defends it
-- in an AI voice interview grounded on an LLM-generated project_profile.

ALTER TABLE job_profile_stages
  MODIFY COLUMN stage_type ENUM(
    'screening',
    'coding',
    'ai_verbal',
    'hr_verbal',
    'panel',
    'custom',
    'take_home',
    'ai_screening',
    'project_interview'
  ) NOT NULL DEFAULT 'custom';

CREATE TABLE IF NOT EXISTS project_interview_submissions (
  id CHAR(36) NOT NULL,
  job_application_id BIGINT UNSIGNED NOT NULL,
  stage_id BIGINT UNSIGNED NOT NULL,
  candidate_id BIGINT UNSIGNED NOT NULL,
  portal_token VARCHAR(128) NOT NULL,
  submission_token VARCHAR(64) NOT NULL,
  status ENUM(
    'pending_submission',
    'evaluating_code',
    'ready_for_interview',
    'completed',
    'expired'
  ) NOT NULL DEFAULT 'pending_submission',
  selected_project_id VARCHAR(64) NULL,
  selected_at TIMESTAMP(6) NULL,
  due_at TIMESTAMP(6) NULL,
  github_url VARCHAR(512) NULL,
  github_branch VARCHAR(128) NULL,
  submitted_at TIMESTAMP(6) NULL,
  evaluated_at TIMESTAMP(6) NULL,
  config_snapshot JSON NULL,
  repo_snapshot JSON NULL,
  project_profile JSON NULL,
  last_error TEXT NULL,
  interview_token VARCHAR(128) NULL,
  inactive TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (id),
  UNIQUE KEY uq_project_interview_submission_token (submission_token),
  UNIQUE KEY uq_project_interview_app_stage (job_application_id, stage_id),
  KEY idx_project_interview_portal (portal_token),
  KEY idx_project_interview_interview_token (interview_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
