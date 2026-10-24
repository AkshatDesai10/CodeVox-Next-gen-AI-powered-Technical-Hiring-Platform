import { spawn, type ChildProcess } from 'child_process';
import { appendCapped } from '../utils/output.util';

export type DockerRuntimeConfig = {
  dockerCommand: string;
  timeoutMs: number;
  memory: string;
  cpus: string;
  useShell: boolean;
};

export function resolveDockerCommand(): string {
  return process.env.ASSESSMENT_DOCKER_BIN?.trim() || 'docker';
}

export function defaultDockerRuntimeConfig(): DockerRuntimeConfig {
  return {
    dockerCommand: resolveDockerCommand(),
    timeoutMs: Number(process.env.ASSESSMENT_DOCKER_TIMEOUT_MS ?? 5000),
    memory: process.env.ASSESSMENT_DOCKER_MEMORY ?? '128m',
    cpus: process.env.ASSESSMENT_DOCKER_CPUS ?? '1',
    useShell: process.env.ASSESSMENT_DOCKER_USE_SHELL === 'true' && process.platform === 'win32',
  };
}

export function volumeMount(hostPath: string, mode: 'ro' | 'rw' = 'ro'): string {
  const normalized =
    process.platform === 'win32'
      ? hostPath.replace(/\\/g, '/')
      : hostPath;
  return `${normalized}:/workspace:${mode}`;
}

export function normalizeShellScript(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export async function fetchContainerLogs(
  config: DockerRuntimeConfig,
  containerId: string,
): Promise<string> {
  const result = await runDockerCommand(config, ['logs', containerId], undefined, {
    timeoutMs: Number(process.env.ASSESSMENT_DOCKER_LOG_TIMEOUT_MS ?? 15000),
  });
  return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
}

export async function isContainerRunning(
  config: DockerRuntimeConfig,
  containerId: string,
): Promise<boolean> {
  const result = await runDockerCommand(config, [
    'inspect',
    '-f',
    '{{.State.Running}}',
    containerId,
  ]);
  return result.success && result.stdout.trim() === 'true';
}

export function runDockerCommand(
  config: DockerRuntimeConfig,
  args: string[],
  stdin?: string,
  options?: { timeoutMs?: number },
): Promise<{
  stdout: string;
  stderr: string;
  executionTime: number;
  success: boolean;
  timedOut: boolean;
  exitCode: number | null;
}> {
  const started = Date.now();
  return new Promise((resolvePromise) => {
    const child = spawn(config.dockerCommand, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: config.useShell,
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let exitCode: number | null = null;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options?.timeoutMs ?? config.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendCapped(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendCapped(stderr, chunk.toString());
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolvePromise({
        stdout,
        stderr: err.message || 'Docker command failed',
        executionTime: Date.now() - started,
        success: false,
        timedOut,
        exitCode: null,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      exitCode = code;
      if (timedOut) {
        stderr = stderr || `Execution timed out after ${config.timeoutMs}ms`;
      }
      resolvePromise({
        stdout,
        stderr,
        executionTime: Date.now() - started,
        success: exitCode === 0 && !timedOut,
        timedOut,
        exitCode,
      });
    });

    if (stdin !== undefined && stdin.length > 0) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
}

export function spawnManagedProcess(
  config: DockerRuntimeConfig,
  args: string[],
): ChildProcess {
  return spawn(config.dockerCommand, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell: config.useShell,
    detached: false,
  });
}

export const ASSESSMENT_HTTP_HEALTH_PATH = '/.well-known/assessment-health';

export async function waitForPort(
  config: DockerRuntimeConfig,
  containerId: string,
  port: number,
  attempts = Number(process.env.ASSESSMENT_HTTP_READY_ATTEMPTS ?? 60),
  delayMs = Number(process.env.ASSESSMENT_HTTP_READY_DELAY_MS ?? 500),
): Promise<boolean> {
  const probeTimeoutMs = Number(process.env.ASSESSMENT_DOCKER_PROBE_TIMEOUT_MS ?? 15000);
  const healthUrl = `http://127.0.0.1:${port}${ASSESSMENT_HTTP_HEALTH_PATH}`;
  for (let i = 0; i < attempts; i += 1) {
    if (!(await isContainerRunning(config, containerId))) {
      return false;
    }
    const probe = await runDockerCommand(
      config,
      [
        'exec',
        containerId,
        'curl',
        '-sf',
        '--connect-timeout',
        '2',
        '--max-time',
        '3',
        healthUrl,
      ],
      undefined,
      { timeoutMs: probeTimeoutMs },
    );
    if (probe.success) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}
