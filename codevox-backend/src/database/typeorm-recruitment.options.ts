import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function buildRecruitmentTypeOrmOptions(): TypeOrmModuleOptions {
  const host = (process.env.RECRUITMENT_MYSQL_HOST ?? process.env.VIVA_MYSQL_HOST ?? '').trim();
  const user = (process.env.RECRUITMENT_MYSQL_USER ?? process.env.VIVA_MYSQL_USER ?? '').trim();
  const password =
    process.env.RECRUITMENT_MYSQL_PASSWORD ?? process.env.VIVA_MYSQL_PASSWORD ?? '';
  const database = (
    process.env.RECRUITMENT_MYSQL_DATABASE ??
    process.env.VIVA_MYSQL_DATABASE ??
    ''
  ).trim();
  const port = Number(
    process.env.RECRUITMENT_MYSQL_PORT ?? process.env.VIVA_MYSQL_PORT ?? 3306,
  );
  const timezone =
    (process.env.RECRUITMENT_MYSQL_TIMEZONE ?? process.env.VIVA_MYSQL_TIMEZONE ?? 'Z').trim() ||
    'Z';

  if (!host || !user || !database) {
    throw new Error(
      'Recruitment MySQL requires RECRUITMENT_MYSQL_HOST, RECRUITMENT_MYSQL_USER, RECRUITMENT_MYSQL_DATABASE',
    );
  }

  return {
    type: 'mysql',
    host,
    port: Number.isFinite(port) ? port : 3306,
    username: user,
    password,
    database,
    autoLoadEntities: true,
    synchronize: false,
    timezone,
    logging: ['1', 'true', 'yes'].includes(
      (process.env.TYPEORM_LOGGING ?? '').toLowerCase(),
    ),
    extra: mysqlPoolExtra(),
  };
}

/** Drop idle sockets before a remote MySQL or NAT closes them with ECONNRESET. */
function mysqlPoolExtra(): Record<string, number | boolean> {
  return {
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    connectTimeout: 20000,
    idleTimeout: 20000,
  };
}
