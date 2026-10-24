-- Optional: AI Behavioural audit column (nullable JSON)
ALTER TABLE candidate_autonomous_interviews
  ADD COLUMN hr_voice_audit JSON NULL AFTER stage3_chat_history;
