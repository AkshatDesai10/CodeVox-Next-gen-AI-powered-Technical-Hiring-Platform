-- ERP Billing notification templates, settings, and delivery log.

CREATE TABLE IF NOT EXISTS erp_notification_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_key VARCHAR(100) NOT NULL,
  event_code VARCHAR(20) NOT NULL,
  category ENUM(
    'QUOTE','INVOICE','PAYMENT','SUBSCRIPTION',
    'CONTRACT','DUNNING','TALLY','REVENUE','PORTAL'
  ) NOT NULL,
  name VARCHAR(200) NOT NULL,
  description TEXT NULL,
  recipient_role VARCHAR(50) NOT NULL DEFAULT 'institution_contact',
  channel_in_app TINYINT(1) NOT NULL DEFAULT 0,
  channel_email TINYINT(1) NOT NULL DEFAULT 1,
  channel_sms TINYINT(1) NOT NULL DEFAULT 0,
  channel_whatsapp TINYINT(1) NOT NULL DEFAULT 0,
  enabled TINYINT(1) NOT NULL DEFAULT 1,
  is_critical TINYINT(1) NOT NULL DEFAULT 0,
  is_external TINYINT(1) NOT NULL DEFAULT 0,
  can_unsubscribe TINYINT(1) NOT NULL DEFAULT 0,
  email_subject VARCHAR(500) NULL,
  email_body_html MEDIUMTEXT NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_erp_notification_events_key (template_key),
  KEY idx_erp_notification_events_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS erp_notification_category_settings (
  category ENUM(
    'QUOTE','INVOICE','PAYMENT','SUBSCRIPTION',
    'CONTRACT','DUNNING','TALLY','REVENUE','PORTAL'
  ) NOT NULL,
  channel_in_app TINYINT(1) NOT NULL DEFAULT 0,
  channel_email TINYINT(1) NOT NULL DEFAULT 1,
  channel_sms TINYINT(1) NOT NULL DEFAULT 0,
  channel_whatsapp TINYINT(1) NOT NULL DEFAULT 0,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS erp_notification_global_settings (
  id TINYINT UNSIGNED NOT NULL DEFAULT 1,
  global_sync TINYINT(1) NOT NULL DEFAULT 1,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO erp_notification_global_settings (id, global_sync) VALUES (1, 1);

CREATE TABLE IF NOT EXISTS erp_notification_deliveries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_key VARCHAR(100) NOT NULL,
  channel ENUM('IN_APP','EMAIL','SMS','WHATSAPP') NOT NULL,
  recipient VARCHAR(255) NOT NULL,
  status ENUM('SENT','FAILED','SKIPPED','PENDING') NOT NULL DEFAULT 'SENT',
  entity_type VARCHAR(50) NULL,
  entity_id VARCHAR(64) NULL,
  error_message VARCHAR(500) NULL,
  metadata JSON NULL,
  sent_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_erp_notification_deliveries_key_recipient (template_key, recipient, sent_at),
  KEY idx_erp_notification_deliveries_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS erp_staff_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_email VARCHAR(191) NULL,
  recipient_role VARCHAR(50) NOT NULL,
  template_key VARCHAR(100) NOT NULL,
  title VARCHAR(300) NOT NULL,
  body TEXT NOT NULL,
  entity_type VARCHAR(50) NULL,
  entity_id VARCHAR(64) NULL,
  read_flag TINYINT(1) NOT NULL DEFAULT 0,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_erp_staff_notifications_email_read (user_email, read_flag, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
