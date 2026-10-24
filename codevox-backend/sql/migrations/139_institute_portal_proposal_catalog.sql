-- Institute portal: ERP admin permissions for proposal catalog oversight.

INSERT INTO permissions (`key`, `description`, `module`, `inactive`)
VALUES
  ('institute-portal-proposals:read', 'Read institute portal proposal catalog and submissions', 'erp-billing', 0),
  ('institute-portal-proposals:write', 'Manage institute portal proposal workflow from ERP', 'erp-billing', 0)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  module = VALUES(module),
  inactive = 0;

INSERT INTO role_permissions (roleId, permissionId, inactive, createdAt)
SELECT r.id, p.id, 0, NOW()
FROM roles r
INNER JOIN permissions p ON p.inactive = 0
WHERE r.inactive = 0
  AND r.`key` IN ('admin', 'finance', 'sales')
  AND p.`key` IN ('institute-portal-proposals:read', 'institute-portal-proposals:write')
ON DUPLICATE KEY UPDATE inactive = 0;
