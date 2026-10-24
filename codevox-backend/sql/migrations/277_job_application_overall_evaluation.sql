-- Overall hire evaluation across all rounds (JSON). Null until generated after completion.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE job_applications ADD COLUMN overall_evaluation JSON NULL AFTER interview_language',
    'SELECT 1')
    FROM information_schema.columns
    WHERE table_schema = @db AND table_name = 'job_applications' AND column_name = 'overall_evaluation'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
