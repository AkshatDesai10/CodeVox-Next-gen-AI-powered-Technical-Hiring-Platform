-- Jira configuration catalog tables (Phase 1 export)
-- Apply manually via psql.

-- Per-project raw payload (GET /rest/api/2/project/{key})
CREATE TABLE IF NOT EXISTS jira_projects_raw (
  "projectKey" varchar(32) PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}',
  createdat timestamptz NOT NULL DEFAULT now(),
  updatedat timestamptz NOT NULL DEFAULT now()
);

-- Screens (GET /rest/api/2/screens)
CREATE TABLE IF NOT EXISTS jira_screens (
  "jiraScreenId" int PRIMARY KEY,
  name varchar(255) NULL,
  description text NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  createdat timestamptz NOT NULL DEFAULT now(),
  updatedat timestamptz NOT NULL DEFAULT now()
);

-- Screen schemes (GET /rest/api/2/screenscheme)
CREATE TABLE IF NOT EXISTS jira_screen_schemes (
  "jiraScreenSchemeId" int PRIMARY KEY,
  name varchar(255) NULL,
  description text NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  createdat timestamptz NOT NULL DEFAULT now(),
  updatedat timestamptz NOT NULL DEFAULT now()
);

-- Issue type screen schemes (GET /rest/api/2/issuetypescreenscheme)
CREATE TABLE IF NOT EXISTS jira_issue_type_screen_schemes (
  "jiraIssueTypeScreenSchemeId" int PRIMARY KEY,
  name varchar(255) NULL,
  description text NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  createdat timestamptz NOT NULL DEFAULT now(),
  updatedat timestamptz NOT NULL DEFAULT now()
);

-- Workflows (GET /rest/api/2/workflow)
CREATE TABLE IF NOT EXISTS jira_workflows (
  name varchar(255) PRIMARY KEY,
  payload jsonb NOT NULL DEFAULT '{}',
  createdat timestamptz NOT NULL DEFAULT now(),
  updatedat timestamptz NOT NULL DEFAULT now()
);

-- Workflow schemes (GET /rest/api/2/workflowscheme)
CREATE TABLE IF NOT EXISTS jira_workflow_schemes (
  "jiraWorkflowSchemeId" int PRIMARY KEY,
  name varchar(255) NULL,
  description text NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  createdat timestamptz NOT NULL DEFAULT now(),
  updatedat timestamptz NOT NULL DEFAULT now()
);

-- Permission schemes (GET /rest/api/2/permissionscheme)
CREATE TABLE IF NOT EXISTS jira_permission_schemes (
  "jiraPermissionSchemeId" int PRIMARY KEY,
  name varchar(255) NULL,
  description text NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  createdat timestamptz NOT NULL DEFAULT now(),
  updatedat timestamptz NOT NULL DEFAULT now()
);

-- Notification schemes (GET /rest/api/2/notificationscheme)
CREATE TABLE IF NOT EXISTS jira_notification_schemes (
  "jiraNotificationSchemeId" int PRIMARY KEY,
  name varchar(255) NULL,
  description text NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  createdat timestamptz NOT NULL DEFAULT now(),
  updatedat timestamptz NOT NULL DEFAULT now()
);

