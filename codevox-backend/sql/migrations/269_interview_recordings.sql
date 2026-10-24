-- One row per LiveKit egress, so a session can hold multiple recordings (rejoin / later round).
-- candidate_autonomous_interviews.recording_url / livekit_egress_id keep mirroring the latest row.

CREATE TABLE IF NOT EXISTS interview_recordings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  candidate_token VARCHAR(128) NOT NULL,
  portal_token VARCHAR(128) NULL,
  stage_id VARCHAR(64) NULL,
  engine VARCHAR(32) NULL,
  egress_id VARCHAR(128) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  recording_url TEXT NOT NULL,
  status ENUM('recording', 'completed', 'failed') NOT NULL DEFAULT 'recording',
  started_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_interview_recordings_egress (egress_id),
  KEY idx_interview_recordings_token (candidate_token),
  KEY idx_interview_recordings_portal (portal_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
