-- Ops UI: audit events, system config, camera label + pinned assignment.

ALTER TABLE ca_cameras
  ADD COLUMN label VARCHAR(255) NULL AFTER rtsp_url,
  ADD COLUMN assignment_pinned TINYINT(1) NOT NULL DEFAULT 0 AFTER assigned_worker_id;

CREATE TABLE IF NOT EXISTS ca_system_config (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  match_threshold DOUBLE NOT NULL DEFAULT 0.45,
  det_thresh DOUBLE NOT NULL DEFAULT 0.25,
  recognition_recheck_seconds DOUBLE NOT NULL DEFAULT 45,
  presence_threshold_ratio DOUBLE NOT NULL DEFAULT 0.4,
  frame_skip INT NOT NULL DEFAULT 5,
  heartbeat_interval_seconds DOUBLE NOT NULL DEFAULT 30,
  auto_rebalance TINYINT(1) NOT NULL DEFAULT 1,
  notify_critical TINYINT(1) NOT NULL DEFAULT 1,
  notify_threshold TINYINT(1) NOT NULL DEFAULT 1,
  notify_maintenance TINYINT(1) NOT NULL DEFAULT 0,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO ca_system_config (id) VALUES (1)
ON DUPLICATE KEY UPDATE id = id;

CREATE TABLE IF NOT EXISTS ca_audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  actor VARCHAR(128) NOT NULL DEFAULT 'system',
  category VARCHAR(64) NOT NULL,
  summary VARCHAR(512) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  ip VARCHAR(64) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_ca_audit_created (created_at),
  KEY idx_ca_audit_category (category)
);
