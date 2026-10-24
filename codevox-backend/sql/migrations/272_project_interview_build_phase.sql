-- Build & Defend: Build LiveKit phase columns + in_build status.

ALTER TABLE project_interview_submissions
  MODIFY COLUMN status ENUM(
    'pending_submission',
    'in_build',
    'evaluating_code',
    'ready_for_interview',
    'completed',
    'expired'
  ) NOT NULL DEFAULT 'pending_submission';

SET @db := DATABASE();

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE project_interview_submissions ADD COLUMN selection_started_at TIMESTAMP(6) NULL AFTER selected_at',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'project_interview_submissions' AND column_name = 'selection_started_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE project_interview_submissions ADD COLUMN build_session_token VARCHAR(128) NULL AFTER interview_token',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'project_interview_submissions' AND column_name = 'build_session_token'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Rows that already selected a project but have not submitted yet behave as in_build.
UPDATE project_interview_submissions
SET status = 'in_build'
WHERE status = 'pending_submission'
  AND selected_project_id IS NOT NULL
  AND github_url IS NULL
  AND inactive = 0;
