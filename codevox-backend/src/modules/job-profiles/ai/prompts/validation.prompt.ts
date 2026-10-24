export const CODING_VALIDATION_PROMPT = `Before returning, verify: no placeholders in test cases; examples are correct; constraints are consistent; starter code compiles; internal solution passes all test cases; problem is suitable for automated assessment.`;

export const DATABASE_VALIDATION_PROMPT = `Before returning, verify: DDL is syntactically valid; foreign keys reference existing tables/columns; seed INSERTs respect constraints; the same random seed would reproduce identical data; entity descriptions match the schema; sample queries are answerable against the seed data.`;
