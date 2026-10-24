import { Injectable } from '@nestjs/common';
import { ExecutionOrchestratorService } from '../execution/execution-orchestrator.service';
import { responsesMatch } from '../execution/structural-compare.util';
import type { Question } from '../execution/execution-strategy';
import { resolveSqlSetup, resolveSqlSetupFromConfig, DEFAULT_SQL_SETUP } from '../utils/sql-runner.util';
import { SubmissionStatus } from '../submission-status.enum';
import type { QuestionTestCaseMysql } from '../entities/question-test-case.mysql.entity';

export type QuestionEvaluationInput = {
  questionId: string;
  title: string;
  marks: number;
};

export type TestCaseResult = {
  testCaseId: string;
  passed: boolean;
  timedOut: boolean;
  stderr: string;
  stdout: string;
  executionTime: number;
};

export type QuestionEvaluationResult = {
  questionId: string;
  title: string;
  passedTests: number;
  totalTests: number;
  score: number;
  percentage: number;
  status: SubmissionStatus;
  executionTime: number;
  executionOutput: string;
  passedTestCases: number;
  totalTestCases: number;
};

@Injectable()
export class EvaluationService {
  constructor(private readonly orchestrator: ExecutionOrchestratorService) {}

  async evaluateQuestion(
    question: QuestionEvaluationInput,
    language: string,
    sourceCode: string,
    testCases: QuestionTestCaseMysql[],
    environmentConfig?: Record<string, unknown> | null,
    questionJson?: Record<string, unknown> | null,
    evaluationConfig?: Record<string, unknown> | null,
  ): Promise<QuestionEvaluationResult> {
    const caseResults: TestCaseResult[] = [];
    let passed = 0;
    let totalExecutionTime = 0;
    let hadError = false;

    const executionQuestion: Question = {
      id: question.questionId,
      language,
      environmentConfig: environmentConfig ?? null,
      evaluationConfig: evaluationConfig ?? null,
      questionJson: questionJson ?? null,
    };

    const mappedCases = testCases.map((tc) => {
      const isSql = language.trim().toUpperCase() === 'SQL';
      const envSetup = resolveSqlSetupFromConfig(environmentConfig);
      const input = isSql
        ? envSetup ?? resolveSqlSetup(tc.input) ?? DEFAULT_SQL_SETUP
        : tc.input;
      return {
        id: tc.id,
        input,
        expectedOutput: tc.expectedOutput,
      };
    });

    const rawResults = await this.orchestrator.executeBatch(
      { language, sourceCode },
      executionQuestion,
      mappedCases,
    );

    for (let index = 0; index < mappedCases.length; index += 1) {
      const testCase = mappedCases[index];
      const dbCase = testCases[index];
      const result = rawResults[index];

      try {
        totalExecutionTime += result.executionTime;
        const isSql = language.trim().toUpperCase() === 'SQL';
        const casePassed =
          !result.timedOut &&
          responsesMatch(result.stdout, testCase.expectedOutput, {
            sql: isSql,
            actualStatus: result.statusCode,
          });

        if (result.timedOut || (result.stderr && !casePassed)) hadError = true;
        if (casePassed) passed += 1;

        caseResults.push({
          testCaseId: dbCase.id,
          passed: casePassed,
          timedOut: Boolean(result.timedOut),
          stderr: result.stderr,
          stdout: result.stdout,
          executionTime: result.executionTime,
        });
      } catch (err) {
        hadError = true;
        caseResults.push({
          testCaseId: dbCase.id,
          passed: false,
          timedOut: false,
          stderr: String(err),
          stdout: '',
          executionTime: 0,
        });
      }
    }

    const total = testCases.length;
    const score = total > 0 ? (passed / total) * Number(question.marks) : 0;
    const percentage = total > 0 ? (passed / total) * 100 : 0;

    let status = SubmissionStatus.FAILED;
    if (hadError && passed === 0) status = SubmissionStatus.ERROR;
    else if (passed === total && total > 0) status = SubmissionStatus.PASSED;
    else if (passed > 0) status = SubmissionStatus.PARTIAL;

    return {
      questionId: question.questionId,
      title: question.title,
      passedTests: passed,
      totalTests: total,
      score,
      percentage,
      status,
      executionTime: totalExecutionTime,
      executionOutput: JSON.stringify({ cases: caseResults }),
      passedTestCases: passed,
      totalTestCases: total,
    };
  }

  isGradedStatus(status: SubmissionStatus) {
    return (
      status === SubmissionStatus.PASSED ||
      status === SubmissionStatus.FAILED ||
      status === SubmissionStatus.PARTIAL ||
      status === SubmissionStatus.ERROR
    );
  }
}
