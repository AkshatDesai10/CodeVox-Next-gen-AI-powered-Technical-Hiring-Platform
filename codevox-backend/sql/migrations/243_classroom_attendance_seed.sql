-- Pilot seed for classroom CCTV attendance (run after 242).
-- Avoid DELETE (RDS app user may lack DELETE privilege).

INSERT INTO ca_rooms (room_id, label, rtsp_hint)
VALUES ('ROOM_101', 'Pilot Room 101', 'seed_data/test_video1.mp4')
ON DUPLICATE KEY UPDATE
  label = VALUES(label),
  rtsp_hint = VALUES(rtsp_hint),
  inactive = 0;

INSERT INTO ca_edge_api_keys (room_id, api_key, active, inactive)
SELECT 'ROOM_101', 'pilot-edge-key-change-me', 1, 0
FROM DUAL
WHERE NOT EXISTS (
  SELECT 1 FROM ca_edge_api_keys WHERE api_key = 'pilot-edge-key-change-me' AND inactive = 0
);

INSERT INTO ca_timetable_sessions (
  session_id, room_id, course_id, section_id, start_time, end_time, inactive
)
SELECT
  'CS101_A_PILOT',
  'ROOM_101',
  CAST(c.id AS CHAR),
  'A',
  CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') - INTERVAL 1 HOUR,
  CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30') + INTERVAL 8 HOUR,
  0
FROM viva_courses c
WHERE c.course_code = 'CS101' AND c.inactive = 0
LIMIT 1
ON DUPLICATE KEY UPDATE
  room_id = VALUES(room_id),
  course_id = VALUES(course_id),
  section_id = VALUES(section_id),
  start_time = VALUES(start_time),
  end_time = VALUES(end_time),
  inactive = 0;

INSERT INTO ca_session_roster (session_id, student_id, inactive) VALUES
  ('CS101_A_PILOT', 'anayka', 0),
  ('CS101_A_PILOT', 'rahul', 0),
  ('CS101_A_PILOT', 'renuka', 0),
  ('CS101_A_PILOT', 'shivansh', 0)
ON DUPLICATE KEY UPDATE inactive = 0;

UPDATE ca_embedding_index_meta
SET version = CONCAT('seed-', DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'), '%Y%m%d%H%i%s'))
WHERE id = 1;

INSERT INTO ca_embedding_index_meta (id, version)
SELECT 1, CONCAT('seed-', DATE_FORMAT(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'), '%Y%m%d%H%i%s'))
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM ca_embedding_index_meta WHERE id = 1);
