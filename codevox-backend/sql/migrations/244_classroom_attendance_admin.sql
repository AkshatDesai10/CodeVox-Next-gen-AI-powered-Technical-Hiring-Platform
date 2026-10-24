-- Classroom attendance admin extensions (no FKs).

ALTER TABLE ca_rooms
  ADD COLUMN rtsp_url VARCHAR(512) NULL AFTER rtsp_hint,
  ADD COLUMN match_threshold DOUBLE NULL AFTER rtsp_url,
  ADD COLUMN det_thresh DOUBLE NULL AFTER match_threshold,
  ADD COLUMN zone_polygon_json JSON NULL AFTER det_thresh,
  ADD COLUMN linked_course_id VARCHAR(128) NULL AFTER zone_polygon_json,
  ADD COLUMN linked_section_id VARCHAR(128) NULL AFTER linked_course_id;

ALTER TABLE ca_attendance_events
  ADD COLUMN best_frame_storage_key VARCHAR(512) NULL AFTER last_seen;

ALTER TABLE ca_room_health_events
  ADD COLUMN embedding_version VARCHAR(128) NULL AFTER process_uptime_seconds,
  ADD COLUMN outbox_pending_count INT NULL AFTER embedding_version;

CREATE TABLE IF NOT EXISTS ca_student_enrollment (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(128) NOT NULL,
  section_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  photo_count INT NOT NULL DEFAULT 0,
  quality_issue TINYINT(1) NOT NULL DEFAULT 0,
  last_updated DATETIME(3) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ca_student_enrollment (student_id, section_id),
  KEY idx_ca_student_enrollment_section (section_id),
  KEY idx_ca_student_enrollment_status (status)
);

CREATE TABLE IF NOT EXISTS ca_enrollment_photos (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  student_id VARCHAR(128) NOT NULL,
  section_id VARCHAR(128) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  quality_flag TINYINT(1) NOT NULL DEFAULT 0,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ca_enrollment_photos_student (student_id, section_id)
);

CREATE TABLE IF NOT EXISTS ca_unmatched_faces (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(128) NOT NULL,
  room_id VARCHAR(64) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  partial_score DOUBLE NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'open',
  assigned_student_id VARCHAR(128) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_ca_unmatched_session (session_id),
  KEY idx_ca_unmatched_status (status)
);

CREATE TABLE IF NOT EXISTS ca_attendance_overrides (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  session_id VARCHAR(128) NOT NULL,
  student_id VARCHAR(128) NOT NULL,
  status VARCHAR(32) NOT NULL,
  reason VARCHAR(512) NOT NULL,
  overridden_by BIGINT UNSIGNED NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ca_attendance_overrides (session_id, student_id),
  KEY idx_ca_overrides_session (session_id)
);

-- Seed enrollment rows for pilot roster students
INSERT INTO ca_student_enrollment (student_id, section_id, status, photo_count, last_updated, inactive)
VALUES
  ('anayka', 'A', 'enrolled', 0, UTC_TIMESTAMP(3), 0),
  ('rahul', 'A', 'enrolled', 0, UTC_TIMESTAMP(3), 0),
  ('renuka', 'A', 'enrolled', 0, UTC_TIMESTAMP(3), 0),
  ('shivansh', 'A', 'enrolled', 0, UTC_TIMESTAMP(3), 0)
ON DUPLICATE KEY UPDATE status = VALUES(status), inactive = 0;

UPDATE ca_rooms
SET rtsp_url = COALESCE(rtsp_url, rtsp_hint),
    match_threshold = COALESCE(match_threshold, 0.45),
    det_thresh = COALESCE(det_thresh, 0.25),
    linked_course_id = COALESCE(linked_course_id, 'CS101'),
    linked_section_id = COALESCE(linked_section_id, 'A')
WHERE room_id = 'ROOM_101';
