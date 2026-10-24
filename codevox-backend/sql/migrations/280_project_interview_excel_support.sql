-- Excel / PDF practical submissions for Build & Defend.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE project_interview_submissions ADD COLUMN submission_file_format VARCHAR(16) NULL DEFAULT NULL AFTER submission_zip_url',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'project_interview_submissions'
    AND column_name = 'submission_file_format'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE project_interview_submissions ADD COLUMN excel_evaluation_summary JSON NULL AFTER locked_defense_questions',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'project_interview_submissions'
    AND column_name = 'excel_evaluation_summary'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
