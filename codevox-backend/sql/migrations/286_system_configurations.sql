-- Runtime system configurations (admin dashboard overrides .env with safe fallback).

CREATE TABLE IF NOT EXISTS system_configurations (
  config_key VARCHAR(64) NOT NULL,
  config_value TEXT NULL,
  updated_by VARCHAR(64) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
