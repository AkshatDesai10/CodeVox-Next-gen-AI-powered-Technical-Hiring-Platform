-- Candidate dashboard: interview language (default English) and one-time guidelines consent.

ALTER TABLE job_applications
  ADD COLUMN interview_language VARCHAR(8) NOT NULL DEFAULT 'en' AFTER reference_face_descriptor,
  ADD COLUMN guidelines_accepted_at DATETIME(3) NULL AFTER interview_language;
