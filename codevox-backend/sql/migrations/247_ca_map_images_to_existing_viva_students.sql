-- Remap CA pilot face keys to existing vv_students; soft-remove wrongly inserted PILOT students.
-- Image folders (anayka/rahul/renuka/shivansh) map to enrollment_ids below (must already exist).

-- Mapping: slug -> existing enrollment_id
-- anayka    -> ENR2025001
-- rahul     -> ENR2025002
-- renuka    -> ENR2025003
-- shivansh  -> ENR2025004

-- Soft-inactivate CA rows that still point at PILOT viva ids (avoid unique conflicts on remap)
UPDATE ca_session_roster r
INNER JOIN vv_students v ON v.id = r.student_id
SET r.inactive = 1
WHERE v.batch COLLATE utf8mb4_unicode_ci = 'PILOT' COLLATE utf8mb4_unicode_ci
   OR v.enrollment_id COLLATE utf8mb4_unicode_ci IN (
     'anayka' COLLATE utf8mb4_unicode_ci,
     'rahul' COLLATE utf8mb4_unicode_ci,
     'renuka' COLLATE utf8mb4_unicode_ci,
     'shivansh' COLLATE utf8mb4_unicode_ci
   );

UPDATE ca_face_embeddings e
INNER JOIN vv_students v ON v.id = e.student_id
SET e.inactive = 1
WHERE v.batch COLLATE utf8mb4_unicode_ci = 'PILOT' COLLATE utf8mb4_unicode_ci
   OR v.enrollment_id COLLATE utf8mb4_unicode_ci IN (
     'anayka' COLLATE utf8mb4_unicode_ci,
     'rahul' COLLATE utf8mb4_unicode_ci,
     'renuka' COLLATE utf8mb4_unicode_ci,
     'shivansh' COLLATE utf8mb4_unicode_ci
   );

UPDATE ca_student_enrollment e
INNER JOIN vv_students v ON v.id = e.student_id
SET e.inactive = 1
WHERE v.batch COLLATE utf8mb4_unicode_ci = 'PILOT' COLLATE utf8mb4_unicode_ci
   OR v.enrollment_id COLLATE utf8mb4_unicode_ci IN (
     'anayka' COLLATE utf8mb4_unicode_ci,
     'rahul' COLLATE utf8mb4_unicode_ci,
     'renuka' COLLATE utf8mb4_unicode_ci,
     'shivansh' COLLATE utf8mb4_unicode_ci
   );

UPDATE ca_enrollment_photos e
INNER JOIN vv_students v ON v.id = e.student_id
SET e.inactive = 1
WHERE v.batch COLLATE utf8mb4_unicode_ci = 'PILOT' COLLATE utf8mb4_unicode_ci
   OR v.enrollment_id COLLATE utf8mb4_unicode_ci IN (
     'anayka' COLLATE utf8mb4_unicode_ci,
     'rahul' COLLATE utf8mb4_unicode_ci,
     'renuka' COLLATE utf8mb4_unicode_ci,
     'shivansh' COLLATE utf8mb4_unicode_ci
   );

UPDATE ca_attendance_events e
INNER JOIN vv_students v ON v.id = e.student_id
SET e.inactive = 1
WHERE v.batch COLLATE utf8mb4_unicode_ci = 'PILOT' COLLATE utf8mb4_unicode_ci
   OR v.enrollment_id COLLATE utf8mb4_unicode_ci IN (
     'anayka' COLLATE utf8mb4_unicode_ci,
     'rahul' COLLATE utf8mb4_unicode_ci,
     'renuka' COLLATE utf8mb4_unicode_ci,
     'shivansh' COLLATE utf8mb4_unicode_ci
   );

UPDATE ca_attendance_overrides e
INNER JOIN vv_students v ON v.id = e.student_id
SET e.inactive = 1
WHERE v.batch COLLATE utf8mb4_unicode_ci = 'PILOT' COLLATE utf8mb4_unicode_ci
   OR v.enrollment_id COLLATE utf8mb4_unicode_ci IN (
     'anayka' COLLATE utf8mb4_unicode_ci,
     'rahul' COLLATE utf8mb4_unicode_ci,
     'renuka' COLLATE utf8mb4_unicode_ci,
     'shivansh' COLLATE utf8mb4_unicode_ci
   );

-- Soft-remove wrongly inserted viva students (do not hard DELETE)
UPDATE vv_students
SET inactive = 1
WHERE batch COLLATE utf8mb4_unicode_ci = 'PILOT' COLLATE utf8mb4_unicode_ci
   OR enrollment_id COLLATE utf8mb4_unicode_ci IN (
     'anayka' COLLATE utf8mb4_unicode_ci,
     'rahul' COLLATE utf8mb4_unicode_ci,
     'renuka' COLLATE utf8mb4_unicode_ci,
     'shivansh' COLLATE utf8mb4_unicode_ci
   );

-- Seed roster + enrollment for existing students only
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
