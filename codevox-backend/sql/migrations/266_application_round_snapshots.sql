-- Frozen round labels per candidate attempt for assessment reports.
-- stage_name / stage_type are set once at first upsert and not overwritten by later profile edits.

CREATE TABLE IF NOT EXISTS application_round_snapshots (
  id BIGINT UNSIGNED NOT NULL,
  job_application_id BIGINT UNSIGNED NOT NULL,
  stage_id BIGINT UNSIGNED NULL,
  stage_key VARCHAR(64) NULL,
  stage_type VARCHAR(64) NOT NULL,
  stage_name VARCHAR(120) NOT NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  source_table VARCHAR(64) NOT NULL,
  source_id VARCHAR(64) NOT NULL,
  score_pct DECIMAL(5, 2) NULL,
  status VARCHAR(32) NULL,
  attempted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_round_source (job_application_id, source_table, source_id),
  KEY idx_app_round_app (job_application_id, inactive),
  KEY idx_app_round_stage (stage_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
