-- CodeVox Cleanup: Drop decommissioned Take-Home and Academic Viva/ERP tables

-- 1. Take-Home Submissions & Evaluation Runs
DROP TABLE IF EXISTS `take_home_eval_runs`;
DROP TABLE IF EXISTS `take_home_submissions`;

-- 2. Academic Viva ERP & Panel Tables
DROP TABLE IF EXISTS `viva_moderation_cases`;
DROP TABLE IF EXISTS `viva_moderations`;
DROP TABLE IF EXISTS `viva_evaluations`;
DROP TABLE IF EXISTS `viva_panel_allocations`;
DROP TABLE IF EXISTS `viva_panel_faculty_mappings`;
DROP TABLE IF EXISTS `viva_panels`;
DROP TABLE IF EXISTS `viva_attendance`;
DROP TABLE IF EXISTS `viva_integrity_scans`;
DROP TABLE IF EXISTS `viva_resubmissions`;
DROP TABLE IF EXISTS `viva_marks_allocations`;
DROP TABLE IF EXISTS `viva_students`;
DROP TABLE IF EXISTS `viva_rubrics`;
DROP TABLE IF EXISTS `viva_threshold_configs`;
