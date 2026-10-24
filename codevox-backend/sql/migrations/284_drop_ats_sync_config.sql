-- ATS sync removed; drop unused job profile config column.
ALTER TABLE job_profiles
  DROP COLUMN ats_sync_config;
