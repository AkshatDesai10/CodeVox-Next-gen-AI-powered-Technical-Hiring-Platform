-- GPU worker pool + cameras (integer FKs to ca_rooms.id / ca_workers.id).

CREATE TABLE IF NOT EXISTS ca_workers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  worker_key VARCHAR(64) NOT NULL,
  hostname VARCHAR(255) NOT NULL DEFAULT '',
  max_streams_capacity INT NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'offline',
  last_heartbeat DATETIME(3) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ca_workers_worker_key (worker_key),
  KEY idx_ca_workers_status (status)
);

CREATE TABLE IF NOT EXISTS ca_cameras (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  room_id BIGINT UNSIGNED NOT NULL,
  rtsp_url VARCHAR(512) NOT NULL,
  assigned_worker_id BIGINT UNSIGNED NULL,
  last_processed_at DATETIME(3) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ca_cameras_room_id (room_id),
  KEY idx_ca_cameras_assigned_worker (assigned_worker_id),
  KEY idx_ca_cameras_inactive (inactive)
);
