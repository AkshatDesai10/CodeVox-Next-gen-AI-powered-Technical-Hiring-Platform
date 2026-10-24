-- Persist Stage-1 voice audit (rubric_scorecard + weighted overalls) on the interview row.
-- Disk audit JSON remains a local/dev convenience; DB is the source of truth for reports.

ALTER TABLE candidate_autonomous_interviews
  ADD COLUMN stage1_voice_audit JSON NULL AFTER stage1_chat_history;
