-- Backfill only (columns already added)
UPDATE ca_student_enrollment
SET status = 'needs_reenrollment'
WHERE quality_issue = 1 AND inactive = 0 AND status NOT IN ('needs_reenrollment', 'withdrawn');

UPDATE ca_student_enrollment
SET status = 'not_started'
WHERE inactive = 0 AND photo_count = 0 AND status = 'pending';
