import type { DockerRuntimeConfig } from './docker-runtime.util';
import { runDockerCommand } from './docker-runtime.util';
import {
  EMBEDDED_MYSQL_HOST,
  isSharedMysqlMode,
  resolveSharedDockerNetwork,
  resolveSharedMysqlHost,
  type AssessmentDbConfig,
} from './db-runtime.util';

export const DEFAULT_MYSQL_SIDECAR_IMAGE = 'mariadb:11';

export function resolveMysqlSidecarImage(): string {
  return process.env.ASSESSMENT_DOCKER_IMAGE_MYSQL ?? DEFAULT_MYSQL_SIDECAR_IMAGE;
}

export type MysqlSidecarHandle = {
  networkName: string;
  containerName: string;
  containerId: string;
  dbHost: string;
};

export async function startMysqlSidecar(
  config: DockerRuntimeConfig,
  dbConfig: AssessmentDbConfig,
): Promise<MysqlSidecarHandle> {
  if (isSharedMysqlMode()) {
    return {
      networkName: resolveSharedDockerNetwork(),
      containerName: '',
      containerId: '',
      dbHost: resolveSharedMysqlHost(),
    };
  }

  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const networkName = `assessment-net-${suffix}`;
  const containerName = `assessment-mysql-${suffix}`;

  const network = await runDockerCommand(config, ['network', 'create', networkName]);
  if (!network.success) {
    throw new Error(network.stderr || 'Failed to create assessment Docker network');
  }

  const mysqlEnv = dbConfig.password
    ? [
        '-e',
        `MARIADB_ROOT_PASSWORD=${dbConfig.password}`,
        '-e',
        `MARIADB_DATABASE=${dbConfig.name}`,
      ]
    : [
        '-e',
        'MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=yes',
        '-e',
        `MARIADB_DATABASE=${dbConfig.name}`,
      ];

  const started = await runDockerCommand(config, [
    'run',
    '-d',
    '--name',
    containerName,
    '--network',
    networkName,
    '--network-alias',
    EMBEDDED_MYSQL_HOST,
    '--memory',
    process.env.ASSESSMENT_DOCKER_MYSQL_MEMORY ?? '256m',
    ...mysqlEnv,
    resolveMysqlSidecarImage(),
  ]);

  if (!started.success) {
    await runDockerCommand(config, ['network', 'rm', networkName]);
    throw new Error(started.stderr || 'Failed to start MySQL sidecar container');
  }

  const containerId = started.stdout.trim();
  const handle: MysqlSidecarHandle = {
    networkName,
    containerName,
    containerId,
    dbHost: EMBEDDED_MYSQL_HOST,
  };

  const ready = await waitForMysqlSidecar(config, handle, dbConfig);
  if (!ready) {
    await stopMysqlSidecar(config, handle);
    throw new Error('MySQL sidecar did not become ready in time');
  }

  return handle;
}

export async function waitForMysqlSidecar(
  config: DockerRuntimeConfig,
  handle: MysqlSidecarHandle,
  dbConfig: AssessmentDbConfig,
  attempts = Number(process.env.ASSESSMENT_MYSQL_READY_ATTEMPTS ?? 40),
  delayMs = Number(process.env.ASSESSMENT_MYSQL_READY_DELAY_MS ?? 500),
): Promise<boolean> {
  const pingArgs = dbConfig.password
    ? ['mariadb-admin', 'ping', '-h', '127.0.0.1', '-uroot', `-p${dbConfig.password}`]
    : ['mariadb-admin', 'ping', '-h', '127.0.0.1', '-uroot'];

  for (let i = 0; i < attempts; i += 1) {
    const probe = await runDockerCommand(config, [
      'exec',
      handle.containerId,
      ...pingArgs,
    ]);
    if (probe.success) return true;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, delayMs));
  }
  return false;
}

export async function stopMysqlSidecar(
  config: DockerRuntimeConfig,
  handle: MysqlSidecarHandle,
): Promise<void> {
  if (isSharedMysqlMode() || (!handle.containerId && !handle.containerName)) {
    return;
  }
  await runDockerCommand(config, ['rm', '-f', handle.containerId || handle.containerName]);
  if (!isSharedMysqlMode()) {
    await runDockerCommand(config, ['network', 'rm', handle.networkName]);
  }
}

export function dbConfigForSidecar(
  dbConfig: AssessmentDbConfig,
  sidecar: MysqlSidecarHandle,
): AssessmentDbConfig {
  return {
    ...dbConfig,
    host: sidecar.dbHost,
    port: 3306,
  };
}
