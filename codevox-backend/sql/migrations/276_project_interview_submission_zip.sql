-- Document-pack Build & Defend submissions store the uploaded zip beside the GitHub URL.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE project_interview_submissions ADD COLUMN submission_zip_url VARCHAR(1024) NULL AFTER github_branch',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'project_interview_submissions'
    AND column_name = 'submission_zip_url'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
