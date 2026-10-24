ALTER TABLE coding_round_submissions
  MODIFY COLUMN status ENUM('in_progress','grading','submitted','error')
  NOT NULL DEFAULT 'in_progress';
