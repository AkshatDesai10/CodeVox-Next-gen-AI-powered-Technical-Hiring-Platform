-- Track prompt/completion tokens on AI generation logs (and job-profile AI logs).

SET @db := DATABASE();

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE ai_generation_logs ADD COLUMN prompt_tokens INT NULL AFTER response_json',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'ai_generation_logs' AND column_name = 'prompt_tokens'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE ai_generation_logs ADD COLUMN completion_tokens INT NULL AFTER prompt_tokens',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'ai_generation_logs' AND column_name = 'completion_tokens'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE job_profile_ai_logs ADD COLUMN prompt_tokens INT NULL AFTER response_json',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'job_profile_ai_logs' AND column_name = 'prompt_tokens'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE job_profile_ai_logs ADD COLUMN completion_tokens INT NULL AFTER prompt_tokens',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'job_profile_ai_logs' AND column_name = 'completion_tokens'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
