export const DATABASE_GENERATION_RULES = `The generated database assessment must:
- Match the selected job profile and expected skill level.
- Use realistic business entities inspired by real engineering domains.
- Include CREATE TABLE statements with PRIMARY KEY, FOREIGN KEY, UNIQUE, CHECK constraints, and appropriate indexes.
- Model one-to-one, one-to-many, and many-to-many relationships with referential integrity.
- CRITICAL: You MUST provide executable INSERT statements inside \`seed_data.insert_sql\`. Do NOT just provide markdown tables. The \`insert_sql\` field is strictly required to populate the sandbox database.
- CRITICAL: Never generate INSERT statements that violate the CHECK, UNIQUE, or FOREIGN KEY constraints defined in your DDL. All seed data must be strictly valid and insertable without throwing SQL errors, otherwise the database will fail to initialize.
- Size tables logically according to the requested seed size, BUT for \`insert_sql\`, ONLY generate a small representative sample (max 5-6 rows per table) to fit within token limits.
- Include NULL values, soft-deleted rows, archived rows, duplicate values, and boundary values where appropriate, but ONLY if they do not violate constraints.
- Support SQL interview patterns: SELECT, JOIN, GROUP BY, HAVING, EXISTS, NOT EXISTS, window functions, recursive CTE, ranking, pagination, aggregates.
- Use the configured random seed so output is deterministic and reproducible.
- Avoid ambiguity in table and column naming.
- CRITICAL: The problem statement must end with exactly ONE clearly stated question. The candidate answers it with ONE SQL query.
- CRITICAL: \`sample_queries\` must contain exactly ONE entry — the single correct reference SQL answer. Do NOT generate multiple separate queries or sub-questions.`;

export const SIMPLE_DATABASE_GENERATION_RULES = `The generated simple SQL problem must follow the LeetCode SQL problem style exactly:

1. SCHEMA: The database_schema.ddl_sql must contain the CREATE TABLE statement(s).

2. PROBLEM STATEMENT (problem_statement field): Must contain ALL of the following inline:
   - Each table's schema shown as a plain markdown table with "Column Name" and "Type" columns (e.g. | id | int |)
   - A note on which column is the primary key
   - A short description of what each column represents
   - A single focused SQL question (e.g. "Write a solution to find the second highest distinct salary from the Employee table. If there is no second highest salary, return null.")
   - At least 2 worked examples, each showing:
       * "Example 1:" label
       * "Input:" with the exact table rows for ALL tables involved, shown as separate markdown tables
       * "Output:" with the expected result as a markdown table
       * "Explanation:" briefly explaining the result (if needed)

3. SEED DATA (seed_data.insert_sql): INSERT statements that produce exactly the rows from Example 1 in the problem statement. This populates the sandbox for the candidate.

4. ANSWER (answer_sql field): The single correct reference SQL query that solves the problem. Must be complete and executable.

5. SAMPLE QUERIES: sample_queries array must contain exactly ONE entry: { "title": "Answer", "sql": "<the answer SQL>", "difficulty": "<same as problem difficulty>" }

CRITICAL RULES:
- Do NOT ask multiple unrelated questions. There is exactly ONE question per problem.
- Do NOT generate complex multi-part scenarios or business narratives.
- Never generate INSERT statements that violate constraints.
- The problem_statement must be fully self-contained — a candidate reading only the statement should understand the schema, the question, and what format the answer should be in.`;
