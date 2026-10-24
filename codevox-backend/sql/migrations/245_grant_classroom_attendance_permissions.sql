-- Classroom attendance admin permission.

INSERT INTO permissions (`key`, `description`, `module`, `inactive`)
VALUES
  ('classroom-attendance:admin', 'Manage classroom CCTV attendance dashboard', 'classroom-attendance', 0)
ON DUPLICATE KEY UPDATE
  description = VALUES(description),
  module = VALUES(module),
  inactive = 0;

INSERT INTO role_permissions (roleId, permissionId, inactive, createdAt)
SELECT r.id, p.id, 0, NOW()
FROM roles r
INNER JOIN permissions p ON p.inactive = 0
WHERE r.inactive = 0
  AND r.`key` IN ('admin', 'developer')
  AND p.`key` = 'classroom-attendance:admin'
ON DUPLICATE KEY UPDATE inactive = 0;
