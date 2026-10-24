-- Rooms must not own a permanent course/section link.
-- Course/section ↔ room is time-bound via ca_timetable_sessions only.

ALTER TABLE ca_rooms
  DROP COLUMN linked_course_id,
  DROP COLUMN linked_section_id;
