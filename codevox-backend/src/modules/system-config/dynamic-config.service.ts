import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SystemConfigurationMysql } from './entities/system-configuration.mysql.entity';
import { SystemConfigurationLogMysql } from './entities/system-configuration-log.mysql.entity';
import {
  envFallbackValue,
  getConfigDef,
  isFaceEnabledValue,
  looksMasked,
  maskSecret,
  parseBooleanConfig,
  SYSTEM_CONFIG_DEFS,
  SYSTEM_CONFIG_KEY_SET,
  type SystemConfigDef,
} from './system-config.keys';

export type EffectiveConfigItem = {
  key: string;
  category: SystemConfigDef['category'];
  label: string;
  description: string;
  type: SystemConfigDef['type'];
  secret: boolean;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  /** Effective value (secrets masked). */
  value: string;
  /** True when DB row supplies the value. */
  source: 'db' | 'env' | 'default';
  hasDbValue: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type CandidateRuntimeConfig = {
  face: 'on' | 'off';
  graceSeconds: number;
  enableMediaStrikes: boolean;
  maxMediaStrikes: number;
  autoSubmitOnMediaStrike: boolean;
  enableFocusStrikes: boolean;
  maxFocusStrikes: number;
  autoSubmitOnFocusStrike: boolean;
  focusStrikeThresholdSeconds: number;
  /** @deprecated Prefer maxMediaStrikes — kept for older clients. */
  maxStrikes: number;
  /** @deprecated Prefer autoSubmitOnMediaStrike — kept for older clients. */
  autoSubmitOnStrike: boolean;
};

export type ConfigChangeLogItem = {
  id: string;
  key: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
  changedBy: string | null;
  createdAt: string;
};

type CacheEntry = { value: string | null; updatedBy: string | null; updatedAt: Date | null };

const CACHE_TTL_MS = 30_000;

@Injectable()
export class DynamicConfigService implements OnModuleInit {
  private readonly logger = new Logger(DynamicConfigService.name);
  private cache = new Map<string, CacheEntry>();
  private cacheLoadedAt = 0;
  private loading: Promise<void> | null = null;

  constructor(
    @InjectRepository(SystemConfigurationMysql)
    private readonly repo: Repository<SystemConfigurationMysql>,
    @InjectRepository(SystemConfigurationLogMysql)
    private readonly logs: Repository<SystemConfigurationLogMysql>,
  ) {}

  async onModuleInit() {
    try {
      await this.refreshCache();
    } catch (err) {
      this.logger.warn(
        `system_configurations cache warm failed (table may be missing until migration): ${
          err instanceof Error ? err.message : err
        }`,
      );
    }
  }

  /** Sync read from in-memory cache → env → default (no DB round-trip). */
  getSync(key: string, fallback = ''): string {
    const def = getConfigDef(key);
    const cached = this.cache.get(key);
    if (cached && cached.value != null && String(cached.value).trim() !== '') {
      return String(cached.value).trim();
    }
    if (def) {
      const fromEnv = envFallbackValue(def);
      if (fromEnv) return fromEnv;
      if (fallback !== '') return fallback;
      return def.defaultValue ?? '';
    }
    if (fallback !== '') return fallback;
    return (process.env[key] ?? '').trim();
  }

  /** Raw effective value: DB → env → default. Secrets returned unmasked. */
  async get(key: string, fallback?: string): Promise<string> {
    await this.ensureCache();
    return this.getSync(key, fallback ?? '');
  }

  async getNumber(key: string, fallback: number): Promise<number> {
    const raw = await this.get(key, String(fallback));
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  async getBoolean(key: string, fallback = false): Promise<boolean> {
    const raw = await this.get(key, fallback ? 'true' : 'false');
    if (!raw) return fallback;
    return parseBooleanConfig(raw);
  }

  async isFaceVerificationEnabled(): Promise<boolean> {
    const raw = await this.get('FACE', 'on');
    return isFaceEnabledValue(raw);
  }

  async getCandidateRuntimeConfig(): Promise<CandidateRuntimeConfig> {
    const faceOn = await this.isFaceVerificationEnabled();

    let graceSeconds = await this.getNumber('PROCTOR_GRACE_SECONDS', 90);
    if (graceSeconds < 30 || graceSeconds > 300) graceSeconds = 90;
    graceSeconds = Math.floor(graceSeconds);

    const enableMediaStrikes = await this.getBoolean('PROCTOR_ENABLE_MEDIA_STRIKES', false);
    let maxMediaStrikes = await this.getNumber('PROCTOR_MAX_MEDIA_STRIKES', 5);
    if (maxMediaStrikes < 1 || maxMediaStrikes > 10) maxMediaStrikes = 5;
    maxMediaStrikes = Math.floor(maxMediaStrikes);
    const autoSubmitOnMediaStrike = await this.getBoolean(
      'PROCTOR_AUTO_SUBMIT_ON_MEDIA_STRIKE',
      false,
    );

    const enableFocusStrikes = await this.getBoolean('PROCTOR_ENABLE_FOCUS_STRIKES', false);
    let maxFocusStrikes = await this.getNumber('PROCTOR_MAX_FOCUS_STRIKES', 5);
    if (maxFocusStrikes < 1 || maxFocusStrikes > 10) maxFocusStrikes = 5;
    maxFocusStrikes = Math.floor(maxFocusStrikes);
    const autoSubmitOnFocusStrike = await this.getBoolean(
      'PROCTOR_AUTO_SUBMIT_ON_FOCUS_STRIKE',
      false,
    );

    let focusStrikeThresholdSeconds = await this.getNumber(
      'PROCTOR_FOCUS_STRIKE_THRESHOLD_SECONDS',
      5,
    );
    if (focusStrikeThresholdSeconds < 1 || focusStrikeThresholdSeconds > 60) {
      focusStrikeThresholdSeconds = 5;
    }
    focusStrikeThresholdSeconds = Math.floor(focusStrikeThresholdSeconds);

    return {
      face: faceOn ? 'on' : 'off',
      graceSeconds,
      enableMediaStrikes,
      maxMediaStrikes,
      autoSubmitOnMediaStrike,
      enableFocusStrikes,
      maxFocusStrikes,
      autoSubmitOnFocusStrike,
      focusStrikeThresholdSeconds,
      maxStrikes: maxMediaStrikes,
      autoSubmitOnStrike: autoSubmitOnMediaStrike,
    };
  }

  async getAllEffective(): Promise<EffectiveConfigItem[]> {
    await this.ensureCache();
    return SYSTEM_CONFIG_DEFS.map((def) => this.toEffectiveItem(def));
  }

  async getRecentChangeLogs(limit = 40): Promise<ConfigChangeLogItem[]> {
    const take = Math.min(Math.max(1, Math.floor(limit)), 100);
    const rows = await this.logs.find({
      order: { createdAt: 'DESC', id: 'DESC' },
      take,
    });
    return rows.map((row) => {
      const def = getConfigDef(row.key);
      return {
        id: String(row.id),
        key: row.key,
        label: def?.label ?? row.key,
        oldValue: this.displayLogValue(row.key, row.oldValue),
        newValue: this.displayLogValue(row.key, row.newValue),
        changedBy: row.changedBy,
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  /**
   * Upsert many keys. Empty string clears DB (revert to env).
   * Masked secret payloads are ignored (keep existing).
   */
  async setMany(
    records: Record<string, string | null | undefined>,
    actor?: string | null,
  ): Promise<EffectiveConfigItem[]> {
    await this.ensureCache();
    const updates: Array<{ key: string; value: string | null }> = [];

    for (const [key, raw] of Object.entries(records)) {
      if (!SYSTEM_CONFIG_KEY_SET.has(key)) {
        throw new Error(`Unknown configuration key: ${key}`);
      }
      const def = getConfigDef(key)!;
      if (raw == null) continue;

      const trimmed = String(raw).trim();
      if (def.secret && looksMasked(trimmed)) {
        continue;
      }

      if (trimmed === '') {
        updates.push({ key, value: null });
        continue;
      }

      const normalized = this.validateAndNormalize(def, trimmed);
      updates.push({ key, value: normalized });
    }

    const actorName = actor?.trim() || null;
    const logRows: SystemConfigurationLogMysql[] = [];

    for (const u of updates) {
      const previousDb = this.cache.get(u.key)?.value ?? null;
      const previousEffective = await this.get(u.key, '');
      const oldForLog = previousDb != null && String(previousDb).trim() !== ''
        ? String(previousDb).trim()
        : previousEffective || null;

      if (u.value == null) {
        await this.repo.delete({ key: u.key });
        this.cache.delete(u.key);
        this.mirrorEnv(u.key, null);
      } else {
        await this.repo.save(
          this.repo.create({
            key: u.key,
            value: u.value,
            updatedBy: actorName,
          }),
        );
        this.cache.set(u.key, {
          value: u.value,
          updatedBy: actorName,
          updatedAt: new Date(),
        });
        this.mirrorEnv(u.key, u.value);
      }

      const nextStored = u.value;
      if ((oldForLog ?? '') === (nextStored ?? '')) continue;

      logRows.push(
        this.logs.create({
          key: u.key,
          oldValue: this.persistLogValue(u.key, oldForLog),
          newValue: this.persistLogValue(u.key, nextStored),
          changedBy: actorName,
        }),
      );
    }

    if (logRows.length) {
      await this.logs.save(logRows);
    }

    this.cacheLoadedAt = Date.now();
    this.logger.log(
      `system config updated keys=${updates.map((u) => u.key).join(',') || '(none)'} by=${actorName ?? 'unknown'}`,
    );
    return this.getAllEffective();
  }

  /** Secrets are masked before writing to the audit table. */
  private persistLogValue(key: string, value: string | null): string | null {
    if (value == null || value === '') return null;
    const def = getConfigDef(key);
    if (def?.secret) return maskSecret(value);
    return value;
  }

  private displayLogValue(key: string, value: string | null): string | null {
    if (value == null || value === '') return null;
    const def = getConfigDef(key);
    if (def?.secret) return maskSecret(value);
    return value;
  }

  private toEffectiveItem(def: SystemConfigDef): EffectiveConfigItem {
    const cached = this.cache.get(def.key);
    const hasDb =
      cached != null && cached.value != null && String(cached.value).trim() !== '';
    let source: EffectiveConfigItem['source'] = 'default';
    let effective = def.defaultValue ?? '';
    if (hasDb) {
      effective = String(cached!.value).trim();
      source = 'db';
    } else {
      const fromEnv = envFallbackValue(def);
      if (fromEnv) {
        effective = fromEnv;
        source = 'env';
      }
    }

    return {
      key: def.key,
      category: def.category,
      label: def.label,
      description: def.description,
      type: def.type,
      secret: Boolean(def.secret),
      options: def.options,
      min: def.min,
      max: def.max,
      step: def.step,
      value: def.secret ? maskSecret(effective) : effective,
      source,
      hasDbValue: hasDb,
      updatedBy: hasDb ? cached?.updatedBy ?? null : null,
      updatedAt: hasDb && cached?.updatedAt ? cached.updatedAt.toISOString() : null,
    };
  }

  private validateAndNormalize(def: SystemConfigDef, value: string): string {
    if (def.type === 'enum' && def.options?.length) {
      const lower = value.toLowerCase();
      const match = def.options.find((o) => o.toLowerCase() === lower);
      if (!match) {
        // Allow custom model ids for GEMINI_MODEL beyond the dropdown.
        if (def.key === 'GEMINI_MODEL' && /^[a-z0-9._:-]+$/i.test(value)) return value.trim();
        throw new Error(`${def.key} must be one of: ${def.options.join(', ')}`);
      }
      return match;
    }
    if (def.type === 'boolean') {
      return parseBooleanConfig(value) ? 'true' : 'false';
    }
    if (def.type === 'number') {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`${def.key} must be a number`);
      if (def.min != null && n < def.min) throw new Error(`${def.key} must be ≥ ${def.min}`);
      if (def.max != null && n > def.max) throw new Error(`${def.key} must be ≤ ${def.max}`);
      if (def.key === 'SARVAM_TTS_PACE') return n.toFixed(2);
      return String(Math.trunc(n) === n ? Math.trunc(n) : n);
    }
    if (def.secret && value.length < 8) {
      throw new Error(`${def.key} looks too short to be a valid API key`);
    }
    return value;
  }

  /** Keep process.env mirrors in sync for same-process readers & dual env names. */
  private mirrorEnv(logicalKey: string, value: string | null) {
    const def = getConfigDef(logicalKey);
    if (!def) return;
    // Only mirror the primary env name (avoid shared aliases like PROCTOR_ENABLE_STRIKES).
    const primary =
      def.envFallbacks.find((n) => n === logicalKey) ||
      def.envFallbacks.find((n) => !n.startsWith('NEXT_PUBLIC_'));
    if (!primary) return;
    if (value == null || value === '') return;
    process.env[primary] = value;
  }

  private async ensureCache() {
    if (Date.now() - this.cacheLoadedAt < CACHE_TTL_MS && this.cacheLoadedAt > 0) return;
    if (this.loading) {
      await this.loading;
      return;
    }
    this.loading = this.refreshCache().finally(() => {
      this.loading = null;
    });
    await this.loading;
  }

  private async refreshCache() {
    const rows = await this.repo.find();
    const next = new Map<string, CacheEntry>();
    for (const row of rows) {
      next.set(row.key, {
        value: row.value,
        updatedBy: row.updatedBy,
        updatedAt: row.updatedAt ?? null,
      });
      if (row.value != null && String(row.value).trim() !== '') {
        this.mirrorEnv(row.key, String(row.value).trim());
      }
    }
    this.cache = next;
    this.cacheLoadedAt = Date.now();
  }
}
