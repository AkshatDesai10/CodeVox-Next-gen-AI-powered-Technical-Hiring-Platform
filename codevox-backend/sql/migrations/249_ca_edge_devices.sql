-- Edge device registration for zero-touch classroom CCTV boxes.

CREATE TABLE IF NOT EXISTS ca_edge_devices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  device_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  room_id VARCHAR(64) NULL,
  api_key_id BIGINT UNSIGNED NULL,
  label VARCHAR(255) NULL,
  last_seen_at DATETIME(3) NULL,
  assigned_at DATETIME(3) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ca_edge_devices_device_id (device_id),
  KEY idx_ca_edge_devices_status (status),
  KEY idx_ca_edge_devices_room (room_id)
);
