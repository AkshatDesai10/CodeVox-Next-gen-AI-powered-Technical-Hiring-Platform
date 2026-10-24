-- Progression mode: sequential (all rounds then HR) vs elimination (threshold to unlock next).
ALTER TABLE job_profiles
  ADD COLUMN progression_config JSON NULL
  AFTER threshold_config;
