-- Classroom CCTV face-attendance (edge box pilot).
-- No FOREIGN KEY constraints (RDS app user often lacks REFERENCES privilege).

CREATE TABLE IF NOT EXISTS ca_rooms (
  room_id VARCHAR(64) NOT NULL PRIMARY KEY,
  label VARCHAR(255) NULL,
  rtsp_hint VARCHAR(512) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ca_edge_api_keys (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  room_id VARCHAR(64) NULL,
  api_key VARCHAR(128) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ca_edge_api_keys_api_key (api_key),
  KEY idx_ca_edge_api_keys_room (room_id)
);

CREATE TABLE IF NOT EXISTS ca_embedding_index_meta (
  id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  version VARCHAR(128) NOT NULL,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO ca_embedding_index_meta (id, version)
VALUES (1, 'bootstrap-0')
ON DUPLICATE KEY UPDATE id = id;

CREATE TABLE IF NOT EXISTS ca_face_embeddings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(128) NOT NULL,
  section_id VARCHAR(128) NOT NULL,
  vector_json JSON NOT NULL,
  version VARCHAR(128) NOT NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ca_face_embeddings_student_section (student_id, section_id),
  KEY idx_ca_face_embeddings_section (section_id),
  KEY idx_ca_face_embeddings_version (version)
);

CREATE TABLE IF NOT EXISTS ca_timetable_sessions (
  session_id VARCHAR(128) NOT NULL PRIMARY KEY,
  room_id VARCHAR(64) NOT NULL,
  course_id VARCHAR(128) NOT NULL,
  section_id VARCHAR(128) NOT NULL,
  start_time DATETIME(3) NOT NULL,
  end_time DATETIME(3) NOT NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ca_timetable_room_time (room_id, start_time, end_time)
);

CREATE TABLE IF NOT EXISTS ca_session_roster (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(128) NOT NULL,
  student_id VARCHAR(128) NOT NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ca_session_roster (session_id, student_id),
  KEY idx_ca_session_roster_session (session_id)
);

CREATE TABLE IF NOT EXISTS ca_attendance_sessions (
  session_id VARCHAR(128) NOT NULL PRIMARY KEY,
  room_id VARCHAR(64) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  summary_json JSON NULL,
  finalized_at DATETIME(3) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ca_attendance_sessions_room (room_id)
);

CREATE TABLE IF NOT EXISTS ca_attendance_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  room_id VARCHAR(64) NOT NULL,
  session_id VARCHAR(128) NOT NULL,
  student_id VARCHAR(128) NOT NULL,
  track_id INT NOT NULL,
  coverage_ratio DOUBLE NULL,
  total_seconds_tracked DOUBLE NULL,
  best_match_score DOUBLE NULL,
  first_seen VARCHAR(64) NULL,
  last_seen VARCHAR(64) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ca_attendance_events_session_student_track (session_id, student_id, track_id),
  KEY idx_ca_attendance_events_session (session_id)
);

CREATE TABLE IF NOT EXISTS ca_room_health_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  room_id VARCHAR(64) NOT NULL,
  camera_connected TINYINT(1) NOT NULL DEFAULT 0,
  last_frame_timestamp DOUBLE NULL,
  active_session_id VARCHAR(128) NULL,
  process_uptime_seconds DOUBLE NULL,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_ca_room_health_room_time (room_id, createdAt)
);

INSERT INTO ca_rooms (room_id, label)
VALUES ('ROOM_101', 'Pilot Room 101')
ON DUPLICATE KEY UPDATE label = VALUES(label);

INSERT INTO ca_edge_api_keys (room_id, api_key, active)
SELECT 'ROOM_101', 'pilot-edge-key-change-me', 1
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM ca_edge_api_keys WHERE api_key = 'pilot-edge-key-change-me'
);
