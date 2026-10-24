import { existsSync } from 'fs';
import { mkdtemp, readFile, writeFile } from 'fs/promises';
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
  fetchContainerLogs,
  isContainerRunning,
  normalizeShellScript,
  runDockerCommand,
  volumeMount,
  waitForPort,
} from '../docker-runtime.util';
import {
  adaptPhpSourceForAssessment,
  parseHttpTestCaseInputForExecution,
  readHttpDefaultsFromQuestion,
  readPhpRunnerBootstrap,
  readNodeRunnerBootstrap,
  serializeRequestForRunner,
  serializeStdinPayloadForRunner,
  splitPathAndQuery,
  type PhpAssessmentRequest,
} from '../../utils/php-assessment-adapter';
import { writeWorkspaceFileToDisk } from '../../workspace/workspace-vfs.util';
import {
  resolveNodeDockerImage,
  resolvePhpDockerImage,
} from '../docker-images.util';
import {
  assessmentDbEnvFlags,
  assessmentRedisEnvFlags,
  dockerNetworkFlags,
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

const HTTP_PORT = 8080;
const HTTP_CONTAINER_MEMORY = process.env.ASSESSMENT_DOCKER_HTTP_MEMORY ?? '512m';

export class HttpServiceStrategy implements ExecutionStrategy {
  readonly executionType = 'HTTP_SERVICE' as const;
  readonly resourceWeight = 'medium' as const;

  private readonly config = defaultDockerRuntimeConfig();

  async prepare(submission: Submission, question: Question): Promise<PreparedRun> {
    const workDir = await mkdtemp(join(tmpdir(), 'assessment-http-'));
    const lang = submission.language.trim().toUpperCase();
    const entryFile =
      submission.entryFile ?? (lang === 'PHP' ? 'Main.php' : lang === 'NODE' ? 'index.js' : 'Main.php');

    if (submission.vfsFiles) {
      for (const [path, content] of Object.entries(submission.vfsFiles)) {
        const adapted =
          lang === 'PHP' && path === entryFile ? adaptPhpSourceForAssessment(content) : content;
        await writeWorkspaceFileToDisk(workDir, path, adapted);
      }
    } else {
      const source = adaptPhpSourceForAssessment(submission.sourceCode);
      await writeWorkspaceFileToDisk(workDir, entryFile, source);
    }
    await writeFile(join(workDir, 'php_runner_bootstrap.php'), readPhpRunnerBootstrap(), 'utf8');
    if (lang === 'NODE') {
      await writeFile(join(workDir, 'node_runner_bootstrap.js'), readNodeRunnerBootstrap(), 'utf8');
    }

    const schemaSql = readSchemaSql(question);
    if (schemaSql) {
      await writeFile(join(workDir, 'schema.sql'), schemaSql, 'utf8');
    }

    const bootScript = normalizeShellScript(await readBootHttpServiceScript());
    await writeFile(join(workDir, 'boot-http-service.sh'), bootScript, { mode: 0o755 });

    const image = lang === 'NODE' ? resolveNodeDockerImage() : resolvePhpDockerImage();

    const containerName = `assessment-http-${Date.now()}`;
    const hostPath = resolve(workDir);
    const needsMysql = questionNeedsMysql(question, submission.sourceCode);
    const needsRedis = questionNeedsRedis(question, submission.sourceCode);
    let mysqlSidecar: MysqlSidecarHandle | null = null;
    let redisSidecar: RedisSidecarHandle | null = null;
    let dbConfig = resolveAssessmentDbConfig(question, lang);
    let redisConfig = resolveAssessmentRedisConfig(question);

    if (needsMysql) {
      mysqlSidecar = await startMysqlSidecar(this.config, dbConfig);
      dbConfig = dbConfigForSidecar(dbConfig, mysqlSidecar);
    }
    if (needsRedis) {
      redisSidecar = await startRedisSidecar(this.config, mysqlSidecar?.networkName);
      redisConfig = redisConfigForSidecar(redisConfig, redisSidecar);
    }

    const sidecarNetwork = mysqlSidecar?.networkName ?? redisSidecar?.networkName;

    const startArgs = [
      'run',
      '-d',
      '--name',
      containerName,
      ...(sidecarNetwork ? dockerNetworkFlags(sidecarNetwork) : []),
      '--memory',
      HTTP_CONTAINER_MEMORY,
      '--cpus',
      this.config.cpus,
      '-v',
      volumeMount(hostPath, 'rw'),
      ...(needsMysql ? assessmentDbEnvFlags(dbConfig) : []),
      ...(needsRedis ? assessmentRedisEnvFlags(redisConfig) : []),
      ...(lang === 'NODE' ? ['-e', 'ASSESSMENT_HTTP_RUNTIME=node'] : []),
      image,
      'sh',
      '/workspace/boot-http-service.sh',
    ];

    const started = await runDockerCommand(this.config, startArgs);
    if (!started.success) {
      if (redisSidecar) await stopRedisSidecar(this.config, redisSidecar, { keepNetwork: !!mysqlSidecar });
      if (mysqlSidecar) await stopMysqlSidecar(this.config, mysqlSidecar);
      throw new Error(started.stderr || 'Failed to start HTTP service container');
    }

    const containerRef = containerName;
    const ready = await waitForPort(this.config, containerRef, HTTP_PORT);
    if (!ready) {
      const logs = await fetchContainerLogs(this.config, containerRef);
      const running = await isContainerRunning(this.config, containerRef);
      await this.stopContainer(containerRef);
      if (redisSidecar) await stopRedisSidecar(this.config, redisSidecar, { keepNetwork: !!mysqlSidecar });
      if (mysqlSidecar) await stopMysqlSidecar(this.config, mysqlSidecar);
      const detail = logs ? `\nContainer logs:\n${logs}` : '';
      throw new Error(
        `HTTP service did not become ready on port ${HTTP_PORT} (running=${running})${detail}`,
      );
    }

    return {
      workDir,
      strategyKey: 'HTTP_SERVICE',
      metadata: {
        containerName: containerRef,
        image,
        language: lang,
        port: HTTP_PORT,
        mysqlSidecar,
        redisSidecar,
        httpDefaults: readHttpDefaultsFromQuestion(question),
      },
    };
  }

  async execute(prepared: PreparedRun, testCase: TestCase): Promise<RawResult> {
    const containerRef = String(prepared.metadata.containerName ?? prepared.metadata.containerId);
    const httpDefaults = prepared.metadata.httpDefaults as ReturnType<
      typeof readHttpDefaultsFromQuestion
    >;
    const request = parseHttpTestCaseInputForExecution(testCase.input, httpDefaults);

    if (!request) {
      return {
        stdout: '',
        stderr: 'Invalid HTTP test case input',
        executionTime: 0,
        success: false,
      };
    }

    await writeFile(
      join(prepared.workDir, 'request.json'),
      serializeRequestForRunner(request),
      'utf8',
    );

    await writeFile(
      join(prepared.workDir, 'test-input.txt'),
      serializeStdinPayloadForRunner(testCase.input, request),
      'utf8',
    );

    await writeFile(
      join(prepared.workDir, 'run-http-request.sh'),
      normalizeShellScript(buildCurlShellScript(request, HTTP_PORT)),
      { mode: 0o755 },
    );

    const started = Date.now();

    if (!(await isContainerRunning(this.config, containerRef))) {
      const logs = await fetchContainerLogs(this.config, containerRef);
      return {
        stdout: '',
        stderr: `HTTP service container is not running.\n${logs}`,
        executionTime: 0,
        success: false,
      };
    }

    const ready = await waitForPort(this.config, containerRef, HTTP_PORT, 20, 300);
    if (!ready) {
      const logs = await fetchContainerLogs(this.config, containerRef);
      return {
        stdout: '',
        stderr: `HTTP service not listening on port ${HTTP_PORT}.\n${logs}`,
        executionTime: Date.now() - started,
        success: false,
      };
    }

    const result = await runHttpRequestWithRetry(this.config, containerRef);

    let stderr = result.stderr;
    if (!result.success && /Failed to connect|Could not connect/i.test(stderr)) {
      const logs = await fetchHttpServiceDiagnostics(this.config, containerRef);
      if (logs) stderr = `${stderr}\n${logs}`;
    }

    const { body, statusCode } = splitCurlResponse(result.stdout);
    return {
      stdout: body,
      stderr,
      statusCode,
      executionTime: Date.now() - started,
      success: result.success && statusCode > 0,
      timedOut: result.timedOut,
    };
  }

  async teardown(prepared: PreparedRun): Promise<void> {
    const containerRef = String(
      prepared.metadata.containerName ?? prepared.metadata.containerId ?? '',
    );
    if (containerRef) {
      await this.stopContainer(containerRef);
    }
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

  private async stopContainer(containerId: string) {
    await runDockerCommand(this.config, ['rm', '-f', containerId]);
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runHttpRequestWithRetry(
  config: ReturnType<typeof defaultDockerRuntimeConfig>,
  containerRef: string,
) {
  const attempts = Number(process.env.ASSESSMENT_HTTP_CURL_ATTEMPTS ?? 3);
  const delayMs = Number(process.env.ASSESSMENT_HTTP_CURL_RETRY_DELAY_MS ?? 250);
  const timeoutMs = Number(process.env.ASSESSMENT_DOCKER_HTTP_EXEC_TIMEOUT_MS ?? 30000);
  let last = {
    stdout: '',
    stderr: '',
    executionTime: 0,
    success: false,
    timedOut: false,
    exitCode: 1 as number | null,
  };

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    last = await runDockerCommand(
      config,
      ['exec', containerRef, 'sh', '/workspace/run-http-request.sh'],
      undefined,
      { timeoutMs },
    );
    if (last.success || !/Failed to connect|Could not connect/i.test(last.stderr)) {
      return last;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  }

  return last;
}

async function fetchHttpServiceDiagnostics(
  config: ReturnType<typeof defaultDockerRuntimeConfig>,
  containerRef: string,
): Promise<string> {
  const parts: string[] = [];
  const running = await isContainerRunning(config, containerRef);
  parts.push(`Container running: ${running}`);

  const bootLog = await runDockerCommand(
    config,
    ['exec', containerRef, 'sh', '-c', 'test -f /workspace/php-server.log && cat /workspace/php-server.log || true'],
    undefined,
    { timeoutMs: Number(process.env.ASSESSMENT_DOCKER_LOG_TIMEOUT_MS ?? 15000) },
  );
  if (bootLog.stdout.trim()) {
    parts.push(`php-server.log:\n${bootLog.stdout.trim()}`);
  }

  const logs = await fetchContainerLogs(config, containerRef);
  if (logs) parts.push(`Container logs:\n${logs}`);
  return parts.join('\n');
}

function buildCurlShellScript(request: PhpAssessmentRequest, port: number): string {
  const url = buildRequestUrl(port, request);
  const headerArgs = Object.entries(request.headers)
    .map(([name, value]) => `-H ${shellQuote(`${name}: ${value}`)}`)
    .join(' ');
  const bodyArg =
    request.body && request.method !== 'GET' && request.method !== 'DELETE'
      ? `-d ${shellQuote(request.body)}`
      : '';

  return `#!/bin/sh
set -e
curl -sS -X ${shellQuote(request.method)} ${headerArgs}${bodyArg ? ` ${bodyArg}` : ''} -w ${shellQuote('\\n__STATUS__:%{http_code}')} ${shellQuote(url)}
`;
}

function buildRequestUrl(port: number, request: PhpAssessmentRequest): string {
  const { path, query: embeddedQuery } = splitPathAndQuery(request.path);
  const mergedQuery = { ...embeddedQuery, ...request.query };
  let url = `http://127.0.0.1:${port}${path}`;
  const qs = new URLSearchParams(mergedQuery).toString();
  if (qs && !url.includes('?')) {
    url += `?${qs}`;
  }
  return url;
}

function splitCurlResponse(stdout: string): { body: string; statusCode: number } {
  const marker = '\n__STATUS__:';
  const index = stdout.lastIndexOf(marker);
  if (index === -1) {
    return { body: stdout.trim(), statusCode: 0 };
  }
  const body = stdout.slice(0, index).trim();
  const statusCode = Number(stdout.slice(index + marker.length).trim()) || 0;
  return { body, statusCode };
}

function readBootHttpServiceScript(): Promise<string> {
  const candidates = [
    join(__dirname, '..', 'scripts', 'boot-http-service.sh'),
    join(process.cwd(), 'dist/modules/assessment-execution/execution/scripts/boot-http-service.sh'),
    join(process.cwd(), 'src/modules/assessment-execution/execution/scripts/boot-http-service.sh'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return readFile(candidate, 'utf8');
    }
  }
  return Promise.reject(new Error('boot-http-service.sh not found in execution scripts assets'));
}
