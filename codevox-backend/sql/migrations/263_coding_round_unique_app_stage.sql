-- Soft-delete duplicates instead of hard DELETE (prefer this over 263).
-- Kept for history; use 265_coding_round_active_uniq_key.sql going forward.

-- DEPRECATED: hard unique on (application_id, stage_key) blocks soft-delete history.
-- See 265_coding_round_active_uniq_key.sql
SELECT 1;
