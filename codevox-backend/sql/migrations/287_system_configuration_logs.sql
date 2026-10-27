-- Audit trail for system configuration changes (who changed what, when).

CREATE TABLE IF NOT EXISTS system_configuration_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  config_key VARCHAR(128) NOT NULL,
  old_value TEXT NULL,
  new_value TEXT NULL,
  changed_by VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_config_logs_created (created_at),
  KEY idx_config_logs_key_created (config_key, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
