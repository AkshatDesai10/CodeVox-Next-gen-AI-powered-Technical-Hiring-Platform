-- Seed 5 classroom CCTV rooms + timetable sessions (run after 247).
-- Avoid DELETE (RDS app user may lack DELETE privilege).
-- Roster student_id = vv_students.id for ENR2025001..4 (must already exist).

-- ---------------------------------------------------------------------------
-- Rooms
-- ---------------------------------------------------------------------------
INSERT INTO ca_rooms (room_id, label, rtsp_hint)
VALUES
  ('ROOM_101', 'Pilot Room 101', 'seed_data/test_video1.mp4'),
  ('ROOM_102', 'Pilot Room 102', 'seed_data/test_video1.mp4'),
  ('ROOM_103', 'Pilot Room 103', 'seed_data/test_video1.mp4'),
  ('ROOM_104', 'Pilot Room 104', 'seed_data/test_video1.mp4'),
  ('ROOM_105', 'Pilot Room 105', 'seed_data/test_video1.mp4')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  rtsp_hint = VALUES(rtsp_hint),
  inactive = 0;

-- Shared edge API key (guard matches key only)
INSERT INTO ca_edge_api_keys (room_id, api_key, active, inactive)
SELECT 'ROOM_101', 'pilot-edge-key-change-me', 1, 0
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM ca_edge_api_keys WHERE api_key = 'pilot-edge-key-change-me' AND inactive = 0
);

-- ---------------------------------------------------------------------------
-- 5 timetable classes (course_id = viva_courses.id; all active "now")
-- ---------------------------------------------------------------------------
INSERT INTO ca_timetable_sessions (
  session_id, room_id, course_id, section_id, start_time, end_time, inactive
)
SELECT
  v.session_id,
  v.room_id,
  CAST(c.id AS CHAR),
  v.section_id,
  v.start_time,
  v.end_time,
  0
FROM (
  SELECT
    'CS101_A_PILOT' AS session_id,
    'ROOM_101' AS room_id,
    'CS101' AS course_code,
    'A' AS section_id,
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') - INTERVAL 2 HOUR AS start_time,
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') + INTERVAL 24 HOUR AS end_time
  UNION ALL SELECT
    'CS201_B_PILOT', 'ROOM_102', 'CS201', 'B',
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') - INTERVAL 2 HOUR,
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') + INTERVAL 24 HOUR
  UNION ALL SELECT
    'MATH101_A_PILOT', 'ROOM_103', 'MATH101', 'A',
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') - INTERVAL 1 HOUR,
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') + INTERVAL 24 HOUR
  UNION ALL SELECT
    'PHY101_A_PILOT', 'ROOM_104', 'PHY101', 'A',
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') - INTERVAL 90 MINUTE,
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') + INTERVAL 24 HOUR
  UNION ALL SELECT
    'ENG101_A_PILOT', 'ROOM_105', 'ENG101', 'A',
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') - INTERVAL 30 MINUTE,
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') + INTERVAL 24 HOUR
) v
INNER JOIN viva_courses c
  ON c.course_code COLLATE utf8mb4_unicode_ci = v.course_code COLLATE utf8mb4_unicode_ci
 AND c.inactive = 0
ON DUPLICATE KEY UPDATE
  room_id = VALUES(room_id),
  course_id = VALUES(course_id),
  section_id = VALUES(section_id),
  start_time = VALUES(start_time),
  end_time = VALUES(end_time),
  inactive = 0;

-- ---------------------------------------------------------------------------
-- Roster: same 4 pilot viva students on every session
-- ---------------------------------------------------------------------------
INSERT INTO ca_session_roster (session_id, student_id, inactive)
SELECT s.session_id, v.id, 0
FROM (
  SELECT 'CS101_A_PILOT' AS session_id
  UNION ALL SELECT 'CS201_B_PILOT'
  UNION ALL SELECT 'MATH101_A_PILOT'
  UNION ALL SELECT 'PHY101_A_PILOT'
  UNION ALL SELECT 'ENG101_A_PILOT'
) s
INNER JOIN vv_students v
  ON v.inactive = 0
 AND v.enrollment_id COLLATE utf8mb4_unicode_ci IN (
   'ENR2025001' COLLATE utf8mb4_unicode_ci,
   'ENR2025002' COLLATE utf8mb4_unicode_ci,
   'ENR2025003' COLLATE utf8mb4_unicode_ci,
   'ENR2025004' COLLATE utf8mb4_unicode_ci
 )
ON DUPLICATE KEY UPDATE inactive = 0;

UPDATE ca_embedding_index_meta
SET version = CONCAT('seed5-', DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'), '%Y%m%d%H%i%s'))
WHERE id = 1;

INSERT INTO ca_embedding_index_meta (id, version)
SELECT 1, CONCAT('seed5-', DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'), '%Y%m%d%H%i%s'))
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM ca_embedding_index_meta WHERE id = 1);
