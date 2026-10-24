-- Migration 278: Drop Legacy CCTV, ERP Notifications, Academic Viva, and Calibration tables

SET FOREIGN_KEY_CHECKS = 0;

-- 1. Classroom CCTV & Physical Camera Tables (ca_*)
DROP TABLE IF EXISTS `ca_attendance_events`;
DROP TABLE IF EXISTS `ca_attendance_overrides`;
DROP TABLE IF EXISTS `ca_attendance_sessions`;
DROP TABLE IF EXISTS `ca_audit_events`;
DROP TABLE IF EXISTS `ca_camera_discovery`;
DROP TABLE IF EXISTS `ca_cameras`;
DROP TABLE IF EXISTS `ca_edge_api_keys`;
DROP TABLE IF EXISTS `ca_edge_devices`;
DROP TABLE IF EXISTS `ca_embedding_index_meta`;
DROP TABLE IF EXISTS `ca_enrollment_photos`;
DROP TABLE IF EXISTS `ca_face_embeddings`;
DROP TABLE IF EXISTS `ca_room_health_events`;
DROP TABLE IF EXISTS `ca_rooms`;
DROP TABLE IF EXISTS `ca_runtime_profiles`;
DROP TABLE IF EXISTS `ca_session_roster`;
DROP TABLE IF EXISTS `ca_student_enrollment`;
DROP TABLE IF EXISTS `ca_system_config`;
DROP TABLE IF EXISTS `ca_timetable_sessions`;
DROP TABLE IF EXISTS `ca_unmatched_faces`;
DROP TABLE IF EXISTS `ca_worker_diagnostics`;
DROP TABLE IF EXISTS `ca_workers`;

-- 2. ERP & Institute Notification Tables (erp_*, institute_*)
DROP TABLE IF EXISTS `erp_notification_category_settings`;
DROP TABLE IF EXISTS `erp_notification_deliveries`;
DROP TABLE IF EXISTS `erp_notification_events`;
DROP TABLE IF EXISTS `erp_notification_global_settings`;
DROP TABLE IF EXISTS `erp_staff_notifications`;
DROP TABLE IF EXISTS `institute_notifications`;

-- 3. Remaining Academic Viva Tables
DROP TABLE IF EXISTS `student_viva_sessions`;
DROP TABLE IF EXISTS `viva_courses`;
DROP TABLE IF EXISTS `viva_global_config`;
DROP TABLE IF EXISTS `viva_proctor_events`;
DROP TABLE IF EXISTS `viva_questions`;

-- 4. Calibration & Benchmark Tables (ae_*)
DROP TABLE IF EXISTS `ae_calibration_actions`;
DROP TABLE IF EXISTS `ae_calibration_benchmark_rows`;
DROP TABLE IF EXISTS `ae_calibration_import_batches`;
DROP TABLE IF EXISTS `ae_calibration_run_questions`;
DROP TABLE IF EXISTS `ae_calibration_runs`;

-- 5. Currency Rate Cards (cost_*)
DROP TABLE IF EXISTS `cost_fx_rates`;
DROP TABLE IF EXISTS `cost_rate_cards`;

SET FOREIGN_KEY_CHECKS = 1;
