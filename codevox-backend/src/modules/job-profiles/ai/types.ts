export type GeneratorType = 'coding' | 'database';

export type SeedSize = 'small' | 'medium' | 'large';

export type GenerateFlags = {
  problem_statement?: boolean;
  starter_code?: boolean;
  internal_solution?: boolean;
  test_cases?: boolean;
  complexity_analysis?: boolean;
  hints?: boolean;
  requires_sandbox_database?: boolean;
  database_schema?: boolean;
  seed_data?: boolean;
  entity_descriptions?: boolean;
  relationships?: boolean;
  sql_queries?: boolean;
};

export type SeedOptions = {
  random_seed?: number;
  size?: SeedSize;
};

export type AiGenerationConfig = {
  generator: GeneratorType;
  competency_name: string;
  competency_description?: string;
  job_profile: string;
  tech_stack: string;
  domain: string;
  seniority: string;
  topic_tag: string;
  difficulty: string;
  problem_pattern?: string;
  database_type?: string;
  database_question_type?: 'scenario' | 'simple';
  max_input_size?: string;
  value_range?: string;
  time_limit?: string;
  memory_limit?: string;
  time_limit_ms?: number;
  memory_limit_mb?: number;
  languages: string[];
  job_profile_id?: string;
  generate?: GenerateFlags;
  seed_options?: SeedOptions;
  requires_sandbox_database?: boolean;
  code_skeleton?: 'scratch' | 'scaffolded';
  custom_instructions?: string;
};

/** @deprecated Use AiGenerationConfig — kept for existing imports */
export type ProblemBankAiGenerateInput = Omit<AiGenerationConfig, 'generator'> & {
  problem_pattern: string;
  max_input_size: string;
  value_range: string;
  time_limit: string;
  memory_limit: string;
  time_limit_ms: number;
  memory_limit_mb: number;
};

export type SectionDefinition = {
  id: string;
  label: string;
  promptLine: string;
  schema: Record<string, unknown>;
  generators: GeneratorType[];
  defaultEnabled?: boolean | ((flags: GenerateFlags) => boolean);
};

export type BuiltPrompt = {
  system: string;
  user: string;
};

export type CodingAiRawResult = Record<string, unknown>;

export type DatabaseAiRawResult = Record<string, unknown>;
