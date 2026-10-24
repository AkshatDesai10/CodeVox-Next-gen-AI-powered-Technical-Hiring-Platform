-- Calibration CSV dry-run match status + AI snapshot fields
-- Extends ae_calibration_* from migration 234

ALTER TABLE ae_calibration_benchmark_rows
  ADD COLUMN match_status ENUM('matched','unmatched','conflicting','invalid') NOT NULL DEFAULT 'invalid'
    AFTER row_status,
  ADD COLUMN match_reason VARCHAR(512) NULL AFTER match_status,
  ADD COLUMN candidate_submission_ids JSON NULL AFTER match_reason,
  ADD COLUMN ai_marks DECIMAL(8,2) NULL AFTER candidate_submission_ids,
  ADD COLUMN ai_model VARCHAR(128) NULL AFTER ai_marks;

ALTER TABLE ae_calibration_import_batches
  ADD COLUMN matched_rows INT UNSIGNED NOT NULL DEFAULT 0 AFTER invalid_rows,
  ADD COLUMN unmatched_rows INT UNSIGNED NOT NULL DEFAULT 0 AFTER matched_rows,
  ADD COLUMN conflicting_rows INT UNSIGNED NOT NULL DEFAULT 0 AFTER unmatched_rows;

-- Backfill: schema-invalid rows stay invalid; schema-valid preview rows become unmatched until re-matched
UPDATE ae_calibration_benchmark_rows
SET match_status = CASE
  WHEN row_status = 'invalid' THEN 'invalid'
  WHEN submission_id IS NOT NULL THEN 'matched'
  ELSE 'unmatched'
END
WHERE match_status = 'invalid' OR match_status IS NULL;
