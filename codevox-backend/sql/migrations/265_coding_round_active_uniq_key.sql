-- Soft-delete + active-only unique for coding_round_submissions.
-- Active rows: inactive=0 → active_uniq_key = "application_id:stage_key"
-- Inactive rows: inactive=1 → active_uniq_key = NULL (MySQL allows many NULLs)

-- Drop hard unique if present (blocks soft-delete history)
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'coding_round_submissions'
    AND INDEX_NAME = 'uq_coding_round_app_stage'
);
SET @sql := IF(
  @idx > 0,
  'ALTER TABLE coding_round_submissions DROP INDEX uq_coding_round_app_stage',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'coding_round_submissions'
    AND COLUMN_NAME = 'inactive'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE coding_round_submissions ADD COLUMN inactive TINYINT(1) NOT NULL DEFAULT 0 AFTER updated_at',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Prefer terminal rows as the active attempt; soft-delete orphan in_progress twins
UPDATE coding_round_submissions orphan
INNER JOIN coding_round_submissions keeper
  ON keeper.application_id = orphan.application_id
 AND keeper.stage_key = orphan.stage_key
 AND keeper.id <> orphan.id
 AND keeper.inactive = 0
 AND keeper.status IN ('submitted', 'grading', 'error')
SET orphan.inactive = 1
WHERE orphan.inactive = 0
  AND orphan.status = 'in_progress';

-- If submitted was wrongly soft-deleted but an in_progress twin is active, flip them
UPDATE coding_round_submissions submitted
INNER JOIN coding_round_submissions active_prog
  ON active_prog.application_id = submitted.application_id
 AND active_prog.stage_key = submitted.stage_key
 AND active_prog.id <> submitted.id
 AND active_prog.inactive = 0
 AND active_prog.status = 'in_progress'
SET submitted.inactive = 0,
    active_prog.inactive = 1
WHERE submitted.inactive = 1
  AND submitted.status = 'submitted';

-- Remaining duplicate actives: keep highest id
UPDATE coding_round_submissions c
INNER JOIN (
  SELECT application_id, stage_key, MAX(id) AS keep_id
  FROM coding_round_submissions
  WHERE inactive = 0
  GROUP BY application_id, stage_key
  HAVING COUNT(*) > 1
) d
  ON c.application_id = d.application_id
 AND c.stage_key = d.stage_key
 AND c.inactive = 0
 AND c.id <> d.keep_id
SET c.inactive = 1;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'coding_round_submissions'
    AND COLUMN_NAME = 'active_uniq_key'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE coding_round_submissions
     ADD COLUMN active_uniq_key VARCHAR(191)
       GENERATED ALWAYS AS (
         IF(
           inactive = 0,
           CONCAT(application_id, '':'', stage_key),
           NULL
         )
       ) STORED,
     ADD UNIQUE KEY uq_coding_round_active (active_uniq_key)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'coding_round_submissions'
    AND INDEX_NAME = 'uq_coding_round_active'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE coding_round_submissions ADD UNIQUE KEY uq_coding_round_active (active_uniq_key)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
