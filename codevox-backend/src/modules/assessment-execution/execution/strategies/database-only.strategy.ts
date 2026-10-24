import { mkdtemp, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import type {
  ExecutionStrategy,
  PreparedRun,
  Question,
  RawResult,
  Submission,
  TestCase,
} from '../execution-strategy';
import {
  defaultDockerRuntimeConfig,
  runDockerCommand,
  volumeMount,
} from '../docker-runtime.util';
import {
  SQL_RUNNER_PY,
  buildSqlScript,
} from '../../utils/sql-runner.util';

/**
 * Ephemeral DB container — candidate query/script only, no application server.
 */
export class DatabaseOnlyStrategy implements ExecutionStrategy {
  readonly executionType = 'DATABASE_ONLY' as const;
  readonly resourceWeight = 'light' as const;

  private readonly config = defaultDockerRuntimeConfig();

  async prepare(submission: Submission, question: Question): Promise<PreparedRun> {
    const workDir = await mkdtemp(join(tmpdir(), 'assessment-db-'));
    const schemaSql = this.readSchemaSql(question);
    const stdinSeed = schemaSql ?? '';

    await writeFile(
      join(workDir, 'query.sql'),
      buildSqlScript(submission.sourceCode, stdinSeed),
      'utf8',
    );
    await writeFile(join(workDir, 'run_sql.py'), SQL_RUNNER_PY, 'utf8');

    return {
      workDir,
      strategyKey: 'DATABASE_ONLY',
      metadata: {
        image:
          process.env.ASSESSMENT_DOCKER_IMAGE_SQL ??
          process.env.ASSESSMENT_DOCKER_IMAGE_PYTHON ??
          'python:3.11',
      },
    };
  }

  async execute(prepared: PreparedRun, testCase: TestCase): Promise<RawResult> {
    const image = String(prepared.metadata.image);
    const args = [
      'run',
      '--rm',
      '--network',
      'none',
      '--memory',
      this.config.memory,
      '--cpus',
      this.config.cpus,
      '-v',
      volumeMount(resolve(prepared.workDir), 'ro'),
      '-i',
      image,
      'python',
      '/workspace/run_sql.py',
    ];

    const result = await runDockerCommand(this.config, args, testCase.input || undefined);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      executionTime: result.executionTime,
      success: result.success,
      timedOut: result.timedOut,
    };
  }

  async teardown(prepared: PreparedRun): Promise<void> {
    const { rm } = await import('fs/promises');
    await rm(prepared.workDir, { recursive: true, force: true });
  }

  private readSchemaSql(question: Question): string | null {
    const env = question.environmentConfig ?? {};
    const json = question.questionJson ?? {};
    const schema = env.schemaSql ?? env.schema ?? json.schema ?? json.seedData;
    if (typeof schema === 'string' && schema.trim()) return schema.trim();
    return null;
  }
}
