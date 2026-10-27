-- Rename legacy single-strike config keys to media-specific names (if present).

UPDATE system_configurations AS src
LEFT JOIN system_configurations AS existing
  ON existing.config_key = 'PROCTOR_MAX_MEDIA_STRIKES'
SET src.config_key = 'PROCTOR_MAX_MEDIA_STRIKES'
WHERE src.config_key = 'PROCTOR_MAX_STRIKES'
  AND existing.config_key IS NULL;

UPDATE system_configurations AS src
LEFT JOIN system_configurations AS existing
  ON existing.config_key = 'PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE'
SET src.config_key = 'PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE'
WHERE src.config_key = 'PROCTOR_AUTO_SUBMIT'
  AND existing.config_key IS NULL;
