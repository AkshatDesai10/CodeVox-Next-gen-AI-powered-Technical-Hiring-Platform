-- Columns / enum values present on TypeORM entities but never added by a migration.
--   candidates: projects_summary, experience_summary, education_summary
--   candidate_autonomous_interviews: livekit_egress_id, recording_url, recording_started_at, current_phase += ai_screening
--   job_profile_competencies: stage_id
--   job_applications: status += completed
-- Idempotent: safe to re-run.

SET @db := DATABASE();

-- candidates.projects_summary
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE candidates ADD COLUMN projects_summary TEXT NULL AFTER skills',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidates' AND column_name = 'projects_summary'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- candidates.experience_summary
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE candidates ADD COLUMN experience_summary TEXT NULL AFTER projects_summary',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidates' AND column_name = 'experience_summary'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- candidates.education_summary
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE candidates ADD COLUMN education_summary TEXT NULL AFTER experience_summary',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidates' AND column_name = 'education_summary'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- candidate_autonomous_interviews.livekit_egress_id
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE candidate_autonomous_interviews ADD COLUMN livekit_egress_id VARCHAR(128) NULL AFTER livekit_room_name',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'livekit_egress_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- candidate_autonomous_interviews.recording_url
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE candidate_autonomous_interviews ADD COLUMN recording_url TEXT NULL AFTER livekit_egress_id',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'recording_url'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- candidate_autonomous_interviews.recording_started_at
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE candidate_autonomous_interviews ADD COLUMN recording_started_at TIMESTAMP NULL DEFAULT NULL AFTER recording_url',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'recording_started_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- job_profile_competencies.stage_id
SET @sql := (
  SELECT IF(COUNT(*) = 0,
    'ALTER TABLE job_profile_competencies ADD COLUMN stage_id VARCHAR(36) NULL AFTER job_profile_id',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'job_profile_competencies' AND column_name = 'stage_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Enum supersets (existing values kept, so existing rows stay valid).
ALTER TABLE candidate_autonomous_interviews
  MODIFY COLUMN current_phase
    ENUM('intro_verbal', 'sandbox_code', 'hr_verbal', 'closing', 'completed', 'ai_screening')
    NOT NULL DEFAULT 'intro_verbal';

ALTER TABLE job_applications
  MODIFY COLUMN status
    ENUM('applied', 'in_progress', 'completed', 'rejected', 'hired')
    NOT NULL DEFAULT 'applied';
