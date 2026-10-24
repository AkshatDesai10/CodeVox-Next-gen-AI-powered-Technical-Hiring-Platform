export interface ExecutionContext {
  question?: {
    id: string;
    language: string | null;
    executionType?: string | null;
    workspaceType?: string | null;
    environmentConfig?: Record<string, unknown> | null;
    evaluationConfig?: Record<string, unknown> | null;
    questionJson?: Record<string, unknown> | null;
  };
}

export interface ExecutionResult {
  stdout: string;
  stderr: string;
  executionTime: number;
  memoryUsage?: number;
  success: boolean;
  timedOut?: boolean;
}

export interface ExecutionProvider {
  executeCode(
    language: string,
    sourceCode: string,
    stdin?: string,
    context?: ExecutionContext,
  ): Promise<ExecutionResult>;
}

export const EXECUTION_PROVIDER = 'EXECUTION_PROVIDER';
