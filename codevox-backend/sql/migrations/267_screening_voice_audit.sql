-- Persist AI Screening conversation state + analyzer results (no score).
-- Separate from stage1_voice_audit / hr_voice_audit to avoid overwrite collisions.

ALTER TABLE candidate_autonomous_interviews
  ADD COLUMN screening_voice_audit JSON NULL AFTER hr_voice_audit;
