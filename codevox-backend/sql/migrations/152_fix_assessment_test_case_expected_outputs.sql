-- Replace placeholder expected_output values with real autograder expectations.
-- Seed migration 148 used descriptive placeholders (e.g. employee_rows_with_second_highest)
-- that never match actual program/SQL stdout, so correct solutions always scored 0.

UPDATE question_test_cases qt
INNER JOIN questions q ON q.id = qt.question_id
SET qt.expected_output = 'world hello'
WHERE q.title = 'PHP Coding: Reverse Words'
  AND qt.input = 'hello world'
  AND qt.expected_output = 'world hello';

UPDATE question_test_cases qt
INNER JOIN questions q ON q.id = qt.question_id
SET qt.expected_output = 'c b  a'
WHERE q.title = 'PHP Coding: Reverse Words'
  AND qt.input = 'a  b c'
  AND qt.expected_output = 'c b  a';

UPDATE question_test_cases qt
INNER JOIN questions q ON q.id = qt.question_id
SET qt.expected_output = 'id\tname\tdept\tsalary\n2\tBob\tEng\t8500\n3\tCarol\tEng\t8500\n5\tEve\tSales\t6500'
WHERE q.title = 'SQL Coding: Second Highest Salary'
  AND qt.input = 'employees(dept,salary)';

UPDATE question_test_cases qt
INNER JOIN questions q ON q.id = qt.question_id
SET
  qt.input = 'CREATE TABLE employees (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  dept TEXT NOT NULL,
  salary INTEGER NOT NULL
);
INSERT INTO employees (id, name, dept, salary) VALUES
  (1, ''Alice'', ''Eng'', 9000),
  (4, ''Dave'', ''Sales'', 7000);',
  qt.expected_output = ''
WHERE q.title = 'SQL Coding: Second Highest Salary'
  AND qt.input = 'single_salary_per_dept';

UPDATE question_test_cases qt
INNER JOIN questions q ON q.id = qt.question_id
SET qt.expected_output = '[[0,1]]'
WHERE q.title = 'Python Coding: Two Sum Variants'
  AND qt.input = '[2,7,11,15],9';

UPDATE question_test_cases qt
INNER JOIN questions q ON q.id = qt.question_id
SET qt.expected_output = '[[0,1],[2,3]]'
WHERE q.title = 'Python Coding: Two Sum Variants'
  AND qt.input = '[1,3,2,2,4],4';
