import { Inject, Injectable } from '@nestjs/common';
import {
  EXECUTION_PROVIDER,
  type ExecutionContext,
  type ExecutionProvider,
  type ExecutionResult,
} from '../interfaces/execution-provider.interface';
import { outputsMatch, normalizeOutput } from '../utils/output.util';

@Injectable()
export class ExecutionService {
  constructor(
    @Inject(EXECUTION_PROVIDER)
    private readonly provider: ExecutionProvider,
  ) {}

  executeCode(
    language: string,
    sourceCode: string,
    stdin?: string,
    context?: ExecutionContext,
  ): Promise<ExecutionResult> {
    return this.provider.executeCode(language, sourceCode, stdin, context);
  }

  normalizeOutput(value: string) {
    return normalizeOutput(value);
  }

  outputsMatch(actual: string, expected: string) {
    return outputsMatch(actual, expected);
  }
}
