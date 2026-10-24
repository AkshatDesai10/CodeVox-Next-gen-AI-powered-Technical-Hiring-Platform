-- Viva ERP plagiarism and AI content integrity scans.

CREATE TABLE IF NOT EXISTS viva_integrity_scans (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  report_id VARCHAR(36) NOT NULL,
  student_id VARCHAR(36) NOT NULL,
  plagiarism_pct DECIMAL(5,2) NULL,
  ai_content_pct DECIMAL(5,2) NULL,
  threshold_pct DECIMAL(5,2) NOT NULL DEFAULT 12,
  program_level ENUM('ug', 'pg', 'phd') NOT NULL DEFAULT 'pg',
  pass_status ENUM('pending', 'pass', 'fail') NOT NULL DEFAULT 'pending',
  matched_excerpts_json JSON NULL,
  scan_log TEXT NULL,
  report_pdf_path TEXT NULL,
  is_resubmission TINYINT UNSIGNED NOT NULL DEFAULT 0,
  parent_scan_id VARCHAR(36) NULL,
  scanned_at TIMESTAMP NULL,
  inactive TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_viva_integrity_student (student_id),
  INDEX idx_viva_integrity_report (report_id),
  INDEX idx_viva_integrity_status (pass_status)
);
