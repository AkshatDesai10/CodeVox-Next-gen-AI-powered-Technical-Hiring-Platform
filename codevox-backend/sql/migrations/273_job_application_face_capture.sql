-- Portal identity gate: consent + face photo before rounds can start.

ALTER TABLE job_applications
  ADD COLUMN face_consent_recorded_at DATETIME(3) NULL AFTER source,
  ADD COLUMN face_captured_at DATETIME(3) NULL AFTER face_consent_recorded_at,
  ADD COLUMN face_photo_storage_key VARCHAR(512) NULL AFTER face_captured_at,
  ADD COLUMN face_photo_url VARCHAR(1024) NULL AFTER face_photo_storage_key,
  ADD COLUMN reference_face_descriptor JSON NULL AFTER face_photo_url;
