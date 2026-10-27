import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfigurationMysql } from './entities/system-configuration.mysql.entity';
import {
  SYSTEM_CONFIG_META,
  looksMasked,
  maskSecret,
  metaFor,
  type ConfigMeta,
} from './system-config.keys';

export type EffectiveConfigItem = {
  key: string;
  category: ConfigMeta['category'];
  label: string;
  description: string;
  type: ConfigMeta['type'];
  options?: string[];
  min?: number;
  max?: number;
  secret: boolean;
  /** Effective value (masked when secret). */
  value: string;
  /** Whether a non-empty override exists in DB. */
  source: 'db' | 'env' | 'default';
  /** True when a secret is set (DB or env) even if value is masked. */
  is_set: boolean;
  updated_at: string | null;
  updated_by: string | null;
};

@Injectable()
export class DynamicConfigService implements OnModuleInit {
  private readonly logger = new Logger(DynamicConfigService.name);
  /** config_key → raw DB value (null/empty means “use env fallback”). */
  private readonly cache = new Map<string, string | null>();
  private readonly metaByKey = new Map(SYSTEM_CONFIG_META.map((m) => [m.key, m]));
  private rowMeta = new Map<string, { updatedAt: Date | null; updatedBy: string | null }>();

  constructor(
    @InjectRepository(SystemConfigurationMysql)
    private readonly repo: Repository<SystemConfigurationMysql>,
  ) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  async refreshCache() {
    const rows = await this.repo.find();
    this.cache.clear();
    this.rowMeta.clear();
    for (const row of rows) {
      this.cache.set(row.configKey, row.configValue);
      this.rowMeta.set(row.configKey, {
        updatedAt: row.updatedAt ?? null,
        updatedBy: row.updatedBy ?? null,
      });
    }
    this.logger.log(`Loaded ${rows.length} system configuration row(s)`);
  }

  /** Raw DB override only (null if missing/empty). */
  getDb(key: string): string | null {
    const raw = this.cache.get(key);
    if (raw == null) return null;
    const trimmed = String(raw).trim();
    return trimmed ? trimmed : null;
  }

  /**
   * Effective value: DB override → first non-empty env alias → default.
   * Sync — safe for hot paths (cache is in-memory).
   */
  get(key: string, fallbackEnvKeys?: string[], defaultValue = ''): string {
    const db = this.getDb(key);
    if (db != null) return db;

    const meta = this.metaByKey.get(key);
    const aliases = fallbackEnvKeys?.length
      ? fallbackEnvKeys
      : meta?.envAliases ?? [key];
    for (const envKey of aliases) {
      const v = process.env[envKey]?.trim();
      if (v) return v;
    }
    if (defaultValue) return defaultValue;
    return meta?.defaultValue ?? '';
  }

  isFaceEnabled(): boolean {
    const val = this.get('FACE', ['FACE', 'FACE_VERIFICATION'], 'on').toLowerCase();
    return val === 'on' || val === 'true' || val === '1' || val === 'yes';
  }

  identityMode(): 'face' | 'permissions_only' {
    return this.isFaceEnabled() ? 'face' : 'permissions_only';
  }

  getProctorMaxStrikes(): number {
    const n = Number(
      this.get('PROCTOR_MAX_STRIKES', ['PROCTOR_MAX_STRIKES', 'NEXT_PUBLIC_PROCTOR_MAX_STRIKES'], '5'),
    );
    if (!Number.isFinite(n) || n < 1) return 5;
    return Math.min(10, Math.floor(n));
  }

  isProctorAutoSubmit(): boolean {
    return (
      this.get(
        'PROCTOR_AUTO_SUBMIT',
        ['PROCTOR_AUTO_SUBMIT_ON_STRIKE', 'NEXT_PUBLIC_PROCTOR_AUTO_SUBMIT_ON_STRIKE'],
        'false',
      ).toLowerCase() === 'true'
    );
  }

  getProctorGraceSeconds(): number {
    const n = Number(
      this.get(
        'PROCTOR_GRACE_SECONDS',
        ['PROCTOR_GRACE_SECONDS', 'NEXT_PUBLIC_PROCTOR_GRACE_SECONDS'],
        '90',
      ),
    );
    if (!Number.isFinite(n) || n < 1) return 90;
    return Math.min(300, Math.max(30, Math.floor(n)));
  }

  getGeminiApiKey(): string {
    return this.get('GEMINI_API_KEY', ['TAKEHOME_LLM_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'], '');
  }

  getGeminiModel(): string {
    return this.get(
      'GEMINI_MODEL',
      ['TAKEHOME_LLM_MODEL', 'RECRUITMENT_GEMINI_MODEL', 'GEMINI_MODEL'],
      'gemini-3.6-flash',
    );
  }

  getReasoningEffort(): string {
    return this.get(
      'REASONING_EFFORT',
      ['TAKEHOME_LLM_REASONING_EFFORT', 'RECRUITMENT_GEMINI_REASONING_EFFORT'],
      'low',
    );
  }

  getMaxTokens(): number {
    const n = Number(
      this.get('MAX_TOKENS', ['TAKEHOME_LLM_MAX_TOKENS', 'OPENAI_MAX_TOKENS'], '16384'),
    );
    if (!Number.isFinite(n) || n < 256) return 16_384;
    return Math.min(65_536, Math.floor(n));
  }

  getAllEffective(): EffectiveConfigItem[] {
    return SYSTEM_CONFIG_META.map((meta) => {
      const db = this.getDb(meta.key);
      let source: 'db' | 'env' | 'default' = 'default';
      let raw = '';
      if (db != null) {
        raw = db;
        source = 'db';
      } else {
        let fromEnv = '';
        for (const envKey of meta.envAliases) {
          const v = process.env[envKey]?.trim();
          if (v) {
            fromEnv = v;
            break;
          }
        }
        if (fromEnv) {
          raw = fromEnv;
          source = 'env';
        } else {
          raw = meta.defaultValue;
          source = 'default';
        }
      }

      const isSet = Boolean(raw.trim());
      const row = this.rowMeta.get(meta.key);
      return {
        key: meta.key,
        category: meta.category,
        label: meta.label,
        description: meta.description,
        type: meta.type,
        options: meta.options,
        min: meta.min,
        max: meta.max,
        secret: Boolean(meta.secret),
        value: meta.secret ? (isSet ? maskSecret(raw) : '') : raw,
        source,
        is_set: isSet,
        updated_at: row?.updatedAt ? row.updatedAt.toISOString() : null,
        updated_by: row?.updatedBy ?? null,
      };
    });
  }

  getRuntimePublicConfig() {
    return {
      face: this.isFaceEnabled() ? ('on' as const) : ('off' as const),
      maxStrikes: this.getProctorMaxStrikes(),
      autoSubmitOnStrike: this.isProctorAutoSubmit(),
      graceSeconds: this.getProctorGraceSeconds(),
    };
  }

  async setMany(
    updates: Record<string, string | null | undefined>,
    actorId?: string | null,
  ): Promise<EffectiveConfigItem[]> {
    const entries = Object.entries(updates ?? {});
    for (const [key, rawValue] of entries) {
      const meta = metaFor(key);
      if (!meta) continue;

      // Skip masked secret re-submits (UI sends ••••abcd unchanged).
      if (meta.secret && typeof rawValue === 'string' && looksMasked(rawValue)) {
        continue;
      }

      let next: string | null =
        rawValue == null ? null : String(rawValue).trim() === '' ? null : String(rawValue).trim();

      if (next != null) {
        next = this.normalizeValue(meta, next);
      }

      if (next == null) {
        await this.repo.delete({ configKey: key });
        this.cache.set(key, null);
        this.rowMeta.delete(key);
        continue;
      }

      const existing = await this.repo.findOne({ where: { configKey: key } });
      const row =
        existing ??
        this.repo.create({
          configKey: key,
          configValue: next,
          updatedBy: actorId ?? null,
        });
      row.configValue = next;
      row.updatedBy = actorId ?? null;
      const saved = await this.repo.save(row);
      this.cache.set(key, saved.configValue);
      this.rowMeta.set(key, {
        updatedAt: saved.updatedAt ?? new Date(),
        updatedBy: saved.updatedBy ?? null,
      });
    }

    return this.getAllEffective();
  }

  private normalizeValue(meta: ConfigMeta, value: string): string {
    if (meta.type === 'boolean') {
      const v = value.toLowerCase();
      if (['1', 'true', 'yes', 'on'].includes(v)) return 'true';
      if (['0', 'false', 'no', 'off'].includes(v)) return 'false';
      return meta.defaultValue;
    }
    if (meta.type === 'enum' && meta.options?.length) {
      const match = meta.options.find((o) => o.toLowerCase() === value.toLowerCase());
      return match ?? meta.defaultValue;
    }
    if (meta.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) return meta.defaultValue;
      let clamped = n;
      if (meta.min != null) clamped = Math.max(meta.min, clamped);
      if (meta.max != null) clamped = Math.min(meta.max, clamped);
      // Keep pace as decimal string when needed.
      if (meta.key === 'SARVAM_TTS_PACE') return clamped.toFixed(2);
      return String(Math.round(clamped) === clamped ? Math.round(clamped) : clamped);
    }
    if (meta.key === 'FACE') {
      const v = value.toLowerCase();
      return ['on', 'true', '1', 'yes'].includes(v) ? 'on' : 'off';
    }
    return value;
  }
}
