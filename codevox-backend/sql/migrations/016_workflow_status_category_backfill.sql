-- Fix TypeORM synchronize error: ADD category NOT NULL fails when the table
-- already has rows (new column would be NULL). Run once against your DB, then restart the API.

ALTER TABLE project_workflow_statuses
  ADD COLUMN IF NOT EXISTS category varchar(24) DEFAULT 'todo';

UPDATE project_workflow_statuses
SET category = 'todo'
WHERE category IS NULL;

ALTER TABLE project_workflow_statuses
  ALTER COLUMN category SET DEFAULT 'todo';

ALTER TABLE project_workflow_statuses
  ALTER COLUMN category SET NOT NULL;
