-- Lock defense questions once READY_FOR_INTERVIEW so background code re-score cannot mutate them.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE project_interview_submissions ADD COLUMN interview_questions_locked TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER project_profile',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'project_interview_submissions'
    AND column_name = 'interview_questions_locked'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE project_interview_submissions ADD COLUMN locked_defense_questions JSON NULL AFTER interview_questions_locked',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'project_interview_submissions'
    AND column_name = 'locked_defense_questions'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE project_interview_submissions ADD COLUMN evaluation_fallback_level VARCHAR(32) NOT NULL DEFAULT ''NONE'' AFTER locked_defense_questions',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db
    AND table_name = 'project_interview_submissions'
    AND column_name = 'evaluation_fallback_level'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
