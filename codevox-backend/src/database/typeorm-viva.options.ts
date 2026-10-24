import type { TypeOrmModuleOptions } from '@nestjs/typeorm';

export function buildVivaTypeOrmOptions(): TypeOrmModuleOptions {
  const host = (process.env.VIVA_MYSQL_HOST ?? '').trim();
  const user = (process.env.VIVA_MYSQL_USER ?? '').trim();
  const password = process.env.VIVA_MYSQL_PASSWORD ?? '';
  const database = (process.env.VIVA_MYSQL_DATABASE ?? '').trim();
  const port = Number(process.env.VIVA_MYSQL_PORT ?? 3306);
  const timezone =
    (process.env.VIVA_MYSQL_TIMEZONE ?? 'Z').trim() || 'Z';

  if (!host || !user || !database) {
    throw new Error(
      'Viva MySQL requires VIVA_MYSQL_HOST, VIVA_MYSQL_USER, VIVA_MYSQL_DATABASE',
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
    extra: {
      enableKeepAlive: true,
      keepAliveInitialDelay: 10000,
      connectTimeout: 20000,
      idleTimeout: 20000,
    },
  };
}
