-- Permission catalog (replaces static ROUTE_PERMISSIONS in code).
-- Apply 047_permissions_catalog.sql then 047_permissions_seed.sql

CREATE TABLE IF NOT EXISTS permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(128) NOT NULL,
  description VARCHAR(512) NOT NULL,
  module VARCHAR(64) NOT NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_permissions_key (`key`),
  KEY idx_permissions_module (module, inactive)
);
