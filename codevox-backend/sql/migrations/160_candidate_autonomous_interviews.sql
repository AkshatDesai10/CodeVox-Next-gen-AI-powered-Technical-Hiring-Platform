-- Autonomous multi-stage interview phase ledger (intro_verbal → sandbox_code → hr_verbal → completed)
CREATE TABLE IF NOT EXISTS candidate_autonomous_interviews (
  candidate_token VARCHAR(64) NOT NULL,
  current_phase ENUM('intro_verbal', 'sandbox_code', 'hr_verbal', 'completed') NOT NULL DEFAULT 'intro_verbal',
  stage1_chat_history JSON NULL,
  stage3_chat_history JSON NULL,
  stage1_voice_score TINYINT UNSIGNED NOT NULL DEFAULT 0,
  submitted_code TEXT NULL,
  code_quality_score TINYINT UNSIGNED NULL,
  architectural_flaws JSON NULL,
  final_decision ENUM('AUTO_REJECT', 'AUTO_PASS_TO_OFFER', 'UNDER_REVIEW') NOT NULL DEFAULT 'UNDER_REVIEW',
  livekit_room_name VARCHAR(128) NULL,
  candidate_assessment_id BIGINT UNSIGNED NULL,
  tech_stack VARCHAR(100) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  inactive TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (candidate_token),
  INDEX idx_cai_phase (current_phase),
  INDEX idx_cai_attempt (candidate_assessment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
