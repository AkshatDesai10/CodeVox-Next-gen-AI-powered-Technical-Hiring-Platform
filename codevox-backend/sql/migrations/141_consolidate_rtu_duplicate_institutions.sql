-- Consolidate duplicate "Rajasthan technical university" institutions.
-- Keeps the oldest row (lowest id); soft-deletes newer duplicates with no reassignment needed
-- when they have no child rows (safe for dev/stage replay).
--
-- For environments with FK children on duplicate ids, run instead:
--   node scripts/consolidate-duplicate-institutions.js --name "rajasthan technical university"

SET @canonical_id := (
  SELECT MIN(id)
  FROM institutions
  WHERE inactive = 0
    AND LOWER(TRIM(name)) = 'rajasthan technical university'
);

UPDATE institutions
SET inactive = 1
WHERE inactive = 0
  AND LOWER(TRIM(name)) = 'rajasthan technical university'
  AND id <> @canonical_id
  AND @canonical_id IS NOT NULL;
