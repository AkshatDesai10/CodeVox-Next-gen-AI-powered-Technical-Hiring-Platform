import { mkdtemp, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
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
  normalizeShellScript,
  runDockerCommand,
  volumeMount,
} from '../docker-runtime.util';
import {
  SQL_RUNNER_PY,
  buildSqlScript,
  SUPPORTED_EXECUTION_LANGUAGES,
} from '../../utils/sql-runner.util';
import {
  resolveNodeDockerImage,
  resolvePhpDockerImage,
  resolvePythonDockerImage,
  resolveSqlDockerImage,
} from '../docker-images.util';
import {
  assessmentDbEnvFlags,
  assessmentRedisEnvFlags,
  resolveScriptDockerNetwork,
  questionNeedsMysql,
  questionNeedsRedis,
  readSchemaSql,
  resolveAssessmentDbConfig,
  resolveAssessmentRedisConfig,
} from '../db-runtime.util';
import {
  dbConfigForSidecar,
  startMysqlSidecar,
  stopMysqlSidecar,
  type MysqlSidecarHandle,
} from '../mysql-sidecar.util';
import {
  redisConfigForSidecar,
  startRedisSidecar,
  stopRedisSidecar,
  type RedisSidecarHandle,
} from '../redis-sidecar.util';
import { writeWorkspaceFileToDisk } from '../../workspace/workspace-vfs.util';

type LanguageRuntime = {
  image: string;
  fileName: string;
  entryFile?: string;
  command: string[];
  commandPrefix?: string[];
  isSql?: boolean;
  needsMysql?: boolean;
  needsRedis?: boolean;
  dbHelperScript?: string;
};

export class ScriptStrategy implements ExecutionStrategy {
  readonly executionType = 'SCRIPT' as const;
  readonly resourceWeight = 'light' as const;

  private readonly config = defaultDockerRuntimeConfig();

  async prepare(submission: Submission, question: Question): Promise<PreparedRun> {
    const workDir = await mkdtemp(join(tmpdir(), 'assessment-script-'));
    const normalized = this.normalizeLanguage(submission.language);
    let runtime = this.resolveRuntime(normalized, question, submission.sourceCode);
    if (!runtime) {
      throw new Error(
        `Unsupported language: ${submission.language}. Supported: ${SUPPORTED_EXECUTION_LANGUAGES.join(', ')}.`,
      );
    }

    if (runtime.isSql) {
      await writeFile(join(workDir, 'query.sql'), buildSqlScript(submission.sourceCode), 'utf8');
      await writeFile(join(workDir, 'run_sql.py'), SQL_RUNNER_PY, 'utf8');
    } else {
      const entryFile = submission.entryFile ?? runtime.fileName;
      if (submission.vfsFiles) {
        for (const [path, content] of Object.entries(submission.vfsFiles)) {
          await writeWorkspaceFileToDisk(workDir, path, content);
        }
      } else {
        await writeWorkspaceFileToDisk(workDir, runtime.fileName, submission.sourceCode);
      }
      runtime = this.patchRuntimeEntry(runtime, entryFile);
      if (runtime.needsMysql || runtime.needsRedis) {
        const schemaSql = readSchemaSql(question);
        if (schemaSql) {
          await writeFile(join(workDir, 'schema.sql'), schemaSql, 'utf8');
        }
        await this.copyDbHelperScript(workDir, runtime.dbHelperScript ?? 'run-php-with-db.sh');
      }
    }

    let mysqlSidecar: MysqlSidecarHandle | null = null;
    let redisSidecar: RedisSidecarHandle | null = null;
    let dbConfig: ReturnType<typeof resolveAssessmentDbConfig> | null = null;
    let redisConfig: ReturnType<typeof resolveAssessmentRedisConfig> | null = null;
    if (runtime.needsMysql) {
      dbConfig = resolveAssessmentDbConfig(question, normalized);
      mysqlSidecar = await startMysqlSidecar(this.config, dbConfig);
      dbConfig = dbConfigForSidecar(dbConfig, mysqlSidecar);
    }
    if (runtime.needsRedis) {
      redisConfig = resolveAssessmentRedisConfig(question);
      redisSidecar = await startRedisSidecar(this.config, mysqlSidecar?.networkName);
      redisConfig = redisConfigForSidecar(redisConfig, redisSidecar);
    }

    return {
      workDir,
      strategyKey: 'SCRIPT',
      metadata: {
        runtime,
        language: normalized,
        dbConfig,
        redisConfig,
        mysqlSidecar,
        redisSidecar,
      },
    };
  }

  async execute(prepared: PreparedRun, testCase: TestCase): Promise<RawResult> {
    const runtime = prepared.metadata.runtime as LanguageRuntime;
    const dbConfig = prepared.metadata.dbConfig as ReturnType<
      typeof resolveAssessmentDbConfig
    > | null;
    const redisConfig = prepared.metadata.redisConfig as ReturnType<
      typeof resolveAssessmentRedisConfig
    > | null;
    const mysqlSidecar = prepared.metadata.mysqlSidecar as MysqlSidecarHandle | null | undefined;
    const redisSidecar = prepared.metadata.redisSidecar as RedisSidecarHandle | null | undefined;
    const sidecarNetwork = mysqlSidecar?.networkName ?? redisSidecar?.networkName;
    const args = [
      'run',
      '--rm',
      ...(resolveScriptDockerNetwork(sidecarNetwork, runtime.isSql)),
      '--memory',
      this.config.memory,
      '--cpus',
      this.config.cpus,
      '-v',
      volumeMount(resolve(prepared.workDir), runtime.isSql ? 'ro' : 'rw'),
      ...(dbConfig ? assessmentDbEnvFlags(dbConfig) : []),
      ...(redisConfig ? assessmentRedisEnvFlags(redisConfig) : []),
      ...(runtime.entryFile
        ? ['-e', `ASSESSMENT_ENTRY_FILE=${runtime.entryFile}`]
        : []),
      '-i',
      runtime.image,
      ...(runtime.commandPrefix ?? []),
      ...runtime.command,
    ];

    const stdin = runtime.isSql ? testCase.input : testCase.input || undefined;
    const result = await runDockerCommand(this.config, args, stdin);
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      executionTime: result.executionTime,
      success: result.success,
      timedOut: result.timedOut,
    };
  }

  async teardown(prepared: PreparedRun): Promise<void> {
    const mysqlSidecar = prepared.metadata.mysqlSidecar as MysqlSidecarHandle | null | undefined;
    const redisSidecar = prepared.metadata.redisSidecar as RedisSidecarHandle | null | undefined;
    if (redisSidecar) {
      await stopRedisSidecar(this.config, redisSidecar, { keepNetwork: !!mysqlSidecar });
    }
    if (mysqlSidecar) {
      await stopMysqlSidecar(this.config, mysqlSidecar);
    }
    const { rm } = await import('fs/promises');
    await rm(prepared.workDir, { recursive: true, force: true });
  }

  private normalizeLanguage(language: string) {
    const key = language.trim().toUpperCase();
    if (key === 'JS' || key === 'JAVASCRIPT' || key === 'NODE') return 'NODE';
    if (key === 'PY' || key === 'PYTHON') return 'PYTHON';
    if (key === 'PHP') return 'PHP';
    if (key === 'SQL') return 'SQL';
    return key;
  }

  private resolveRuntime(
    language: string,
    question: Question,
    sourceCode: string,
  ): LanguageRuntime | null {
    switch (language) {
      case 'PHP': {
        const needsMysql = questionNeedsMysql(question, sourceCode);
        const needsRedis = questionNeedsRedis(question, sourceCode);
        const needsRuntimeHelpers = needsMysql || needsRedis;
        return {
          image: resolvePhpDockerImage(),
          fileName: 'Main.php',
          command: needsRuntimeHelpers
            ? ['sh', '/workspace/run-php-with-db.sh']
            : ['/usr/local/bin/run.sh'],
          needsMysql,
          needsRedis,
          dbHelperScript: 'run-php-with-db.sh',
        };
      }
      case 'PYTHON':
        return {
          image: resolvePythonDockerImage(),
          fileName: 'main.py',
          command: ['/usr/local/bin/run.sh'],
        };
      case 'NODE': {
        const needsMysql = questionNeedsMysql(question, sourceCode);
        const needsRedis = questionNeedsRedis(question, sourceCode);
        const needsRuntimeHelpers = needsMysql || needsRedis;
        return {
          image: resolveNodeDockerImage(),
          fileName: 'main.js',
          command: needsRuntimeHelpers
            ? ['sh', '/workspace/run-node-with-db.sh']
            : ['/usr/local/bin/run.sh'],
          needsMysql,
          needsRedis,
          dbHelperScript: 'run-node-with-db.sh',
        };
      }
      case 'SQL':
        return {
          image: resolveSqlDockerImage(),
          fileName: 'query.sql',
          command: ['python', '/workspace/run_sql.py'],
          isSql: true,
        };
      default:
        return null;
    }
  }

  private async copyDbHelperScript(workDir: string, scriptName: string) {
    const candidates = [
      join(__dirname, '..', 'scripts', scriptName),
      join(process.cwd(), `dist/modules/assessment-execution/execution/scripts/${scriptName}`),
      join(process.cwd(), `src/modules/assessment-execution/execution/scripts/${scriptName}`),
    ];
    for (const sourcePath of candidates) {
      if (!existsSync(sourcePath)) continue;
      const contents = normalizeShellScript(await readFile(sourcePath, 'utf8'));
      await writeFile(join(workDir, scriptName), contents, { mode: 0o755 });
      return;
    }
    throw new Error(`${scriptName} not found in execution scripts assets`);
  }

  private patchRuntimeEntry(runtime: LanguageRuntime, entryFile: string): LanguageRuntime {
    if (runtime.isSql) return runtime;
    if (runtime.needsMysql || runtime.needsRedis) {
      const helper = runtime.dbHelperScript ?? 'run-php-with-db.sh';
      return { ...runtime, entryFile, command: ['sh', `/workspace/${helper}`] };
    }
    return { ...runtime, entryFile, command: ['/usr/local/bin/run.sh'] };
  }
}
