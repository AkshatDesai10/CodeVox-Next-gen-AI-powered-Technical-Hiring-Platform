ALTER TABLE take_home_submissions
  MODIFY COLUMN status ENUM(
    'assigned',
    'in_progress',
    'submitted',
    'grading',
    'graded',
    'expired',
    'failed'
  ) NOT NULL DEFAULT 'assigned';
