-- Stage 1 Fleet: edge-node fields on workers, camera discovery/profile/capture,
-- diagnostics, versioned runtime profiles.

-- ---------------------------------------------------------------------------
-- ca_workers extensions (edge node admin)
-- ---------------------------------------------------------------------------
ALTER TABLE ca_workers
  ADD COLUMN name VARCHAR(255) NULL AFTER hostname,
  ADD COLUMN role VARCHAR(64) NOT NULL DEFAULT 'edge_primary' AFTER name,
  ADD COLUMN mode VARCHAR(64) NOT NULL DEFAULT 'hybrid_capture_pilot' AFTER role,
  ADD COLUMN provision_status VARCHAR(32) NOT NULL DEFAULT 'provisioned' AFTER mode,
  ADD COLUMN auth_token_hash VARCHAR(128) NULL AFTER provision_status;

UPDATE ca_workers SET name = hostname WHERE name IS NULL OR name = '';

-- ---------------------------------------------------------------------------
-- Runtime profiles (source of truth for remote room config policy)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ca_runtime_profiles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,
  parent_profile_id BIGINT UNSIGNED NULL,
  clip_duration_seconds INT NOT NULL DEFAULT 10,
  frame_sample_rate INT NOT NULL DEFAULT 30,
  detection_confidence_threshold DOUBLE NOT NULL DEFAULT 0.35,
  min_face_size INT NOT NULL DEFAULT 16,
  capture_window_seconds INT NOT NULL DEFAULT 300,
  recapture_attempts INT NOT NULL DEFAULT 2,
  review_policy VARCHAR(64) NOT NULL DEFAULT 'standard',
  match_threshold DOUBLE NOT NULL DEFAULT 0.45,
  det_thresh DOUBLE NOT NULL DEFAULT 0.35,
  det_size_json JSON NULL,
  frame_skip INT NOT NULL DEFAULT 30,
  idle_frame_skip INT NOT NULL DEFAULT 30,
  recognition_recheck_seconds DOUBLE NOT NULL DEFAULT 45,
  needs_aggressive_detection TINYINT(1) NOT NULL DEFAULT 0,
  tile_detection TINYINT(1) NOT NULL DEFAULT 0,
  tile_grid_json JSON NULL,
  detect_scales_json JSON NULL,
  presence_threshold_ratio DOUBLE NOT NULL DEFAULT 0.4,
  snapshot_enabled TINYINT(1) NOT NULL DEFAULT 1,
  snapshot_interval_seconds DOUBLE NOT NULL DEFAULT 2,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ca_runtime_profiles_status (status),
  KEY idx_ca_runtime_profiles_parent (parent_profile_id)
);

INSERT INTO ca_runtime_profiles (
  name, status, version,
  clip_duration_seconds, frame_sample_rate, detection_confidence_threshold,
  min_face_size, capture_window_seconds, recapture_attempts, review_policy,
  match_threshold, det_thresh, det_size_json, frame_skip, idle_frame_skip,
  recognition_recheck_seconds, presence_threshold_ratio,
  snapshot_enabled, snapshot_interval_seconds, inactive
)
SELECT
  'standard_classroom_cctv', 'active', 1,
  10, 30, 0.35,
  16, 300, 2, 'standard',
  0.45, 0.35, JSON_ARRAY(640, 640), 30, 30,
  45, 0.4,
  1, 2, 0
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM ca_runtime_profiles WHERE name = 'standard_classroom_cctv' AND inactive = 0
);

-- ---------------------------------------------------------------------------
-- ca_cameras extensions
-- ---------------------------------------------------------------------------
-- Allow cameras without a room (wizard). MySQL UNIQUE allows multiple NULLs.
ALTER TABLE ca_cameras
  MODIFY COLUMN room_id BIGINT UNSIGNED NULL;

ALTER TABLE ca_cameras
  ADD COLUMN runtime_profile_id BIGINT UNSIGNED NULL AFTER assigned_worker_id,
  ADD COLUMN validation_status VARCHAR(32) NOT NULL DEFAULT 'unknown' AFTER runtime_profile_id,
  ADD COLUMN last_probe_at DATETIME(3) NULL AFTER validation_status,
  ADD COLUMN capture_validation_duration_seconds INT NULL AFTER last_probe_at,
  ADD COLUMN session_capture_window_seconds INT NULL AFTER capture_validation_duration_seconds,
  ADD COLUMN recognition_capture_role TINYINT(1) NOT NULL DEFAULT 0 AFTER session_capture_window_seconds;

-- ---------------------------------------------------------------------------
-- Discovery staging
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ca_camera_discovery (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  ip VARCHAR(64) NOT NULL,
  suggested_name VARCHAR(255) NOT NULL,
  rtsp_guess VARCHAR(512) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'discovered',
  discovered_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_ca_discovery_status (status)
);

-- ---------------------------------------------------------------------------
-- Worker diagnostics
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ca_worker_diagnostics (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  worker_id BIGINT UNSIGNED NOT NULL,
  code VARCHAR(64) NOT NULL DEFAULT 'error',
  message VARCHAR(512) NOT NULL,
  detail_json JSON NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  KEY idx_ca_worker_diag_worker (worker_id),
  KEY idx_ca_worker_diag_created (created_at)
);
