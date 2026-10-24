-- Invite columns on recruitment_lead_overlay (entity: inviteStatus / inviteToken).
-- Must run before 268_resume_match_overlay.sql, which adds columns AFTER invite_token.
-- Idempotent: safe to re-run.

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN invite_status VARCHAR(32) NULL AFTER last_local_action_at',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'invite_status'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN invite_token VARCHAR(64) NULL AFTER invite_status',
    'SELECT 1'
  )
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'invite_token'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
