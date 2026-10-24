-- Per-rubric AI Verbal question plan. Null means "use seniority defaults at runtime"
-- and must not be backfilled, so a later default change does not rewrite saved rows.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE job_profile_competencies ADD COLUMN question_plan JSON NULL AFTER sort_order',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'job_profile_competencies' AND column_name = 'question_plan'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
