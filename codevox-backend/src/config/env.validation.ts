import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().optional().default(4000),
  CORS_ORIGIN: z.string().optional(),
  LOG_LEVEL: z.string().optional(),
  RBAC_BYPASS: z.string().optional(),
  /** Role `key` assigned to newly auto-provisioned local users (default: admin). */
  RBAC_DEFAULT_ROLE_KEY: z.string().optional(),

  RECRUITMENT_MYSQL_HOST: z.string().optional(),
  RECRUITMENT_MYSQL_PORT: z.coerce.number().optional().default(3306),
  RECRUITMENT_MYSQL_USER: z.string().optional(),
  RECRUITMENT_MYSQL_PASSWORD: z.string().optional(),
  RECRUITMENT_MYSQL_DATABASE: z.string().optional(),
  RECRUITMENT_MYSQL_TIMEZONE: z.string().optional().default('Z'),
  VIVA_MYSQL_HOST: z.string().optional(),
  VIVA_MYSQL_PORT: z.coerce.number().optional(),
  VIVA_MYSQL_USER: z.string().optional(),
  VIVA_MYSQL_PASSWORD: z.string().optional(),
  VIVA_MYSQL_DATABASE: z.string().optional(),
  VIVA_MYSQL_TIMEZONE: z.string().optional(),
  TYPEORM_LOGGING: z.string().optional(),

  /** Shared static bearer for admin API (default: local-dev-token). */
  LOCAL_AUTH_TOKEN: z.string().optional(),
  LOCAL_AUTH_EMAIL: z.string().optional(),
  LOCAL_AUTH_NAME: z.string().optional(),
  LOCAL_AUTH_ADMNO: z.string().optional(),

  REDIS_URL: z.string().optional(),
  REDIS_ENABLED: z.string().optional(),

  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  VOICE_ENGINE_URL: z.string().optional(),
  AUTONOMOUS_INTERVIEW_SERVICE_KEY: z.string().optional(),

  OPENAI_API_KEY: z.string().optional(),

  /** Local file uploads root (default: ./local-uploads). */
  LOCAL_UPLOADS_DIR: z.string().optional(),
  PUBLIC_API_BASE_URL: z.string().optional(),
});

export type RecruitmentEnv = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): RecruitmentEnv {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const msg = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid Recruitment env: ${msg}`);
  }

  const data = parsed.data;
  const host = data.RECRUITMENT_MYSQL_HOST ?? data.VIVA_MYSQL_HOST;
  const user = data.RECRUITMENT_MYSQL_USER ?? data.VIVA_MYSQL_USER;
  const database = data.RECRUITMENT_MYSQL_DATABASE ?? data.VIVA_MYSQL_DATABASE;
  if (!host || !user || !database) {
    throw new Error(
      'Recruitment MySQL requires RECRUITMENT_MYSQL_* or VIVA_MYSQL_* host/user/database',
    );
  }

  return data;
}
