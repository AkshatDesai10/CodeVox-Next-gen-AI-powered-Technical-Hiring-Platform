-- Snapshot of Problem Bank IDs assigned to a candidate coding round (AI bank_only strategy).
ALTER TABLE coding_round_submissions
  ADD COLUMN assigned_problem_ids JSON NULL AFTER problem_submissions;
