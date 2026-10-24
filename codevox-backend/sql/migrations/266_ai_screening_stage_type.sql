-- Add AI Screening as a distinct stage type (no rubrics / no score).
-- Existing `screening` (AI Technical Screening) is unchanged.

ALTER TABLE job_profile_stages
  MODIFY COLUMN stage_type ENUM(
    'screening',
    'coding',
    'ai_verbal',
    'hr_verbal',
    'panel',
    'custom',
    'take_home',
    'ai_screening'
  ) NOT NULL DEFAULT 'custom';
