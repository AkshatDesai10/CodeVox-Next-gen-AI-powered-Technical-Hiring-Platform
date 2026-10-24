-- Marks allocation: total + internal/external marks (not %) + rounding method.

ALTER TABLE vv_program_marks_policy
  ADD COLUMN total_marks DECIMAL(6,2) NOT NULL DEFAULT 100.00 AFTER external_weight_pct,
  ADD COLUMN internal_marks DECIMAL(6,2) NOT NULL DEFAULT 60.00 AFTER total_marks,
  ADD COLUMN external_marks DECIMAL(6,2) NOT NULL DEFAULT 40.00 AFTER internal_marks,
  ADD COLUMN rounding_method ENUM('nearest_whole', 'one_decimal') NOT NULL DEFAULT 'one_decimal' AFTER evaluator_mode;

ALTER TABLE vv_rubric_assignments
  ADD COLUMN total_marks DECIMAL(6,2) NULL AFTER external_weight_pct,
  ADD COLUMN internal_marks DECIMAL(6,2) NULL AFTER total_marks,
  ADD COLUMN external_marks DECIMAL(6,2) NULL AFTER internal_marks,
  ADD COLUMN rounding_method ENUM('nearest_whole', 'one_decimal') NULL AFTER evaluator_mode;

UPDATE vv_program_marks_policy
SET
  total_marks = 100.00,
  internal_marks = internal_weight_pct,
  external_marks = external_weight_pct,
  rounding_method = 'one_decimal'
WHERE total_marks = 100.00 AND internal_marks = 60.00;

UPDATE vv_rubric_assignments
SET
  total_marks = 100.00,
  internal_marks = internal_weight_pct,
  external_marks = external_weight_pct,
  rounding_method = 'one_decimal'
WHERE internal_weight_pct IS NOT NULL
  AND total_marks IS NULL;
