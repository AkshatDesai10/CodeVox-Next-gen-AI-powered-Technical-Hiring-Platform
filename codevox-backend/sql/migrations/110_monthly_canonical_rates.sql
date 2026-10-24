-- Monthly rates are canonical; backfill monthly columns and add bundle scale overrides.

UPDATE pricing_configs
SET student_rate_monthly = ROUND(student_rate / 12, 2)
WHERE student_rate_monthly IS NULL;

UPDATE pricing_configs
SET faculty_rate_monthly = ROUND(faculty_rate / 12, 2)
WHERE faculty_rate_monthly IS NULL;

UPDATE pricing_configs
SET module_rate_monthly = ROUND(module_rate / 12, 2)
WHERE module_rate_monthly IS NULL;

UPDATE erp_bundles
SET bundled_rate_monthly = ROUND(bundled_rate / 12, 2)
WHERE bundled_rate_monthly IS NULL;

SET @bundle_student_monthly := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'erp_bundles'
    AND COLUMN_NAME = 'student_rate_monthly'
);
SET @sql_bundle_student_monthly := IF(
  @bundle_student_monthly = 0,
  'ALTER TABLE erp_bundles ADD COLUMN student_rate_monthly DECIMAL(12,2) NULL AFTER student_rate',
  'SELECT 1'
);
PREPARE stmt FROM @sql_bundle_student_monthly;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @bundle_faculty_monthly := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'erp_bundles'
    AND COLUMN_NAME = 'faculty_rate_monthly'
);
SET @sql_bundle_faculty_monthly := IF(
  @bundle_faculty_monthly = 0,
  'ALTER TABLE erp_bundles ADD COLUMN faculty_rate_monthly DECIMAL(12,2) NULL AFTER faculty_rate',
  'SELECT 1'
);
PREPARE stmt FROM @sql_bundle_faculty_monthly;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE erp_bundles
SET student_rate_monthly = ROUND(student_rate / 12, 2)
WHERE student_rate IS NOT NULL AND student_rate_monthly IS NULL;

UPDATE erp_bundles
SET faculty_rate_monthly = ROUND(faculty_rate / 12, 2)
WHERE faculty_rate IS NOT NULL AND faculty_rate_monthly IS NULL;

UPDATE erp_bundles
SET student_rate = ROUND(student_rate_monthly * 12, 2)
WHERE student_rate_monthly IS NOT NULL;

UPDATE erp_bundles
SET faculty_rate = ROUND(faculty_rate_monthly * 12, 2)
WHERE faculty_rate_monthly IS NOT NULL;

UPDATE erp_bundles
SET bundled_rate = ROUND(bundled_rate_monthly * 12, 2)
WHERE bundled_rate_monthly IS NOT NULL;

UPDATE pricing_configs
SET student_rate = ROUND(student_rate_monthly * 12, 2)
WHERE student_rate_monthly IS NOT NULL;

UPDATE pricing_configs
SET faculty_rate = ROUND(faculty_rate_monthly * 12, 2)
WHERE faculty_rate_monthly IS NOT NULL;

UPDATE pricing_configs
SET module_rate = ROUND(module_rate_monthly * 12, 2)
WHERE module_rate_monthly IS NOT NULL;
