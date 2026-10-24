-- Cost ledger, versioned rate cards, and dated USD→INR rates.
-- Service names are shared by cost_rate_cards and assessment_usage_ledger.
-- Closed rows store snapshot_cost_inr so later rate or FX edits do not rewrite history.
-- S3 v1 prices upload bytes as a 30-day storage estimate, not ongoing GB-month accrual.

SET @db := DATABASE();

CREATE TABLE IF NOT EXISTS cost_rate_cards (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  provider VARCHAR(32) NOT NULL,
  service_type VARCHAR(32) NOT NULL,
  model_or_resource VARCHAR(64) NOT NULL,
  unit VARCHAR(32) NOT NULL,
  vendor_currency VARCHAR(3) NOT NULL,
  unit_price DECIMAL(20, 12) NOT NULL,
  effective_from TIMESTAMP NOT NULL,
  effective_to TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_rate_lookup (service_type, model_or_resource, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS cost_fx_rates (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  quote_currency VARCHAR(3) NOT NULL,
  base_currency VARCHAR(3) NOT NULL DEFAULT 'INR',
  rate_to_inr DECIMAL(10, 4) NOT NULL,
  effective_from TIMESTAMP NOT NULL,
  effective_to TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY idx_fx_lookup (quote_currency, effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS assessment_usage_ledger (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  idempotency_key VARCHAR(255) NOT NULL,
  scope ENUM('candidate_runtime', 'platform_overhead') NOT NULL DEFAULT 'candidate_runtime',
  application_id VARCHAR(64) NULL,
  job_profile_id VARCHAR(64) NULL,
  stage_id VARCHAR(64) NULL,
  session_token VARCHAR(128) NULL,
  candidate_token VARCHAR(64) NULL,
  instance_id VARCHAR(64) NULL,
  operation VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  service_type VARCHAR(32) NOT NULL,
  resource_name VARCHAR(64) NOT NULL,
  quantity_units BIGINT UNSIGNED NOT NULL,
  unit VARCHAR(32) NOT NULL,
  rate_card_id VARCHAR(64) NULL,
  vendor_currency VARCHAR(3) NOT NULL,
  snapshot_unit_price DECIMAL(20, 12) NULL,
  snapshot_cost_vendor_currency DECIMAL(14, 4) NULL,
  fx_rate_to_inr DECIMAL(10, 4) NULL,
  snapshot_cost_inr DECIMAL(14, 4) NULL,
  status ENUM('running', 'completed', 'failed') NOT NULL DEFAULT 'completed',
  terminated_by VARCHAR(32) NULL,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_ledger_idempotency (idempotency_key),
  KEY idx_ledger_status_started (status, started_at),
  KEY idx_ledger_started_service (started_at, service_type),
  KEY idx_ledger_profile_stage_started (job_profile_id, stage_id, started_at),
  KEY idx_ledger_application (application_id),
  KEY idx_ledger_session (session_token),
  KEY idx_ledger_scope_started (scope, started_at),
  KEY idx_ledger_instance (instance_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- Match job_profile_ai_logs (server default is utf8mb4_0900_ai_ci).
ALTER TABLE cost_rate_cards CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE cost_fx_rates CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
ALTER TABLE assessment_usage_ledger CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

INSERT INTO cost_fx_rates (quote_currency, base_currency, rate_to_inr, effective_from)
SELECT 'USD', 'INR', 94.8900, '2026-01-01 00:00:00'
WHERE NOT EXISTS (
  SELECT 1 FROM cost_fx_rates WHERE quote_currency = 'USD' AND effective_to IS NULL
);

-- Starter cards. Replace unit_price when a vendor invoice differs.
INSERT INTO cost_rate_cards (id, provider, service_type, model_or_resource, unit, vendor_currency, unit_price, effective_from)
SELECT * FROM (
  SELECT 'gemini-3.8-flash-in-2026' AS id, 'google' AS provider, 'llm_input' AS service_type, 'gemini-3.8-flash' AS model_or_resource, 'tokens' AS unit, 'USD' AS vendor_currency, 0.000000750000 AS unit_price, '2026-01-01 00:00:00' AS effective_from
  UNION ALL SELECT 'gemini-3.8-flash-out-2026', 'google', 'llm_output', 'gemini-3.8-flash', 'tokens', 'USD', 0.000003750000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'gemini-3.6-flash-in-2026', 'google', 'llm_input', 'gemini-3.6-flash', 'tokens', 'USD', 0.000000100000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'gemini-3.6-flash-out-2026', 'google', 'llm_output', 'gemini-3.6-flash', 'tokens', 'USD', 0.000000400000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'claude-sonnet-4-6-in-2026', 'anthropic', 'llm_input', 'claude-sonnet-4-6', 'tokens', 'USD', 0.000003000000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'claude-sonnet-4-6-out-2026', 'anthropic', 'llm_output', 'claude-sonnet-4-6', 'tokens', 'USD', 0.000015000000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'sarvam-30b-in-2026', 'sarvam', 'voice_llm_input', 'sarvam-30b', 'tokens', 'INR', 0.000020000000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'sarvam-30b-out-2026', 'sarvam', 'voice_llm_output', 'sarvam-30b', 'tokens', 'INR', 0.000080000000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'sarvam-105b-in-2026', 'sarvam', 'voice_llm_input', 'sarvam-105b-conversations', 'tokens', 'INR', 0.000040000000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'sarvam-105b-out-2026', 'sarvam', 'voice_llm_output', 'sarvam-105b-conversations', 'tokens', 'INR', 0.000160000000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'saaras-v3-2026', 'sarvam', 'voice_stt', 'saaras:v3', 'seconds', 'INR', 0.008333333333, '2026-01-01 00:00:00'
  UNION ALL SELECT 'bulbul-v3-2026', 'sarvam', 'voice_tts', 'bulbul:v3', 'characters', 'INR', 0.003000000000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'qwen-free-in-2026', 'groq', 'llm_input', 'qwen', 'tokens', 'INR', 0.000000000000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'qwen-free-out-2026', 'groq', 'llm_output', 'qwen', 'tokens', 'INR', 0.000000000000, '2026-01-01 00:00:00'
  UNION ALL SELECT 'ec2-t3-micro-2026', 'aws', 'ec2_sandbox', 't3.micro', 'seconds', 'USD', 0.000002888889, '2026-01-01 00:00:00'
  UNION ALL SELECT 'ec2-t3-small-2026', 'aws', 'ec2_sandbox', 't3.small', 'seconds', 'USD', 0.000005777778, '2026-01-01 00:00:00'
  UNION ALL SELECT 'ec2-t3-medium-2026', 'aws', 'ec2_sandbox', 't3.medium', 'seconds', 'USD', 0.000011555556, '2026-01-01 00:00:00'
  UNION ALL SELECT 'ec2-c5-large-2026', 'aws', 'ec2_sandbox', 'c5.large', 'seconds', 'USD', 0.000023611111, '2026-01-01 00:00:00'
  UNION ALL SELECT 'ebs-gp3-2026', 'aws', 'ec2_ebs', 'gp3', 'gb_seconds', 'USD', 0.000000035185, '2026-01-01 00:00:00'
  UNION ALL SELECT 's3-standard-30d-2026', 'aws', 's3_storage', 's3-standard-30d', 'bytes', 'USD', 0.000000000025, '2026-01-01 00:00:00'
  UNION ALL SELECT 'livekit-egress-2026', 'livekit', 'livekit_egress', 'room-composite', 'seconds', 'USD', 0.000333333333, '2026-01-01 00:00:00'
  UNION ALL SELECT 'deepflag-text-2026', 'deepflag', 'deepflag', 'detect-text', 'calls', 'INR', 1.000000000000, '2026-01-01 00:00:00'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM cost_rate_cards c WHERE c.id = seed.id);

-- Historical LLM rows. Skip logs with no model or no token counts.
-- application_id stays NULL; percentile queries must ignore those rows.
INSERT INTO assessment_usage_ledger (
  idempotency_key, scope, job_profile_id, operation, provider, service_type, resource_name,
  quantity_units, unit, rate_card_id, vendor_currency, snapshot_unit_price,
  snapshot_cost_vendor_currency, fx_rate_to_inr, snapshot_cost_inr,
  status, terminated_by, started_at, ended_at
)
SELECT
  CONCAT('ai_log:', l.id, ':', side.kind),
  CASE
    WHEN LOWER(l.operation) REGEXP 'question|template|quality|draft|competenc|rubric|jd_'
      THEN 'platform_overhead'
    ELSE 'candidate_runtime'
  END,
  CAST(l.job_profile_id AS CHAR),
  l.operation,
  CASE
    WHEN l.model LIKE 'gemini%' OR l.model LIKE 'google%' THEN 'google'
    WHEN l.model LIKE 'claude%' OR l.model LIKE 'anthropic%' THEN 'anthropic'
    WHEN l.model LIKE 'sarvam%' THEN 'sarvam'
    WHEN l.model LIKE 'qwen%' OR l.model LIKE 'groq%' THEN 'groq'
    ELSE 'other'
  END,
  side.service_type,
  LEFT(l.model, 64),
  side.qty,
  'tokens',
  c.id,
  COALESCE(c.vendor_currency, 'USD'),
  c.unit_price,
  CASE WHEN c.id IS NULL THEN NULL ELSE ROUND(side.qty * c.unit_price, 4) END,
  CASE WHEN c.id IS NULL THEN NULL WHEN c.vendor_currency = 'INR' THEN 1 ELSE fx.rate_to_inr END,
  CASE
    WHEN c.id IS NULL THEN NULL
    WHEN c.vendor_currency = 'INR' THEN ROUND(side.qty * c.unit_price, 4)
    ELSE ROUND(side.qty * c.unit_price * fx.rate_to_inr, 4)
  END,
  'completed',
  'normal',
  l.created_at,
  l.created_at
FROM job_profile_ai_logs l
JOIN (
  SELECT 'input' AS kind, 'llm_input' AS service_type, prompt_tokens AS qty, id
  FROM job_profile_ai_logs
  UNION ALL
  SELECT 'output', 'llm_output', completion_tokens, id
  FROM job_profile_ai_logs
) side ON side.id = l.id
LEFT JOIN cost_fx_rates fx
  ON fx.quote_currency = 'USD' AND fx.effective_to IS NULL
LEFT JOIN cost_rate_cards c
  ON c.service_type = side.service_type
 AND c.effective_to IS NULL
 AND c.model_or_resource = CASE
    WHEN l.model LIKE 'gemini-3.6%' THEN 'gemini-3.6-flash'
    WHEN l.model LIKE 'gemini%' OR l.model LIKE 'google%' THEN 'gemini-3.8-flash'
    WHEN l.model LIKE 'claude%' OR l.model LIKE 'anthropic%' THEN 'claude-sonnet-4-6'
    WHEN l.model LIKE '%qwen%' THEN 'qwen'
    ELSE LEFT(l.model, 64)
  END
WHERE l.inactive = 0
  AND l.prompt_tokens IS NOT NULL
  AND l.completion_tokens IS NOT NULL
  AND l.model IS NOT NULL
  AND l.model <> ''
  AND NOT EXISTS (
    SELECT 1 FROM assessment_usage_ledger existing
    WHERE existing.idempotency_key = CONCAT('ai_log:', l.id, ':', side.kind)
  );
