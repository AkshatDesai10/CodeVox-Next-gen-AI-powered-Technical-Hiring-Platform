import { mkdtemp, writeFile, mkdir } from 'fs/promises';
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

/**
 * Pre-baked framework image + candidate file overlay + native test runner.
 *
 * TODO(isolation): DevOps / multi-service framework questions may require
 * stronger sandboxing than Script/HttpService (e.g. Docker-in-Docker).
 * Leave implementing DinD + network policy for a follow-up pass.
 */
export class FrameworkProjectStrategy implements ExecutionStrategy {
  readonly executionType = 'FRAMEWORK_PROJECT' as const;
  readonly resourceWeight = 'heavy' as const;

  private readonly config = defaultDockerRuntimeConfig();

  async prepare(submission: Submission, question: Question): Promise<PreparedRun> {
    const workDir = await mkdtemp(join(tmpdir(), 'assessment-framework-'));
    const overlayDir = join(workDir, 'overlay');
    await mkdir(overlayDir, { recursive: true });

    const framework = String(
      question.environmentConfig?.framework ??
        question.questionJson?.framework ??
        'phpunit',
    );

    const files = (question.environmentConfig?.overlayFiles ??
      question.questionJson?.overlayFiles) as
      | Array<{ path: string; content: string }>
      | undefined;

    if (Array.isArray(files) && files.length) {
      for (const file of files) {
        const target = join(overlayDir, file.path);
        await mkdir(join(target, '..'), { recursive: true });
        await writeFile(target, file.content, 'utf8');
      }
    } else {
      await writeFile(join(overlayDir, 'Main.php'), submission.sourceCode, 'utf8');
    }

    const image = String(
      question.environmentConfig?.baseImage ??
        process.env.ASSESSMENT_DOCKER_IMAGE_FRAMEWORK ??
        'php:8.3-cli',
    );

    return {
      workDir,
      strategyKey: 'FRAMEWORK_PROJECT',
      metadata: { image, framework, overlayDir },
    };
  }

  async execute(prepared: PreparedRun, testCase: TestCase): Promise<RawResult> {
    const image = String(prepared.metadata.image);
    const framework = String(prepared.metadata.framework);
    const runnerCommand = this.resolveTestRunner(framework, testCase);

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
      volumeMount(resolve(prepared.workDir), 'rw'),
      image,
      'sh',
      '-c',
      runnerCommand,
    ];

    const result = await runDockerCommand(this.config, args);
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

  private resolveTestRunner(framework: string, testCase: TestCase): string {
    const filter = testCase.input ? ` --filter ${JSON.stringify(testCase.input)}` : '';
    switch (framework.toLowerCase()) {
      case 'jest':
        return `cd /workspace/overlay && npm test -- --json${filter}`;
      case 'rtl':
      case 'react-testing-library':
        return `cd /workspace/overlay && npm test -- --json${filter}`;
      case 'phpunit':
      default:
        return `cd /workspace/overlay && ./vendor/bin/phpunit --log-json /workspace/results.json${filter} || cat /workspace/results.json`;
    }
  }
}
