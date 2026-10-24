-- Multi-round autonomous interviews: per-round child table so merged videos and
-- transcripts are never overwritten when a candidate completes a later round.
-- Also moves screening / HR / stage1 audits and recording fields off the master.

CREATE TABLE IF NOT EXISTS autonomous_interview_rounds (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidate_token VARCHAR(64) NOT NULL,
  round_type ENUM(
    'ai_screening',
    'intro_verbal',
    'hr_verbal',
    'bnd_assessment',
    'bnd_interview'
  ) NOT NULL,
  livekit_room_name VARCHAR(128) NULL,
  chat_transcript JSON NULL,
  merged_recording_url TEXT NULL,
  ai_score TINYINT UNSIGNED NULL,
  status ENUM('in_progress', 'completed') NOT NULL DEFAULT 'in_progress',
  livekit_egress_id VARCHAR(128) NULL,
  recording_started_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_autonomous_interview_rounds_token_type (candidate_token, round_type),
  KEY idx_autonomous_interview_rounds_token (candidate_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backfill AI Screening rounds
INSERT INTO autonomous_interview_rounds (
  candidate_token, round_type, livekit_room_name, chat_transcript,
  merged_recording_url, status, livekit_egress_id, recording_started_at, created_at, updated_at
)
SELECT
  cai.candidate_token,
  'ai_screening',
  cai.livekit_room_name,
  cai.screening_voice_audit,
  CASE
    WHEN cai.screening_voice_audit IS NOT NULL THEN cai.recording_url
    ELSE NULL
  END,
  CASE
    WHEN cai.current_phase = 'completed' AND cai.screening_voice_audit IS NOT NULL THEN 'completed'
    ELSE 'in_progress'
  END,
  cai.livekit_egress_id,
  cai.recording_started_at,
  cai.created_at,
  cai.updated_at
FROM candidate_autonomous_interviews cai
WHERE cai.screening_voice_audit IS NOT NULL
ON DUPLICATE KEY UPDATE
  chat_transcript = COALESCE(VALUES(chat_transcript), chat_transcript),
  merged_recording_url = COALESCE(merged_recording_url, VALUES(merged_recording_url));

-- Backfill HR / behavioural rounds
INSERT INTO autonomous_interview_rounds (
  candidate_token, round_type, livekit_room_name, chat_transcript,
  merged_recording_url, ai_score, status, livekit_egress_id, recording_started_at, created_at, updated_at
)
SELECT
  cai.candidate_token,
  'hr_verbal',
  cai.livekit_room_name,
  cai.hr_voice_audit,
  CASE
    WHEN cai.hr_voice_audit IS NOT NULL AND cai.screening_voice_audit IS NULL THEN cai.recording_url
    ELSE NULL
  END,
  NULLIF(cai.stage1_voice_score, 0),
  CASE
    WHEN cai.current_phase = 'completed' AND cai.hr_voice_audit IS NOT NULL THEN 'completed'
    ELSE 'in_progress'
  END,
  cai.livekit_egress_id,
  cai.recording_started_at,
  cai.created_at,
  cai.updated_at
FROM candidate_autonomous_interviews cai
WHERE cai.hr_voice_audit IS NOT NULL
ON DUPLICATE KEY UPDATE
  chat_transcript = COALESCE(VALUES(chat_transcript), chat_transcript),
  merged_recording_url = COALESCE(merged_recording_url, VALUES(merged_recording_url));

-- Backfill technical intro rounds
INSERT INTO autonomous_interview_rounds (
  candidate_token, round_type, livekit_room_name, chat_transcript,
  merged_recording_url, ai_score, status, livekit_egress_id, recording_started_at, created_at, updated_at
)
SELECT
  cai.candidate_token,
  'intro_verbal',
  cai.livekit_room_name,
  cai.stage1_voice_audit,
  CASE
    WHEN cai.stage1_voice_audit IS NOT NULL
      AND cai.screening_voice_audit IS NULL
      AND cai.hr_voice_audit IS NULL
    THEN cai.recording_url
    ELSE NULL
  END,
  NULLIF(cai.stage1_voice_score, 0),
  CASE
    WHEN cai.current_phase = 'completed' AND cai.stage1_voice_audit IS NOT NULL THEN 'completed'
    ELSE 'in_progress'
  END,
  cai.livekit_egress_id,
  cai.recording_started_at,
  cai.created_at,
  cai.updated_at
FROM candidate_autonomous_interviews cai
WHERE cai.stage1_voice_audit IS NOT NULL
ON DUPLICATE KEY UPDATE
  chat_transcript = COALESCE(VALUES(chat_transcript), chat_transcript),
  merged_recording_url = COALESCE(merged_recording_url, VALUES(merged_recording_url));

-- Sessions that only have a recording and no audit still get a round row
INSERT INTO autonomous_interview_rounds (
  candidate_token, round_type, livekit_room_name, merged_recording_url,
  status, livekit_egress_id, recording_started_at, created_at, updated_at
)
SELECT
  cai.candidate_token,
  CASE
    WHEN cai.current_phase = 'ai_screening' THEN 'ai_screening'
    WHEN cai.current_phase = 'hr_verbal' THEN 'hr_verbal'
    ELSE 'intro_verbal'
  END,
  cai.livekit_room_name,
  cai.recording_url,
  CASE WHEN cai.current_phase = 'completed' THEN 'completed' ELSE 'in_progress' END,
  cai.livekit_egress_id,
  cai.recording_started_at,
  cai.created_at,
  cai.updated_at
FROM candidate_autonomous_interviews cai
WHERE cai.recording_url IS NOT NULL
  AND cai.screening_voice_audit IS NULL
  AND cai.hr_voice_audit IS NULL
  AND cai.stage1_voice_audit IS NULL
ON DUPLICATE KEY UPDATE
  merged_recording_url = COALESCE(merged_recording_url, VALUES(merged_recording_url));

-- Expand master phase enum for Build & Defend
ALTER TABLE candidate_autonomous_interviews
  MODIFY COLUMN current_phase ENUM(
    'intro_verbal',
    'sandbox_code',
    'hr_verbal',
    'closing',
    'completed',
    'ai_screening',
    'bnd_assessment',
    'bnd_interview'
  ) NOT NULL DEFAULT 'intro_verbal';

-- Drop moved columns from master (idempotent via information_schema checks)
SET @db := DATABASE();

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE candidate_autonomous_interviews DROP COLUMN screening_voice_audit',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'screening_voice_audit'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE candidate_autonomous_interviews DROP COLUMN hr_voice_audit',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'hr_voice_audit'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE candidate_autonomous_interviews DROP COLUMN stage1_voice_audit',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'stage1_voice_audit'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE candidate_autonomous_interviews DROP COLUMN recording_url',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'recording_url'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE candidate_autonomous_interviews DROP COLUMN livekit_egress_id',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'livekit_egress_id'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql := (
  SELECT IF(COUNT(*) > 0,
    'ALTER TABLE candidate_autonomous_interviews DROP COLUMN recording_started_at',
    'SELECT 1')
  FROM information_schema.columns
  WHERE table_schema = @db AND table_name = 'candidate_autonomous_interviews' AND column_name = 'recording_started_at'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
