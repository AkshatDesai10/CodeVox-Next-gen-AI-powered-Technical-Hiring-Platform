-- Coding round LiveKit room + recording support (same monitor path as interview rounds).
ALTER TABLE autonomous_interview_rounds
  MODIFY COLUMN round_type ENUM(
    'ai_screening',
    'intro_verbal',
    'hr_verbal',
    'bnd_assessment',
    'bnd_interview',
    'coding'
  ) NOT NULL;
