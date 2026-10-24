export type ExecutionResourceWeight = 'light' | 'medium' | 'heavy';

export type ExecutionType =
  | 'SCRIPT'
  | 'HTTP_SERVICE'
  | 'FRAMEWORK_PROJECT'
  | 'DATABASE_ONLY';

export interface Submission {
  language: string;
  sourceCode: string;
  /** Populated when sourceCode is an IDE virtual-filesystem JSON snapshot. */
  vfsFiles?: Record<string, string>;
  entryFile?: string;
}

export interface Question {
  id: string;
  language: string | null;
  executionType?: ExecutionType | string | null;
  workspaceType?: string | null;
  environmentConfig?: Record<string, unknown> | null;
  evaluationConfig?: Record<string, unknown> | null;
  questionJson?: Record<string, unknown> | null;
}

export interface TestCase {
  id: string;
  input: string;
  expectedOutput: string;
}

export interface PreparedRun {
  workDir: string;
  strategyKey: ExecutionType;
  /** Opaque strategy state (container id, process handles, etc.). */
  metadata: Record<string, unknown>;
}

export interface RawResult {
  stdout: string;
  stderr: string;
  statusCode?: number;
  executionTime: number;
  success: boolean;
  timedOut?: boolean;
}

export interface ExecutionStrategy {
  readonly executionType: ExecutionType;
  readonly resourceWeight: ExecutionResourceWeight;
  prepare(submission: Submission, question: Question): Promise<PreparedRun>;
  execute(prepared: PreparedRun, testCase: TestCase): Promise<RawResult>;
  teardown(prepared: PreparedRun): Promise<void>;
}
