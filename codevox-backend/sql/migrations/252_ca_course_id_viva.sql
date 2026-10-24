-- Classroom CCTV: store viva_courses.id in timetable course_id and room linked_course_id.
-- Remap legacy course_code strings (e.g. CS101) to bigint ids. Avoid DELETE.

-- ---------------------------------------------------------------------------
-- Ensure pilot CA course codes exist (ids assigned by AUTO_INCREMENT)
-- ---------------------------------------------------------------------------
INSERT INTO viva_courses (course_code, title, syllabus_ref, inactive)
SELECT v.course_code, v.title, NULL, 0
FROM (
  SELECT 'CS101' AS course_code, 'Intro to Programming' AS title
  UNION ALL SELECT 'CS201', 'Data Structures'
  UNION ALL SELECT 'MATH101', 'Calculus I'
  UNION ALL SELECT 'PHY101', 'Physics I'
  UNION ALL SELECT 'ENG101', 'English Composition'
) v
WHERE NOT EXISTS (
  SELECT 1 FROM viva_courses c
  WHERE c.course_code COLLATE utf8mb4_unicode_ci = v.course_code COLLATE utf8mb4_unicode_ci
);

-- ---------------------------------------------------------------------------
-- Remap timetable course_id: course_code → viva_courses.id (skip already-numeric)
-- ---------------------------------------------------------------------------
UPDATE ca_timetable_sessions t
INNER JOIN viva_courses c
  ON c.course_code COLLATE utf8mb4_unicode_ci = t.course_id COLLATE utf8mb4_unicode_ci
 AND c.inactive = 0
SET t.course_id = CAST(c.id AS CHAR)
WHERE t.course_id NOT REGEXP '^[0-9]+$';

-- ---------------------------------------------------------------------------
-- Remap room linked_course_id the same way
-- ---------------------------------------------------------------------------
UPDATE ca_rooms r
INNER JOIN viva_courses c
  ON c.course_code COLLATE utf8mb4_unicode_ci = r.linked_course_id COLLATE utf8mb4_unicode_ci
 AND c.inactive = 0
SET r.linked_course_id = CAST(c.id AS CHAR)
WHERE r.linked_course_id IS NOT NULL
  AND r.linked_course_id <> ''
  AND r.linked_course_id NOT REGEXP '^[0-9]+$';

-- ---------------------------------------------------------------------------
-- Default room→course link from active timetable when still empty
-- ---------------------------------------------------------------------------
UPDATE ca_rooms r
INNER JOIN ca_timetable_sessions t
  ON t.room_id = r.room_id
 AND t.inactive = 0
 AND t.course_id REGEXP '^[0-9]+$'
SET
  r.linked_course_id = t.course_id,
  r.linked_section_id = COALESCE(NULLIF(r.linked_section_id, ''), t.section_id)
WHERE r.inactive = 0
  AND (r.linked_course_id IS NULL OR r.linked_course_id = '');
