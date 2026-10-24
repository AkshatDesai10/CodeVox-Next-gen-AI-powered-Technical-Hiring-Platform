-- Classroom attendance: autoincrement ids + student_id -> vv_students.id
-- Pattern for student_id: UPDATE varchar with int (as digits) THEN MODIFY to BIGINT.
-- Does NOT insert into vv_students — only maps existing rows (by enrollment_id / name / id).

-- ---------------------------------------------------------------------------
-- 1) Autoincrement id on tables that used natural PKs
-- ---------------------------------------------------------------------------

SET @has_ca_rooms_id := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_rooms' AND COLUMN_NAME = 'id'
);
SET @sql := IF(
  @has_ca_rooms_id = 0,
  'ALTER TABLE ca_rooms ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST, DROP PRIMARY KEY, ADD PRIMARY KEY (id), ADD UNIQUE KEY uq_ca_rooms_room_id (room_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_timetable_sessions' AND COLUMN_NAME = 'id'
);
SET @sql := IF(
  @has = 0,
  'ALTER TABLE ca_timetable_sessions ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST, DROP PRIMARY KEY, ADD PRIMARY KEY (id), ADD UNIQUE KEY uq_ca_timetable_session_id (session_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_attendance_sessions' AND COLUMN_NAME = 'id'
);
SET @sql := IF(
  @has = 0,
  'ALTER TABLE ca_attendance_sessions ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST, DROP PRIMARY KEY, ADD PRIMARY KEY (id), ADD UNIQUE KEY uq_ca_attendance_session_id (session_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE ca_embedding_index_meta
  MODIFY id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT;

-- ---------------------------------------------------------------------------
-- 2) Map student_id VARCHAR -> vv_students.id digits (only while still varchar)
-- ---------------------------------------------------------------------------

SET @emb_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_face_embeddings' AND COLUMN_NAME = 'student_id'
);

SET @sql := IF(
  @emb_type = 'varchar',
  'UPDATE ca_face_embeddings t
   INNER JOIN vv_students v
     ON (
       CAST(v.id AS CHAR) COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR v.enrollment_id COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR LOWER(v.student_name) COLLATE utf8mb4_unicode_ci = LOWER(t.student_id) COLLATE utf8mb4_unicode_ci
     )
   SET t.student_id = CAST(v.id AS CHAR)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @roster_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_session_roster' AND COLUMN_NAME = 'student_id'
);
SET @sql := IF(
  @roster_type = 'varchar',
  'UPDATE ca_session_roster t
   INNER JOIN vv_students v
     ON (
       CAST(v.id AS CHAR) COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR v.enrollment_id COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR LOWER(v.student_name) COLLATE utf8mb4_unicode_ci = LOWER(t.student_id) COLLATE utf8mb4_unicode_ci
     )
   SET t.student_id = CAST(v.id AS CHAR)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @evt_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_attendance_events' AND COLUMN_NAME = 'student_id'
);
SET @sql := IF(
  @evt_type = 'varchar',
  'UPDATE ca_attendance_events t
   INNER JOIN vv_students v
     ON (
       CAST(v.id AS CHAR) COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR v.enrollment_id COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR LOWER(v.student_name) COLLATE utf8mb4_unicode_ci = LOWER(t.student_id) COLLATE utf8mb4_unicode_ci
     )
   SET t.student_id = CAST(v.id AS CHAR)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @enr_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_student_enrollment' AND COLUMN_NAME = 'student_id'
);
SET @sql := IF(
  @enr_type = 'varchar',
  'UPDATE ca_student_enrollment t
   INNER JOIN vv_students v
     ON (
       CAST(v.id AS CHAR) COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR v.enrollment_id COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR LOWER(v.student_name) COLLATE utf8mb4_unicode_ci = LOWER(t.student_id) COLLATE utf8mb4_unicode_ci
     )
   SET t.student_id = CAST(v.id AS CHAR)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @photo_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_enrollment_photos' AND COLUMN_NAME = 'student_id'
);
SET @sql := IF(
  @photo_type = 'varchar',
  'UPDATE ca_enrollment_photos t
   INNER JOIN vv_students v
     ON (
       CAST(v.id AS CHAR) COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR v.enrollment_id COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR LOWER(v.student_name) COLLATE utf8mb4_unicode_ci = LOWER(t.student_id) COLLATE utf8mb4_unicode_ci
     )
   SET t.student_id = CAST(v.id AS CHAR)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @ov_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_attendance_overrides' AND COLUMN_NAME = 'student_id'
);
SET @sql := IF(
  @ov_type = 'varchar',
  'UPDATE ca_attendance_overrides t
   INNER JOIN vv_students v
     ON (
       CAST(v.id AS CHAR) COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR v.enrollment_id COLLATE utf8mb4_unicode_ci = t.student_id COLLATE utf8mb4_unicode_ci
       OR LOWER(v.student_name) COLLATE utf8mb4_unicode_ci = LOWER(t.student_id) COLLATE utf8mb4_unicode_ci
     )
   SET t.student_id = CAST(v.id AS CHAR)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @uf_type := (
  SELECT DATA_TYPE FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'ca_unmatched_faces' AND COLUMN_NAME = 'assigned_student_id'
);
SET @sql := IF(
  @uf_type = 'varchar',
  'UPDATE ca_unmatched_faces t
   INNER JOIN vv_students v
     ON (
       CAST(v.id AS CHAR) COLLATE utf8mb4_unicode_ci = t.assigned_student_id COLLATE utf8mb4_unicode_ci
       OR v.enrollment_id COLLATE utf8mb4_unicode_ci = t.assigned_student_id COLLATE utf8mb4_unicode_ci
       OR LOWER(v.student_name) COLLATE utf8mb4_unicode_ci = LOWER(t.assigned_student_id) COLLATE utf8mb4_unicode_ci
     )
   SET t.assigned_student_id = CAST(v.id AS CHAR)
   WHERE t.assigned_student_id IS NOT NULL AND t.assigned_student_id <> ''''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Clear unmapped leftovers while still varchar
SET @sql := IF(
  @emb_type = 'varchar',
  'UPDATE ca_face_embeddings SET student_id = ''0'' WHERE student_id REGEXP ''[^0-9]''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @roster_type = 'varchar',
  'UPDATE ca_session_roster SET student_id = ''0'' WHERE student_id REGEXP ''[^0-9]''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @evt_type = 'varchar',
  'UPDATE ca_attendance_events SET student_id = ''0'' WHERE student_id REGEXP ''[^0-9]''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @enr_type = 'varchar',
  'UPDATE ca_student_enrollment SET student_id = ''0'' WHERE student_id REGEXP ''[^0-9]''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @photo_type = 'varchar',
  'UPDATE ca_enrollment_photos SET student_id = ''0'' WHERE student_id REGEXP ''[^0-9]''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @ov_type = 'varchar',
  'UPDATE ca_attendance_overrides SET student_id = ''0'' WHERE student_id REGEXP ''[^0-9]''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @uf_type = 'varchar',
  'UPDATE ca_unmatched_faces SET assigned_student_id = NULL WHERE assigned_student_id IS NOT NULL AND assigned_student_id REGEXP ''[^0-9]''',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 3) Change column types VARCHAR -> BIGINT UNSIGNED
-- ---------------------------------------------------------------------------

SET @sql := IF(
  @emb_type = 'varchar',
  'ALTER TABLE ca_face_embeddings MODIFY COLUMN student_id BIGINT UNSIGNED NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @roster_type = 'varchar',
  'ALTER TABLE ca_session_roster MODIFY COLUMN student_id BIGINT UNSIGNED NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @evt_type = 'varchar',
  'ALTER TABLE ca_attendance_events MODIFY COLUMN student_id BIGINT UNSIGNED NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @enr_type = 'varchar',
  'ALTER TABLE ca_student_enrollment MODIFY COLUMN student_id BIGINT UNSIGNED NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @photo_type = 'varchar',
  'ALTER TABLE ca_enrollment_photos MODIFY COLUMN student_id BIGINT UNSIGNED NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @ov_type = 'varchar',
  'ALTER TABLE ca_attendance_overrides MODIFY COLUMN student_id BIGINT UNSIGNED NOT NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := IF(
  @uf_type = 'varchar',
  'ALTER TABLE ca_unmatched_faces MODIFY COLUMN assigned_student_id BIGINT UNSIGNED NULL',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE ca_face_embeddings SET inactive = 1 WHERE student_id = 0;
UPDATE ca_session_roster SET inactive = 1 WHERE student_id = 0;
UPDATE ca_attendance_events SET inactive = 1 WHERE student_id = 0;
UPDATE ca_student_enrollment SET inactive = 1 WHERE student_id = 0;
UPDATE ca_enrollment_photos SET inactive = 1 WHERE student_id = 0;
UPDATE ca_attendance_overrides SET inactive = 1 WHERE student_id = 0;

-- Re-seed enrollment / roster only for existing viva students (image map enrollment_ids).
-- Folder keys anayka/rahul/renuka/shivansh -> ENR2025001..4 (see student_image_map.yaml / migrate 247).
INSERT INTO ca_student_enrollment (student_id, section_id, status, photo_count, last_updated, inactive)
SELECT v.id, 'A', 'enrolled', 0, UTC_TIMESTAMP(3), 0
FROM vv_students v
WHERE v.inactive = 0
  AND v.enrollment_id COLLATE utf8mb4_unicode_ci IN (
    'ENR2025001' COLLATE utf8mb4_unicode_ci,
    'ENR2025002' COLLATE utf8mb4_unicode_ci,
    'ENR2025003' COLLATE utf8mb4_unicode_ci,
    'ENR2025004' COLLATE utf8mb4_unicode_ci
  )
ON DUPLICATE KEY UPDATE status = VALUES(status), inactive = 0;

INSERT INTO ca_session_roster (session_id, student_id, inactive)
SELECT 'CS101_A_PILOT', v.id, 0
FROM vv_students v
WHERE v.inactive = 0
  AND v.enrollment_id COLLATE utf8mb4_unicode_ci IN (
    'ENR2025001' COLLATE utf8mb4_unicode_ci,
    'ENR2025002' COLLATE utf8mb4_unicode_ci,
    'ENR2025003' COLLATE utf8mb4_unicode_ci,
    'ENR2025004' COLLATE utf8mb4_unicode_ci
  )
ON DUPLICATE KEY UPDATE inactive = 0;
