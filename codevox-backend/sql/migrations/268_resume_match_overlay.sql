-- Resume Screening result columns on recruitment_lead_overlay (Lead Inbox CV-vs-JD).
-- Idempotent: safe to re-run after partial failure.
-- Note: DB user may lack DELETE — duplicates are retired via UPDATE, not DELETE.

SET @db := DATABASE();

-- 1) Add columns only if missing
SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_match_status VARCHAR(32) NULL AFTER invite_token',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_match_status'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_match_score DECIMAL(5, 2) NULL AFTER resume_match_status',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_match_score'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_match_confidence DECIMAL(4, 3) NULL AFTER resume_match_score',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_match_confidence'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_match_json JSON NULL AFTER resume_match_confidence',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_match_json'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_match_job_profile_id BIGINT UNSIGNED NULL AFTER resume_match_json',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_match_job_profile_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_match_job_fingerprint VARCHAR(64) NULL AFTER resume_match_job_profile_id',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_match_job_fingerprint'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_match_cv_hash VARCHAR(64) NULL AFTER resume_match_job_fingerprint',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_match_cv_hash'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_match_analyzer_version VARCHAR(32) NULL AFTER resume_match_cv_hash',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_match_analyzer_version'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_match_analyzed_at TIMESTAMP NULL AFTER resume_match_analyzer_version',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_match_analyzed_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_match_error VARCHAR(500) NULL AFTER resume_match_analyzed_at',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_match_error'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN resume_extracted_text MEDIUMTEXT NULL AFTER resume_match_error',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'resume_extracted_text'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Retire duplicate lmsuite_lead_id rows (keep max id). Uses UPDATE (no DELETE privilege required).
UPDATE recruitment_lead_overlay t1
INNER JOIN (
  SELECT lmsuite_lead_id, MAX(id) AS keep_id
  FROM recruitment_lead_overlay
  WHERE lmsuite_lead_id NOT LIKE '%\_\_dup\_%' ESCAPE '\\'
  GROUP BY lmsuite_lead_id
  HAVING COUNT(*) > 1
) d ON t1.lmsuite_lead_id = d.lmsuite_lead_id AND t1.id <> d.keep_id
SET
  t1.inactive = 1,
  t1.lmsuite_lead_id = CONCAT(t1.lmsuite_lead_id, '__dup_', t1.id);

-- 3) Unique index for concurrent first-sight claim
SET @idx_exists := (
  SELECT COUNT(1) FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'recruitment_lead_overlay'
    AND index_name = 'uq_recruitment_lead_overlay_lmsuite_lead_id'
);
SET @sql := IF(
  @idx_exists = 0,
  'ALTER TABLE recruitment_lead_overlay ADD UNIQUE INDEX uq_recruitment_lead_overlay_lmsuite_lead_id (lmsuite_lead_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
