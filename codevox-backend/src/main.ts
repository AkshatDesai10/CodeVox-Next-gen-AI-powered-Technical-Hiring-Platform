import './load-env';
import cookieParser from 'cookie-parser';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { WsAdapter } from '@nestjs/platform-ws';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.useWebSocketAdapter(new WsAdapter(app));
  app.useBodyParser('json', { limit: '10mb' });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidUnknownValues: false,
    }),
  );

  const config = app.get(ConfigService);
  const configuredCorsOrigins =
    config.get<string>('CORS_ORIGIN') ??
    'http://localhost:3000,http://127.0.0.1:3000';
  const allowedOrigins = configuredCorsOrigins
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  // Always allow the local Next app in development so API calls
  // don't fail with opaque "Failed to fetch" when CORS_ORIGIN is incomplete.
  if ((config.get<string>('NODE_ENV') ?? 'development') !== 'production') {
    for (const origin of [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
    ]) {
      if (!allowedOrigins.includes(origin)) allowedOrigins.push(origin);
    }
  }

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const normalized = origin.replace(/\/$/, '');
      if (allowedOrigins.includes(normalized) || allowedOrigins.includes('*')) {
        callback(null, true);
        return;
      }
      callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Api-Key'],
    // So browser fetch() can read download filename (otherwise FE falls back to .zip).
    exposedHeaders: ['Content-Disposition', 'Content-Type', 'Content-Length'],
  });

  // Local LiveKit egress MP4s (docker mounts this folder to egress /out)
  const recordingsDir =
    config.get<string>('LIVEKIT_LOCAL_RECORDINGS_DIR')?.trim() ||
    join(process.cwd(), 'local-recordings');
  if (!existsSync(recordingsDir)) {
    mkdirSync(recordingsDir, { recursive: true });
  }
  app.useStaticAssets(recordingsDir, {
    prefix: '/local-recordings/',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    },
  });
  Logger.log(`Serving local interview recordings from ${recordingsDir}`, 'Bootstrap');

  // Local file uploads (replaces AWS S3 object storage)
  const uploadsDir =
    config.get<string>('LOCAL_UPLOADS_DIR')?.trim() ||
    join(process.cwd(), 'local-uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }
  app.useStaticAssets(uploadsDir, {
    prefix: '/local-uploads/',
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    },
  });
  Logger.log(`Serving local uploads from ${uploadsDir}`, 'Bootstrap');

  const port = config.get<number>('PORT') ?? 4000;
  await app.listen(port);
  Logger.log(
    `Recruitment Assessment backend listening on http://localhost:${port}`,
    'Bootstrap',
  );
}

bootstrap();
