import type { SectionDefinition } from '../types';

export const DATABASE_SECTIONS: SectionDefinition[] = [
  {
    id: 'problem_statement',
    label: 'SQL Problem Statement',
    promptLine: 'SQL problem statement and scenario',
    generators: ['database'],
    defaultEnabled: (flags) => flags.problem_statement !== false,
    schema: {
      problem_title: 'Concise professional title',
      difficulty: 'easy | medium | hard',
      topic_tags: ['tag1'],
      problem_statement: 'Business scenario and SQL assessment objective',
      scenario_description: 'Realistic domain context for the dataset',
    },
  },
  {
    id: 'database_schema',
    label: 'Database Schema',
    promptLine: 'CREATE TABLE DDL with keys, constraints, and indexes',
    generators: ['database'],
    defaultEnabled: (flags) => flags.database_schema !== false,
    schema: {
      database_schema: {
        ddl_sql: '-- CREATE TABLE statements with PK, FK, UNIQUE, CHECK, INDEX',
        tables: [{ name: 'table_name', purpose: 'what this table stores' }],
      },
    },
  },
  {
    id: 'relationships',
    label: 'Relationships',
    promptLine: 'entity relationships (1:1, 1:N, N:M)',
    generators: ['database'],
    defaultEnabled: (flags) => flags.relationships !== false,
    schema: {
      relationships: [
        { from_table: 'orders', to_table: 'customers', type: 'many-to-one', description: 'each order belongs to one customer' },
      ],
    },
  },
  {
    id: 'entity_descriptions',
    label: 'Entity Descriptions',
    promptLine: 'entity/table descriptions',
    generators: ['database'],
    defaultEnabled: (flags) => flags.entity_descriptions !== false,
    schema: {
      entity_descriptions: [{ table_name: 'users', description: 'Stores user accounts', key_columns: ['id', 'email'] }],
    },
  },
  {
    id: 'seed_data',
    label: 'Seed Data',
    promptLine: 'executable INSERT seed SQL with deterministic random seed',
    generators: ['database'],
    defaultEnabled: (flags) => flags.seed_data !== false,
    schema: {
      seed_data: {
        random_seed: 42,
        size: 'small | medium | large',
        insert_sql: '-- CRITICAL: MUST provide raw INSERT INTO statements here',
        row_counts: { table_name: 100 },
        notes: 'Includes NULLs, soft-deletes, archived rows, boundary values as appropriate',
      },
    },
  },
  {
    id: 'sql_queries',
    label: 'Sample SQL Queries',
    promptLine: 'sample interview queries the dataset supports',
    generators: ['database'],
    defaultEnabled: (flags) => flags.sql_queries !== false,
    schema: {
      supported_query_patterns: ['JOIN across orders and customers', 'GROUP BY with HAVING', 'Window function ranking'],
      sample_queries: [{ title: 'Top customers by revenue', sql: 'SELECT ...', difficulty: 'medium' }],
    },
  },
  {
    id: 'evaluation_config',
    label: 'Evaluation Rubric',
    promptLine: 'a specialized grading rubric tailored to the specific seniority level',
    generators: ['database'],
    defaultEnabled: (flags) => true,
    schema: {
      evaluation_config: {
        rubric: {
          correctness: 40,
          performance_and_indexes: 40,
          edge_cases: 20
        }
      }
    }
  },
  {
    id: 'hints',
    label: 'Hints',
    promptLine: 'three progressive SQL hints',
    generators: ['database'],
    defaultEnabled: (flags) => Boolean(flags.hints),
    schema: { hints: ['Subtle hint 1', 'Approach hint 2', 'Near-solution hint 3'] },
  },
];
