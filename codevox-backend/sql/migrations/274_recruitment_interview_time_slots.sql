-- Admin-configured interview time slots used when sending magic-link invites.

CREATE TABLE IF NOT EXISTS recruitment_interview_time_slots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  label VARCHAR(120) NULL,
  slot_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  capacity INT UNSIGNED NOT NULL DEFAULT 1,
  booked_count INT UNSIGNED NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  notes VARCHAR(500) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_recruitment_slots_date_status (slot_date, status, inactive)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET @db := DATABASE();

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'invite_slot_id'
    ),
    'SELECT 1',
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN invite_slot_id BIGINT UNSIGNED NULL AFTER invite_token'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(
    EXISTS(
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = @db AND table_name = 'recruitment_lead_overlay' AND column_name = 'invite_slot_label'
    ),
    'SELECT 1',
    'ALTER TABLE recruitment_lead_overlay ADD COLUMN invite_slot_label VARCHAR(255) NULL AFTER invite_slot_id'
  )
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
