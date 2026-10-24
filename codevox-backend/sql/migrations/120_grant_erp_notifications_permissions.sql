INSERT INTO permissions (`key`, `description`, `module`, `inactive`)
VALUES
  ('notifications:read', 'Read ERP notification settings and delivery logs', 'erp-billing', 0),
  ('notifications:write', 'Manage ERP notification settings', 'erp-billing', 0)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  module = VALUES(module),
  inactive = 0;

INSERT INTO role_permissions (roleId, permissionId, inactive, createdAt)
SELECT r.id, p.id, 0, NOW()
FROM roles r
INNER JOIN permissions p ON p.inactive = 0
WHERE r.inactive = 0
  AND r.`key` IN ('admin', 'finance')
  AND p.`key` IN ('notifications:read', 'notifications:write')
ON DUPLICATE KEY UPDATE inactive = 0;

INSERT INTO role_permissions (roleId, permissionId, inactive, createdAt)
SELECT r.id, p.id, 0, NOW()
FROM roles r
INNER JOIN permissions p ON p.inactive = 0
WHERE r.inactive = 0
  AND r.`key` IN ('admin', 'finance', 'sales')
  AND p.`key` = 'notifications:read'
ON DUPLICATE KEY UPDATE inactive = 0;
