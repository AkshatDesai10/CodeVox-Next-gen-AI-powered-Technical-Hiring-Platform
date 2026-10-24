-- Seed data for technical interview assessments.
-- Idempotent inserts using natural keys where possible.

-- ---------------------------------------------------------------------------
-- Candidates (8)
-- ---------------------------------------------------------------------------
INSERT INTO candidates (
  first_name,
  last_name,
  email,
  phone,
  experience_years,
  current_company,
  current_ctc,
  expected_ctc,
  notice_period_days,
  skills,
  resume_url,
  status
)
VALUES
  ('John', 'Mathews', 'john.mathews@example.com', '+91-9000000001', 3.5, 'Acme Labs', 9.50, 12.00, 30, JSON_ARRAY('PHP', 'MySQL', 'Laravel'), 'https://cdn.example.com/resumes/john-mathews.pdf', 'ACTIVE'),
  ('Jane', 'Fernandez', 'jane.fernandez@example.com', '+91-9000000002', 4.0, 'Bluebyte', 11.00, 14.00, 45, JSON_ARRAY('Python', 'Django', 'PostgreSQL'), 'https://cdn.example.com/resumes/jane-fernandez.pdf', 'ACTIVE'),
  ('Arjun', 'Rao', 'arjun.rao@example.com', '+91-9000000003', 2.2, 'CodeNest', 6.20, 8.50, 30, JSON_ARRAY('JavaScript', 'Node.js', 'SQL'), 'https://cdn.example.com/resumes/arjun-rao.pdf', 'ACTIVE'),
  ('Meera', 'Iyer', 'meera.iyer@example.com', '+91-9000000004', 5.1, 'Datagrid', 16.00, 20.00, 60, JSON_ARRAY('Python', 'FastAPI', 'Redis'), 'https://cdn.example.com/resumes/meera-iyer.pdf', 'ACTIVE'),
  ('Rohit', 'Sharma', 'rohit.sharma@example.com', '+91-9000000005', 1.8, 'NexaSoft', 4.80, 6.50, 15, JSON_ARRAY('Java', 'SQL', 'Debugging'), 'https://cdn.example.com/resumes/rohit-sharma.pdf', 'ACTIVE'),
  ('Sara', 'Khan', 'sara.khan@example.com', '+91-9000000006', 6.3, 'CloudOrbit', 22.00, 27.00, 60, JSON_ARRAY('System Design', 'Microservices', 'Go'), 'https://cdn.example.com/resumes/sara-khan.pdf', 'ACTIVE'),
  ('Vikram', 'Patel', 'vikram.patel@example.com', '+91-9000000007', 3.0, 'TechPulse', 10.00, 13.50, 30, JSON_ARRAY('PHP', 'CodeIgniter', 'SQL'), 'https://cdn.example.com/resumes/vikram-patel.pdf', 'ACTIVE'),
  ('Neha', 'Joshi', 'neha.joshi@example.com', '+91-9000000008', 2.7, 'AsterAI', 8.20, 11.00, 30, JSON_ARRAY('Python', 'Pandas', 'Debugging'), 'https://cdn.example.com/resumes/neha-joshi.pdf', 'ACTIVE')
ON DUPLICATE KEY UPDATE
  first_name = VALUES(first_name),
  last_name = VALUES(last_name),
  phone = VALUES(phone),
  experience_years = VALUES(experience_years),
  current_company = VALUES(current_company),
  current_ctc = VALUES(current_ctc),
  expected_ctc = VALUES(expected_ctc),
  notice_period_days = VALUES(notice_period_days),
  skills = VALUES(skills),
  resume_url = VALUES(resume_url),
  status = VALUES(status);

-- ---------------------------------------------------------------------------
-- Assessments (6)
-- ---------------------------------------------------------------------------
INSERT INTO assessments (
  title,
  description,
  duration_minutes,
  total_marks,
  status,
  created_by
)
SELECT *
FROM (
  SELECT 'PHP Assessment' AS title, 'Backend PHP fundamentals: coding, SQL and debugging.' AS description, 75 AS duration_minutes, 100 AS total_marks, 'PUBLISHED' AS status, 1 AS created_by
  UNION ALL SELECT 'Python Assessment', 'Python problem-solving with SQL and debugging scenarios.', 75, 100, 'PUBLISHED', 1
  UNION ALL SELECT 'SQL Assessment', 'Query writing, optimization and schema-level reasoning.', 60, 100, 'PUBLISHED', 1
  UNION ALL SELECT 'Debugging Assessment', 'Production-like bug tracing and root-cause identification.', 60, 100, 'PUBLISHED', 1
  UNION ALL SELECT 'Full Stack Screening', 'Mixed coding + SQL + debugging for general screening.', 90, 120, 'PUBLISHED', 1
  UNION ALL SELECT 'AI Interview Simulation', 'AI-guided interview questions for technical screening.', 45, 80, 'PUBLISHED', 1
) seed
WHERE NOT EXISTS (
  SELECT 1 FROM assessments a WHERE a.title = seed.title
);

-- ---------------------------------------------------------------------------
-- Questions (15)
-- Mix of coding/sql/debugging represented in title/topic.
-- ---------------------------------------------------------------------------
INSERT INTO questions (
  title,
  description,
  question_type,
  difficulty,
  marks,
  language
)
SELECT *
FROM (
  SELECT 'PHP Coding: Reverse Words' AS title, 'Write a PHP function to reverse words in a sentence while preserving spaces.' AS description, 'CODING' AS question_type, 'EASY' AS difficulty, 15 AS marks, 'PHP' AS language
  UNION ALL SELECT 'PHP SQL: Top Customers', 'Write SQL to fetch top 5 customers by total order value in last 30 days.', 'CODING', 'MEDIUM', 20, 'SQL'
  UNION ALL SELECT 'PHP Debugging: Session Timeout Bug', 'Identify and fix unexpected session invalidation in a login flow.', 'SHORT_ANSWER', 'MEDIUM', 15, 'PHP'
  UNION ALL SELECT 'Python Coding: Two Sum Variants', 'Return all unique index pairs whose sum equals target.', 'CODING', 'EASY', 15, 'PYTHON'
  UNION ALL SELECT 'Python SQL: Monthly Revenue', 'Write SQL for monthly revenue by product category.', 'CODING', 'MEDIUM', 20, 'SQL'
  UNION ALL SELECT 'Python Debugging: Memory Leak', 'Analyze and fix memory growth in a batch processor.', 'SHORT_ANSWER', 'HARD', 20, 'PYTHON'
  UNION ALL SELECT 'SQL Coding: Second Highest Salary', 'Return employee rows with second highest salary per department.', 'CODING', 'MEDIUM', 15, 'SQL'
  UNION ALL SELECT 'SQL Coding: Duplicate Emails', 'Find duplicate email records and list canonical id to keep.', 'CODING', 'EASY', 15, 'SQL'
  UNION ALL SELECT 'SQL Debugging: Slow Join', 'Investigate poor query performance and suggest index changes.', 'SHORT_ANSWER', 'HARD', 20, 'SQL'
  UNION ALL SELECT 'Debugging Coding: Null Pointer Trace', 'Fix intermittent null pointer issue in order creation path.', 'CODING', 'MEDIUM', 15, 'JAVA'
  UNION ALL SELECT 'Debugging Coding: Race Condition', 'Resolve race condition causing duplicate invoice numbers.', 'CODING', 'HARD', 20, 'NODE'
  UNION ALL SELECT 'Debugging SQL: Wrong Aggregation', 'Correct aggregation bug causing mismatched dashboard totals.', 'SHORT_ANSWER', 'MEDIUM', 15, 'SQL'
  UNION ALL SELECT 'Full Stack Coding: REST Pagination', 'Implement paginated endpoint with filtering and sorting.', 'CODING', 'MEDIUM', 20, 'NODE'
  UNION ALL SELECT 'Full Stack SQL: Search Indexing', 'Design SQL-backed search query for low-latency filtering.', 'CODING', 'MEDIUM', 20, 'SQL'
  UNION ALL SELECT 'AI Interview: System Thinking', 'Explain trade-offs for scaling candidate assessment platform.', 'SHORT_ANSWER', 'MEDIUM', 20, 'GENERAL'
) seed
WHERE NOT EXISTS (
  SELECT 1 FROM questions q WHERE q.title = seed.title
);

-- ---------------------------------------------------------------------------
-- Coding question test cases (2 per coding question)
-- ---------------------------------------------------------------------------
INSERT INTO question_test_cases (question_id, input, expected_output, is_hidden)
SELECT q.id, tc.input, tc.expected_output, tc.is_hidden
FROM questions q
JOIN (
  SELECT 'PHP Coding: Reverse Words' AS title, 'hello world' AS input, 'world hello' AS expected_output, 0 AS is_hidden
  UNION ALL SELECT 'PHP Coding: Reverse Words', 'a  b c', 'c b  a', 1
  UNION ALL SELECT 'PHP SQL: Top Customers', 'orders(customers,amount,date)', 'top_5_customer_ids', 0
  UNION ALL SELECT 'PHP SQL: Top Customers', 'orders(empty_last_30_days)', 'empty_result', 1
  UNION ALL SELECT 'Python Coding: Two Sum Variants', '[2,7,11,15],9', '[[0,1]]', 0
  UNION ALL SELECT 'Python Coding: Two Sum Variants', '[1,3,2,2,4],4', '[[0,1],[2,3]]', 1
  UNION ALL SELECT 'Python SQL: Monthly Revenue', 'sales(product,amount,date)', 'month,category,total_revenue', 0
  UNION ALL SELECT 'Python SQL: Monthly Revenue', 'sales(no_rows)', 'empty_result', 1
  UNION ALL SELECT 'SQL Coding: Second Highest Salary', 'employees(dept,salary)', 'employee_rows_with_second_highest', 0
  UNION ALL SELECT 'SQL Coding: Second Highest Salary', 'single_salary_per_dept', 'empty_result', 1
  UNION ALL SELECT 'SQL Coding: Duplicate Emails', 'users(id,email)', 'duplicate_groups_with_keep_id', 0
  UNION ALL SELECT 'SQL Coding: Duplicate Emails', 'users(unique_emails)', 'empty_result', 1
  UNION ALL SELECT 'Debugging Coding: Null Pointer Trace', 'order payload missing customer id', 'safe validation + handled error', 0
  UNION ALL SELECT 'Debugging Coding: Null Pointer Trace', 'nested null in shipping address', 'no crash + fallback branch', 1
  UNION ALL SELECT 'Debugging Coding: Race Condition', 'parallel createInvoice requests', 'unique invoice numbers', 0
  UNION ALL SELECT 'Debugging Coding: Race Condition', '100 concurrent requests', 'no duplicates', 1
  UNION ALL SELECT 'Full Stack Coding: REST Pagination', 'GET /items?page=2&limit=10', '10 items + total_count', 0
  UNION ALL SELECT 'Full Stack Coding: REST Pagination', 'GET /items?page=-1', 'validation_error', 1
  UNION ALL SELECT 'Full Stack SQL: Search Indexing', 'query by status+created_at', 'index_usage_in_execution_plan', 0
  UNION ALL SELECT 'Full Stack SQL: Search Indexing', 'wildcard search + sort', 'bounded_latency_plan', 1
) tc ON tc.title = q.title
WHERE NOT EXISTS (
  SELECT 1
  FROM question_test_cases qt
  WHERE qt.question_id = q.id
    AND qt.input = tc.input
);

-- ---------------------------------------------------------------------------
-- Assessment question mapping (5 questions per assessment)
-- ---------------------------------------------------------------------------
INSERT INTO assessment_questions (assessment_id, question_id, marks, sort_order)
SELECT a.id, q.id, map.marks, map.sort_order
FROM assessments a
JOIN (
  SELECT 'PHP Assessment' AS assessment_title, 'PHP Coding: Reverse Words' AS question_title, 20 AS marks, 1 AS sort_order
  UNION ALL SELECT 'PHP Assessment', 'PHP SQL: Top Customers', 20, 2
  UNION ALL SELECT 'PHP Assessment', 'PHP Debugging: Session Timeout Bug', 20, 3
  UNION ALL SELECT 'PHP Assessment', 'SQL Coding: Duplicate Emails', 20, 4
  UNION ALL SELECT 'PHP Assessment', 'Debugging Coding: Race Condition', 20, 5

  UNION ALL SELECT 'Python Assessment', 'Python Coding: Two Sum Variants', 20, 1
  UNION ALL SELECT 'Python Assessment', 'Python SQL: Monthly Revenue', 20, 2
  UNION ALL SELECT 'Python Assessment', 'Python Debugging: Memory Leak', 20, 3
  UNION ALL SELECT 'Python Assessment', 'SQL Coding: Second Highest Salary', 20, 4
  UNION ALL SELECT 'Python Assessment', 'Debugging Coding: Null Pointer Trace', 20, 5

  UNION ALL SELECT 'SQL Assessment', 'SQL Coding: Second Highest Salary', 20, 1
  UNION ALL SELECT 'SQL Assessment', 'SQL Coding: Duplicate Emails', 20, 2
  UNION ALL SELECT 'SQL Assessment', 'SQL Debugging: Slow Join', 20, 3
  UNION ALL SELECT 'SQL Assessment', 'Full Stack SQL: Search Indexing', 20, 4
  UNION ALL SELECT 'SQL Assessment', 'Python SQL: Monthly Revenue', 20, 5

  UNION ALL SELECT 'Debugging Assessment', 'PHP Debugging: Session Timeout Bug', 20, 1
  UNION ALL SELECT 'Debugging Assessment', 'Python Debugging: Memory Leak', 20, 2
  UNION ALL SELECT 'Debugging Assessment', 'SQL Debugging: Slow Join', 20, 3
  UNION ALL SELECT 'Debugging Assessment', 'Debugging Coding: Null Pointer Trace', 20, 4
  UNION ALL SELECT 'Debugging Assessment', 'Debugging SQL: Wrong Aggregation', 20, 5

  UNION ALL SELECT 'Full Stack Screening', 'Full Stack Coding: REST Pagination', 24, 1
  UNION ALL SELECT 'Full Stack Screening', 'Full Stack SQL: Search Indexing', 24, 2
  UNION ALL SELECT 'Full Stack Screening', 'Debugging Coding: Race Condition', 24, 3
  UNION ALL SELECT 'Full Stack Screening', 'AI Interview: System Thinking', 24, 4
  UNION ALL SELECT 'Full Stack Screening', 'SQL Coding: Duplicate Emails', 24, 5

  UNION ALL SELECT 'AI Interview Simulation', 'AI Interview: System Thinking', 16, 1
  UNION ALL SELECT 'AI Interview Simulation', 'Debugging SQL: Wrong Aggregation', 16, 2
  UNION ALL SELECT 'AI Interview Simulation', 'Python Debugging: Memory Leak', 16, 3
  UNION ALL SELECT 'AI Interview Simulation', 'Full Stack Coding: REST Pagination', 16, 4
  UNION ALL SELECT 'AI Interview Simulation', 'SQL Coding: Second Highest Salary', 16, 5
) map ON map.assessment_title = a.title
JOIN questions q ON q.title = map.question_title
ON DUPLICATE KEY UPDATE
  marks = VALUES(marks),
  sort_order = VALUES(sort_order);

-- ---------------------------------------------------------------------------
-- Candidate assignment to assessments
-- ---------------------------------------------------------------------------
INSERT INTO candidate_assessments (candidate_id, assessment_id, status, started_at, submitted_at, score)
SELECT c.id, a.id, ca.status, ca.started_at, ca.submitted_at, ca.score
FROM candidates c
JOIN (
  SELECT 'john.mathews@example.com' AS email, 'PHP Assessment' AS assessment_title, 'SUBMITTED' AS status, '2026-06-10 10:00:00' AS started_at, '2026-06-10 11:00:00' AS submitted_at, 78.50 AS score
  UNION ALL SELECT 'jane.fernandez@example.com', 'Python Assessment', 'SUBMITTED', '2026-06-10 10:15:00', '2026-06-10 11:20:00', 84.00
  UNION ALL SELECT 'arjun.rao@example.com', 'SQL Assessment', 'IN_PROGRESS', '2026-06-11 09:00:00', NULL, NULL
  UNION ALL SELECT 'meera.iyer@example.com', 'Debugging Assessment', 'SUBMITTED', '2026-06-11 11:00:00', '2026-06-11 11:45:00', 88.00
  UNION ALL SELECT 'rohit.sharma@example.com', 'PHP Assessment', 'ASSIGNED', NULL, NULL, NULL
  UNION ALL SELECT 'sara.khan@example.com', 'Full Stack Screening', 'SUBMITTED', '2026-06-12 14:00:00', '2026-06-12 15:20:00', 90.00
  UNION ALL SELECT 'vikram.patel@example.com', 'SQL Assessment', 'ASSIGNED', NULL, NULL, NULL
  UNION ALL SELECT 'neha.joshi@example.com', 'AI Interview Simulation', 'IN_PROGRESS', '2026-06-13 16:30:00', NULL, NULL
) ca ON ca.email = c.email
JOIN assessments a ON a.title = ca.assessment_title
WHERE NOT EXISTS (
  SELECT 1
  FROM candidate_assessments x
  WHERE x.candidate_id = c.id
    AND x.assessment_id = a.id
);

-- ---------------------------------------------------------------------------
-- AI interview testing data: one session per candidate-assessment above
-- ---------------------------------------------------------------------------
INSERT INTO interview_sessions (candidate_id, assessment_id, status, started_at, ended_at)
SELECT ca.candidate_id, ca.assessment_id,
  CASE
    WHEN ca.status = 'SUBMITTED' THEN 'COMPLETED'
    WHEN ca.status = 'IN_PROGRESS' THEN 'IN_PROGRESS'
    ELSE 'SCHEDULED'
  END AS status,
  ca.started_at,
  ca.submitted_at
FROM candidate_assessments ca
WHERE NOT EXISTS (
  SELECT 1
  FROM interview_sessions s
  WHERE s.candidate_id = ca.candidate_id
    AND s.assessment_id = ca.assessment_id
);

INSERT INTO interview_questions (session_id, question, question_type, sequence_no)
SELECT s.id, iq.question, iq.question_type, iq.sequence_no
FROM interview_sessions s
JOIN (
  SELECT 1 AS sequence_no, 'Explain your approach before writing code.' AS question, 'TECHNICAL' AS question_type
  UNION ALL SELECT 2, 'How would you optimize this SQL query for scale?', 'TECHNICAL'
  UNION ALL SELECT 3, 'Describe a production bug you fixed and your debugging process.', 'BEHAVIORAL'
) iq ON 1 = 1
WHERE NOT EXISTS (
  SELECT 1
  FROM interview_questions q
  WHERE q.session_id = s.id
    AND q.sequence_no = iq.sequence_no
);
