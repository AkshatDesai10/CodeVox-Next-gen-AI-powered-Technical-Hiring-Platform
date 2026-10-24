-- Local bootstrap: shared RBAC tables (users / roles / permissions) not owned by CodeVox entities.

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NULL,
  keycloakId VARCHAR(128) NULL,
  userType VARCHAR(64) NULL DEFAULT 'staff',
  branchId VARCHAR(64) NULL,
  clientIds JSON NULL,
  privId VARCHAR(128) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_priv_id (privId),
  KEY idx_users_keycloak (keycloakId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `key` VARCHAR(64) NOT NULL,
  name VARCHAR(128) NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_roles_key (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_roles (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  userId VARCHAR(64) NOT NULL,
  roleId BIGINT UNSIGNED NOT NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_user_roles_user (userId),
  KEY idx_user_roles_role (roleId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  roleId BIGINT UNSIGNED NOT NULL,
  permissionId BIGINT UNSIGNED NOT NULL,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  createdAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_role_permission (roleId, permissionId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO roles (`key`, name, inactive)
SELECT 'admin', 'Admin', 0
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE `key` = 'admin');

INSERT INTO permissions (`key`, description, module, inactive) VALUES
  ('assessments:read', 'Read assessments', 'assessments', 0),
  ('assessments:write', 'Write assessments', 'assessments', 0),
  ('job_profiles:read', 'Read job profiles', 'job_profiles', 0),
  ('job_profiles:write', 'Write job profiles', 'job_profiles', 0)
ON DUPLICATE KEY UPDATE description = VALUES(description);

INSERT INTO role_permissions (roleId, permissionId, inactive)
SELECT r.id, p.id, 0
FROM roles r
CROSS JOIN permissions p
WHERE r.`key` = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.roleId = r.id AND rp.permissionId = p.id AND rp.inactive = 0
  );
