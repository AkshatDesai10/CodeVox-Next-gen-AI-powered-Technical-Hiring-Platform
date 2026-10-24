import { Injectable } from '@nestjs/common';
import type {
  ExecutionStrategy,
  PreparedRun,
  Question,
  RawResult,
  Submission,
  TestCase,
} from './execution-strategy';
import { StrategyRegistry } from './strategy-registry';
import type { ExecutionResult, ExecutionContext } from '../interfaces/execution-provider.interface';
import { resolveSubmissionSourceCode, parseVfsSubmission } from '../utils/php-assessment-adapter';

@Injectable()
export class ExecutionOrchestratorService {
  constructor(private readonly registry: StrategyRegistry) {}

  resolveResourceWeight(
    question: Question,
    language: string,
    sampleInput?: string,
    sourceCode?: string,
  ) {
    return this.registry.resourceWeightFor(question, language, sampleInput, sourceCode);
  }

  async executeSingle(
    submission: Submission,
    question: Question,
    testCase: TestCase,
  ): Promise<RawResult> {
    const resolvedSubmission = this.withResolvedSource(submission);
    const strategy = this.registry.resolve(
      question,
      resolvedSubmission.language,
      testCase.input,
      resolvedSubmission.sourceCode,
    );
    const prepared = await strategy.prepare(resolvedSubmission, question);
    try {
      return await strategy.execute(prepared, testCase);
    } finally {
      await strategy.teardown(prepared);
    }
  }

  async executeBatch(
    submission: Submission,
    question: Question,
    testCases: TestCase[],
  ): Promise<RawResult[]> {
    if (!testCases.length) return [];

    const resolvedSubmission = this.withResolvedSource(submission);
    const strategy = this.registry.resolve(
      question,
      resolvedSubmission.language,
      testCases[0]?.input,
      resolvedSubmission.sourceCode,
    );
    const prepared = await strategy.prepare(resolvedSubmission, question);
    try {
      const results: RawResult[] = [];
      for (const testCase of testCases) {
        results.push(await strategy.execute(prepared, testCase));
      }
      return results;
    } finally {
      await strategy.teardown(prepared);
    }
  }

  /** Backward-compatible single-shot used by run-code without full question context. */
  async executeCode(
    language: string,
    sourceCode: string,
    stdin?: string,
    context?: ExecutionContext,
  ): Promise<ExecutionResult> {
    const question: Question = context?.question ?? {
      id: '0',
      language,
      executionType: null,
      environmentConfig: null,
      questionJson: null,
    };

    const submission: Submission = { language, sourceCode };
    const testCase: TestCase = {
      id: '1',
      input: stdin ?? '',
      expectedOutput: '',
    };

    const raw = await this.executeSingle(this.withResolvedSource(submission), question, testCase);
    return {
      stdout: raw.stdout,
      stderr: raw.stderr,
      executionTime: raw.executionTime,
      success: raw.success,
      timedOut: raw.timedOut,
    };
  }

  private withResolvedSource(submission: Submission): Submission {
    const vfs = parseVfsSubmission(submission.sourceCode);
    if (!vfs) return submission;
    const entrySource = resolveSubmissionSourceCode(submission.sourceCode);
    return {
      ...submission,
      sourceCode: entrySource,
      vfsFiles: vfs.files,
      entryFile: vfs.entryFile,
    };
  }
}
