-- Consolidate ai_generation_logs into job_profile_ai_logs (single AI log table).

SET @db := DATABASE();

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE job_profile_ai_logs ADD COLUMN candidate_assessment_id BIGINT UNSIGNED NULL AFTER job_profile_id',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'job_profile_ai_logs' AND column_name = 'candidate_assessment_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE job_profile_ai_logs ADD COLUMN assessment_id BIGINT UNSIGNED NULL AFTER candidate_assessment_id',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'job_profile_ai_logs' AND column_name = 'assessment_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE job_profile_ai_logs ADD COLUMN prompt_hash VARCHAR(64) NULL AFTER model',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'job_profile_ai_logs' AND column_name = 'prompt_hash'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Copy historical rows when the old table still exists.
SET @has_old := (
  SELECT COUNT(*) FROM information_schema.tables
  WHERE table_schema = @db AND table_name = 'ai_generation_logs'
);

SET @sql := IF(@has_old > 0,
  'INSERT INTO job_profile_ai_logs (
     job_profile_id, candidate_assessment_id, assessment_id, operation, model, prompt_hash,
     request_json, response_json, prompt_tokens, completion_tokens, created_at, inactive
   )
   SELECT
     NULL, candidate_assessment_id, assessment_id, operation, model, prompt_hash,
     request_json, response_json, prompt_tokens, completion_tokens, created_at, inactive
   FROM ai_generation_logs',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(@has_old > 0, 'DROP TABLE ai_generation_logs', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
