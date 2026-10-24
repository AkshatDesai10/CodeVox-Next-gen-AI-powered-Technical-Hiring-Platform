INSERT INTO permissions (`key`, description, module, inactive) VALUES
('team-calendar:read', 'View manager team calendar on dashboard', 'team-calendar', 0)
ON DUPLICATE KEY UPDATE description = VALUES(description), module = VALUES(module), inactive = 0;

INSERT INTO role_permissions (roleId, permissionId, inactive, createdAt)
SELECT r.id, p.id, 0, NOW()
FROM roles r
JOIN permissions p ON p.`key` = 'team-calendar:read' AND p.inactive = 0
WHERE r.`key` IN ('admin', 'manager')
ON DUPLICATE KEY UPDATE inactive = 0;
