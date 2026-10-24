import type { Question } from './execution-strategy';

export type AssessmentDbConfig = {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
};

export type AssessmentRedisConfig = {
  host: string;
  port: number;
};

const LOCAL_DB_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

/** Host for reaching MySQL from inside an assessment app container (sidecar DNS name). */
export const EMBEDDED_MYSQL_HOST = 'assessment-mysql';

const LANGUAGE_DEFAULT_DB: Record<string, string> = {
  NODE: 'node_assessment_db',
  PHP: 'php_assessment_db',
  PYTHON: 'python_assessment_db',
};

export function isSharedMysqlMode(): boolean {
  return String(process.env.ASSESSMENT_MYSQL_MODE ?? 'sidecar').trim().toLowerCase() === 'shared';
}

export function resolveSharedDockerNetwork(): string {
  return process.env.ASSESSMENT_DOCKER_NETWORK?.trim() || 'assessment_mesh';
}

export function resolveSharedMysqlHost(): string {
  return process.env.ASESSMENT_SHARED_MYSQL_HOST?.trim() || 'mysql_db';
}

export function resolveSharedDatabaseName(language: string, question: Question): string {
  const env = question.environmentConfig ?? {};
  const json = question.questionJson ?? {};
  const fromQuestion = env.dbName ?? json.dbName;
  if (fromQuestion != null && String(fromQuestion).trim()) {
    return String(fromQuestion).trim();
  }
  return LANGUAGE_DEFAULT_DB[language.trim().toUpperCase()] ?? 'testdb';
}
/** Host for reaching Redis from inside an assessment app container (sidecar DNS name). */
export const EMBEDDED_REDIS_HOST = 'assessment-redis';
export const DEFAULT_PDO_MYSQL_SOCKET = '/var/run/mysqld/mysqld.sock';

export function isLocalDbHost(rawHost: unknown): boolean {
  const host = String(rawHost ?? '127.0.0.1').trim().toLowerCase();
  return LOCAL_DB_HOSTS.has(host);
}

export function resolveAssessmentDbHost(rawHost: unknown): string {
  const host = String(rawHost ?? '127.0.0.1').trim();
  return isLocalDbHost(host) ? EMBEDDED_MYSQL_HOST : host;
}

export function readSchemaSql(question: Question): string | null {
  const env = question.environmentConfig ?? {};
  const json = question.questionJson ?? {};
  const candidates = [
    env.schemaSql,
    env.schema,
    json.schemaSql,
    json.schema,
    json.seedData,
    env.seedData,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const sql = (candidate as { sql?: unknown }).sql;
      if (Array.isArray(sql)) {
        const statements = sql
          .map((stmt) => (typeof stmt === 'string' ? stmt.trim() : ''))
          .filter(Boolean);
        if (statements.length) return statements.join(';\n');
      }
    }
  }

  return null;
}

export function questionNeedsMysql(question: Question, sourceCode?: string): boolean {
  if (readSchemaSql(question)) return true;
  const env = question.environmentConfig ?? {};
  const json = question.questionJson ?? {};
  if (
    env.dbName ??
    env.dbHost ??
    env.database ??
    json.dbName ??
    json.dbHost ??
    json.database
  ) {
    return true;
  }
  if (sourceCode && /\bPDO\s*\(|mysql:host=/i.test(sourceCode)) {
    return true;
  }
  if (sourceCode && /mysql2|createConnection|createPool/i.test(sourceCode)) {
    return true;
  }
  return false;
}

function readQuestionServices(question: Question): string[] {
  const env = question.environmentConfig ?? {};
  const json = question.questionJson ?? {};
  const raw = [...(Array.isArray(env.services) ? env.services : []), ...(Array.isArray(json.services) ? json.services : [])];
  return raw.map((service) => String(service).trim().toLowerCase()).filter(Boolean);
}

export function questionNeedsRedis(question: Question, sourceCode?: string): boolean {
  const env = question.environmentConfig ?? {};
  const json = question.questionJson ?? {};
  if (env.redisHost ?? json.redisHost) return true;
  if (readQuestionServices(question).includes('redis')) return true;
  if (sourceCode && /\bnew\s+Redis\s*\(|\bRedis\s*\(/i.test(sourceCode)) return true;
  return false;
}

export function resolveAssessmentRedisHost(rawHost: unknown): string {
  const host = String(rawHost ?? '127.0.0.1').trim();
  return isLocalDbHost(host) ? EMBEDDED_REDIS_HOST : host;
}

export function resolveAssessmentRedisConfig(question: Question): AssessmentRedisConfig {
  const env = question.environmentConfig ?? {};
  const json = question.questionJson ?? {};
  const rawHost = env.redisHost ?? json.redisHost ?? '127.0.0.1';
  const rawPort = env.redisPort ?? json.redisPort ?? 6379;
  return {
    host: resolveAssessmentRedisHost(rawHost),
    port: Number(rawPort) || 6379,
  };
}

export function assessmentRedisEnvFlags(config: AssessmentRedisConfig): string[] {
  return [
    '-e',
    `ASSESSMENT_REDIS_HOST=${config.host}`,
    '-e',
    `ASSESSMENT_REDIS_PORT=${String(config.port)}`,
  ];
}

export function resolveAssessmentDbConfig(
  question: Question,
  language?: string,
): AssessmentDbConfig {
  if (isSharedMysqlMode()) {
    return {
      host: resolveSharedMysqlHost(),
      port: 3306,
      name: language ? resolveSharedDatabaseName(language, question) : 'testdb',
      user: process.env.ASSESSMENT_SHARED_MYSQL_USER?.trim() || 'evaluator',
      password: process.env.ASSESSMENT_SHARED_MYSQL_PASSWORD?.trim() ?? '',
    };
  }

  const env = question.environmentConfig ?? {};
  const json = question.questionJson ?? {};
  const rawHost = env.dbHost ?? json.dbHost ?? '127.0.0.1';
  const rawPort = env.dbPort ?? json.dbPort ?? 3306;
  return {
    host: resolveAssessmentDbHost(rawHost),
    port: Number(rawPort) || 3306,
    name: String(env.dbName ?? json.dbName ?? 'testdb'),
    user: String(env.dbUser ?? json.dbUser ?? 'root'),
    password: String(env.dbPassword ?? json.dbPassword ?? ''),
  };
}

export function assessmentDbEnvFlags(config: AssessmentDbConfig): string[] {
  return [
    '-e',
    `ASSESSMENT_DB_HOST=${config.host}`,
    '-e',
    `ASSESSMENT_DB_PORT=${String(config.port)}`,
    '-e',
    `ASSESSMENT_DB_NAME=${config.name}`,
    '-e',
    `ASSESSMENT_DB_USER=${config.user}`,
    '-e',
    `ASSESSMENT_DB_PASSWORD=${config.password}`,
    '-e',
    `PDO_MYSQL_SOCKET=${DEFAULT_PDO_MYSQL_SOCKET}`,
  ];
}

export const dockerHostGatewayFlags = ['--add-host', 'host.docker.internal:host-gateway'] as const;

export function dockerNetworkFlags(networkName: string): string[] {
  return ['--network', networkName];
}

/**
 * Docker network for script runners (NODE/PYTHON/PHP).
 * `--network none` blocks pip/npm/composer; use bridge or assessment_mesh unless explicitly disabled.
 */
export function resolveScriptDockerNetwork(
  sidecarNetwork?: string | null,
  isSql?: boolean,
): string[] {
  if (isSql) {
    return sidecarNetwork ? dockerNetworkFlags(sidecarNetwork) : ['--network', 'none'];
  }
  if (sidecarNetwork) {
    return dockerNetworkFlags(sidecarNetwork);
  }

  const configured = process.env.ASSESSMENT_SCRIPT_NETWORK?.trim();
  if (configured) {
    return configured.toLowerCase() === 'none'
      ? ['--network', 'none']
      : dockerNetworkFlags(configured);
  }

  if (isSharedMysqlMode()) {
    return dockerNetworkFlags(resolveSharedDockerNetwork());
  }

  return ['--network', 'bridge'];
}
