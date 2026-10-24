-- Drop tables/columns for removed admin features:
-- time slots, cost analysis ledger.
-- Idempotent for local/dev re-runs.

SET @db := DATABASE();

-- ---- Time slots ----
DROP TABLE IF EXISTS recruitment_interview_time_slots;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE recruitment_lead_overlay DROP INDEX idx_recruitment_lead_invite_slot_date',
    'SELECT 1')
  FROM information_schema.statistics
  WHERE table_schema = @db
    AND table_name = 'recruitment_lead_overlay'
    AND index_name = 'idx_recruitment_lead_invite_slot_date'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE recruitment_lead_overlay DROP COLUMN invite_slot_date',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'invite_slot_date'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE recruitment_lead_overlay DROP COLUMN invite_slot_label',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'invite_slot_label'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE recruitment_lead_overlay DROP COLUMN invite_slot_id',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'invite_slot_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- Cost analysis ----
DROP TABLE IF EXISTS assessment_usage_ledger;
DROP TABLE IF EXISTS cost_rate_cards;
DROP TABLE IF EXISTS cost_fx_rates;
