-- Optional uniqueness for Keycloak ADMNO stored in users.privId.
-- Safe to run multiple times: creates index only if missing.
-- Note: clean duplicate privId values before applying in production if any exist.

SET @idx_exists := (
  SELECT COUNT(1)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'users'
    AND index_name = 'uq_users_priv_id'
);

SET @sql := IF(
  @idx_exists = 0,
  'CREATE UNIQUE INDEX uq_users_priv_id ON users (privId)',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
