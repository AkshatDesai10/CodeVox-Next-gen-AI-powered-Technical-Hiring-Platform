-- Allow soft-delete as reset: unique constraints apply only to active rows.
-- Inactive rows keep history but free the logical key for re-ingest.

-- ---------------------------------------------------------------------------
-- ca_attendance_events (session_id, student_id, track_id)
-- ---------------------------------------------------------------------------
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ca_attendance_events'
    AND INDEX_NAME = 'uq_ca_attendance_events_session_student_track'
);
SET @sql := IF(
  @idx > 0,
  'ALTER TABLE ca_attendance_events DROP INDEX uq_ca_attendance_events_session_student_track',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ca_attendance_events'
    AND COLUMN_NAME = 'active_uniq_key'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE ca_attendance_events
     ADD COLUMN active_uniq_key VARCHAR(191)
       GENERATED ALWAYS AS (
         IF(
           inactive = 0,
           CONCAT(session_id, '':'', student_id, '':'', track_id),
           NULL
         )
       ) STORED',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ca_attendance_events'
    AND INDEX_NAME = 'uq_ca_attendance_events_active'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE ca_attendance_events ADD UNIQUE KEY uq_ca_attendance_events_active (active_uniq_key)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- ca_attendance_overrides (session_id, student_id)
-- ---------------------------------------------------------------------------
SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ca_attendance_overrides'
    AND INDEX_NAME = 'uq_ca_attendance_overrides'
);
SET @sql := IF(
  @idx > 0,
  'ALTER TABLE ca_attendance_overrides DROP INDEX uq_ca_attendance_overrides',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ca_attendance_overrides'
    AND COLUMN_NAME = 'active_uniq_key'
);
SET @sql := IF(
  @col = 0,
  'ALTER TABLE ca_attendance_overrides
     ADD COLUMN active_uniq_key VARCHAR(191)
       GENERATED ALWAYS AS (
         IF(
           inactive = 0,
           CONCAT(session_id, '':'', student_id),
           NULL
         )
       ) STORED',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ca_attendance_overrides'
    AND INDEX_NAME = 'uq_ca_attendance_overrides_active'
);
SET @sql := IF(
  @idx = 0,
  'ALTER TABLE ca_attendance_overrides ADD UNIQUE KEY uq_ca_attendance_overrides_active (active_uniq_key)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
