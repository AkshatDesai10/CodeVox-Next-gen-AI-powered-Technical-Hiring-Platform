import type { DockerRuntimeConfig } from './docker-runtime.util';
import { runDockerCommand } from './docker-runtime.util';
import { EMBEDDED_REDIS_HOST, type AssessmentRedisConfig } from './db-runtime.util';

export const DEFAULT_REDIS_SIDECAR_IMAGE = 'redis:7-alpine';

export function resolveRedisSidecarImage(): string {
  return process.env.ASSESSMENT_DOCKER_IMAGE_REDIS ?? DEFAULT_REDIS_SIDECAR_IMAGE;
}

export type RedisSidecarHandle = {
  networkName: string;
  containerName: string;
  containerId: string;
  redisHost: string;
  ownsNetwork: boolean;
};

export async function startRedisSidecar(
  config: DockerRuntimeConfig,
  networkName?: string,
): Promise<RedisSidecarHandle> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  let network = networkName;
  let ownsNetwork = false;

  if (!network) {
    network = `assessment-net-${suffix}`;
    const created = await runDockerCommand(config, ['network', 'create', network]);
    if (!created.success) {
      throw new Error(created.stderr || 'Failed to create assessment Docker network for Redis');
    }
    ownsNetwork = true;
  }

  const containerName = `assessment-redis-${suffix}`;
  const started = await runDockerCommand(config, [
    'run',
    '-d',
    '--name',
    containerName,
    '--network',
    network,
    '--network-alias',
    EMBEDDED_REDIS_HOST,
    '--memory',
    process.env.ASSESSMENT_DOCKER_REDIS_MEMORY ?? '128m',
    resolveRedisSidecarImage(),
  ]);

  if (!started.success) {
    if (ownsNetwork) await runDockerCommand(config, ['network', 'rm', network]);
    throw new Error(started.stderr || 'Failed to start Redis sidecar container');
  }

  const handle: RedisSidecarHandle = {
    networkName: network,
    containerName,
    containerId: started.stdout.trim(),
    redisHost: EMBEDDED_REDIS_HOST,
    ownsNetwork,
  };

  const ready = await waitForRedisSidecar(config, handle);
  if (!ready) {
    await stopRedisSidecar(config, handle);
    throw new Error('Redis sidecar did not become ready in time');
  }

  return handle;
}

export async function waitForRedisSidecar(
  config: DockerRuntimeConfig,
  handle: RedisSidecarHandle,
  attempts = Number(process.env.ASSESSMENT_REDIS_READY_ATTEMPTS ?? 30),
  delayMs = Number(process.env.ASSESSMENT_REDIS_READY_DELAY_MS ?? 300),
): Promise<boolean> {
  for (let i = 0; i < attempts; i += 1) {
    const probe = await runDockerCommand(config, [
      'exec',
      handle.containerName,
      'redis-cli',
      'ping',
    ]);
    if (probe.success && /PONG/i.test(probe.stdout)) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  }
  return false;
}

export async function stopRedisSidecar(
  config: DockerRuntimeConfig,
  handle: RedisSidecarHandle,
  options?: { keepNetwork?: boolean },
): Promise<void> {
  await runDockerCommand(config, ['rm', '-f', handle.containerId || handle.containerName]);
  if (handle.ownsNetwork && !options?.keepNetwork) {
    await runDockerCommand(config, ['network', 'rm', handle.networkName]);
  }
}

export function redisConfigForSidecar(
  redisConfig: AssessmentRedisConfig,
  sidecar: RedisSidecarHandle,
): AssessmentRedisConfig {
  return {
    ...redisConfig,
    host: sidecar.redisHost,
    port: 6379,
  };
}
