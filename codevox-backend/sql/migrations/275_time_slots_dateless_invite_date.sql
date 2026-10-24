-- Time slots become reusable time windows (no fixed date).
-- Invite stores the chosen calendar date on the lead overlay.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    (
      SELECT IS_NULLABLE
      FROM information_schema.columns
      WHERE table_schema = @db
        AND table_name = 'recruitment_interview_time_slots'
        AND column_name = 'slot_date'
    ) = 'YES',
    'SELECT 1',
    'ALTER TABLE recruitment_interview_time_slots MODIFY COLUMN slot_date DATE NULL'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE recruitment_interview_time_slots
SET slot_date = NULL
WHERE slot_date IS NOT NULL;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = @db
        AND table_name = 'recruitment_lead_overlay'
        AND column_name = 'invite_slot_date'
    ),
    'SELECT 1',
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN invite_slot_date DATE NULL AFTER invite_slot_label'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.statistics
      WHERE table_schema = @db
        AND table_name = 'recruitment_lead_overlay'
        AND index_name = 'idx_recruitment_lead_invite_slot_date'
    ),
    'SELECT 1',
    'ALTER TABLE recruitment_lead_overlay ADD KEY idx_recruitment_lead_invite_slot_date (invite_slot_date, invite_status, inactive)'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
