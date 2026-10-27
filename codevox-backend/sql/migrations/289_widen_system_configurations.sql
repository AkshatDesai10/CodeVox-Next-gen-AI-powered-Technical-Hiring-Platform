-- Align system_configurations column sizes with Recruitment schema.

ALTER TABLE system_configurations
  MODIFY COLUMN config_key VARCHAR(128) NOT NULL,
  MODIFY COLUMN updated_by VARCHAR(255) NULL;
