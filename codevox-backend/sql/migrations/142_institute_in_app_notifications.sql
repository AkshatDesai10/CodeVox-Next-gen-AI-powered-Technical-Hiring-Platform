-- In-app notifications for institute portal users and ERP staff inbox links.

CREATE TABLE IF NOT EXISTS institute_notifications (
  id CHAR(36) NOT NULL PRIMARY KEY,
  institution_id BIGINT UNSIGNED NOT NULL,
  user_id CHAR(36) NULL COMMENT 'NULL = all users at institution',
  template_key VARCHAR(100) NOT NULL,
  title VARCHAR(300) NOT NULL,
  body TEXT NOT NULL,
  link VARCHAR(512) NULL,
  nav_key VARCHAR(64) NULL,
  entity_type VARCHAR(50) NULL,
  entity_id VARCHAR(64) NULL,
  read_flag TINYINT(1) NOT NULL DEFAULT 0,
  metadata JSON NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_inst_notif_user_read (user_id, read_flag, inactive),
  KEY idx_inst_notif_inst_read (institution_id, read_flag, inactive),
  KEY idx_inst_notif_nav (institution_id, nav_key, read_flag, inactive),
  KEY idx_inst_notif_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE erp_staff_notifications
  ADD COLUMN link VARCHAR(512) NULL AFTER body,
  ADD COLUMN nav_key VARCHAR(64) NULL AFTER link;
