-- Stage 2: Consent & participant profile fields on ca_student_enrollment
-- Note: CREATE INDEX omitted — DB user may lack INDEX privilege; queries still work.

ALTER TABLE ca_student_enrollment
  ADD COLUMN participant_type VARCHAR(32) NOT NULL DEFAULT 'student' AFTER section_id,
  ADD COLUMN display_name VARCHAR(255) NULL AFTER participant_type,
  ADD COLUMN participant_status VARCHAR(32) NOT NULL DEFAULT 'active' AFTER display_name,
  ADD COLUMN consent_status VARCHAR(32) NOT NULL DEFAULT 'not_requested' AFTER participant_status,
  ADD COLUMN consent_recorded_at DATETIME(3) NULL AFTER consent_status,
  ADD COLUMN consent_recorded_by VARCHAR(128) NULL AFTER consent_recorded_at,
  ADD COLUMN consent_note VARCHAR(512) NULL AFTER consent_recorded_by,
  ADD COLUMN embedding_generated_at DATETIME(3) NULL AFTER quality_issue,
  ADD COLUMN embedding_model_version VARCHAR(64) NULL AFTER embedding_generated_at;

UPDATE ca_student_enrollment
SET status = 'needs_reenrollment'
WHERE quality_issue = 1 AND inactive = 0 AND status NOT IN ('needs_reenrollment', 'withdrawn');

UPDATE ca_student_enrollment
SET status = 'not_started'
WHERE inactive = 0 AND photo_count = 0 AND status = 'pending';
