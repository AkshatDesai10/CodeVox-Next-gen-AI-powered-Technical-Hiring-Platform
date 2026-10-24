-- Idempotent fixes for local DB after TypeORM sync + partial migrations.

SET @db := DATABASE();

-- Ensure hr_voice_audit exists before screening_voice_audit (267)
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE candidate_autonomous_interviews ADD COLUMN hr_voice_audit JSON NULL',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'hr_voice_audit'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE candidate_autonomous_interviews ADD COLUMN screening_voice_audit JSON NULL',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'screening_voice_audit'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
