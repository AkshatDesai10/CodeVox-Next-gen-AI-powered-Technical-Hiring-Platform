-- Refresh pilot timetable windows using IST wall-clock (+05:30).
-- CONVERT_TZ requires mysql.time_zone_name tables; fallback uses UTC+5:30 interval.

UPDATE ca_timetable_sessions
SET
  start_time = COALESCE(
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'),
    UTC_TIMESTAMP() + INTERVAL 5 HOUR + INTERVAL 30 MINUTE
  ) - INTERVAL 2 HOUR,
  end_time = COALESCE(
    CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', '+05:30'),
    UTC_TIMESTAMP() + INTERVAL 5 HOUR + INTERVAL 30 MINUTE
  ) + INTERVAL 24 HOUR,
  inactive = 0
WHERE session_id IN (
  'CS101_A_PILOT',
  'CS201_B_PILOT',
  'MATH101_A_PILOT',
  'PHY101_A_PILOT',
  'ENG101_A_PILOT'
);
