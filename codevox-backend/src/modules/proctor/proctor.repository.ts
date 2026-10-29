import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  InterviewProctorEventMysql,
  InterviewProctorSessionType,
  InterviewProctorSeverity,
} from './entities/interview-proctor-event.mysql.entity';
import {
  resolveProctorStrikeConfig,
  isFocusStrikeEvent,
  isMediaStrikeEvent,
} from './proctor-env.config';
import {
  computeFraudRiskScore,
  ProctorEventInput,
  ProctorSummary,
} from './proctor.types';
import { DynamicConfigService } from '../system-config/dynamic-config.service';

/** Dedupe window for (sessionToken, eventType, clientTs) retries. */
const DEDUPE_WINDOW_MS = 30_000;

@Injectable()
export class ProctorRepository {
  constructor(
    @InjectRepository(InterviewProctorEventMysql)
    private readonly events: Repository<InterviewProctorEventMysql>,
    private readonly dynamicConfig: DynamicConfigService,
  ) {}

  private strikeConfig() {
    return resolveProctorStrikeConfig((key, fallback = '') =>
      this.dynamicConfig.getSync(key, fallback),
    );
  }

  async insertBatch(
    sessionToken: string,
    sessionType: InterviewProctorSessionType,
    items: ProctorEventInput[],
  ) {
    if (!items.length) return [];

    const withTs = items.filter((item) => item.client_ts != null);
    const existingKeys = new Set<string>();
    if (withTs.length) {
      const types = [...new Set(withTs.map((i) => i.type))];
      const clientTsValues = [...new Set(withTs.map((i) => String(i.client_ts)))];
      const recent = await this.events.find({
        where: {
          sessionToken,
          sessionType,
          eventType: In(types),
          clientTs: In(clientTsValues),
        },
        order: { createdAt: 'DESC' },
        take: 200,
      });
      const cutoff = Date.now() - DEDUPE_WINDOW_MS;
      for (const row of recent) {
        if (row.createdAt.getTime() >= cutoff && row.clientTs) {
          existingKeys.add(`${row.eventType}|${row.clientTs}`);
        }
      }
    }

    const toInsert = items.filter((item) => {
      if (item.client_ts == null) return true;
      const key = `${item.type}|${item.client_ts}`;
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });

    if (!toInsert.length) return [];

    const rows = toInsert.map((item) =>
      this.events.create({
        sessionToken,
        sessionType,
        eventType: item.type,
        severity: item.severity as InterviewProctorSeverity,
        payload: item.payload ?? null,
        clientTs: item.client_ts != null ? String(item.client_ts) : null,
      }),
    );
    return this.events.save(rows);
  }

  listBySession(
    sessionToken: string,
    sessionType: InterviewProctorSessionType,
    limit = 500,
  ) {
    return this.events.find({
      where: { sessionToken, sessionType },
      order: { createdAt: 'ASC' },
      take: limit,
    });
  }

  async buildSummary(
    sessionToken: string,
    sessionType: InterviewProctorSessionType,
    options?: { currentRoundType?: string | null },
  ): Promise<ProctorSummary> {
    const rows = await this.listBySession(sessionToken, sessionType, 2000);
    const by_type: Record<string, number> = {};
    let critical_count = 0;
    let warning_count = 0;
    let last_event_at: string | null = null;
    let media_strike_count = 0;
    let focus_strike_count = 0;
    let roundMedia = 0;
    let roundFocus = 0;
    const currentRound = options?.currentRoundType?.trim() || null;

    for (const row of rows) {
      by_type[row.eventType] = (by_type[row.eventType] ?? 0) + 1;
      if (row.severity === InterviewProctorSeverity.CRITICAL) critical_count += 1;
      if (row.severity === InterviewProctorSeverity.WARNING) warning_count += 1;
      last_event_at = row.createdAt.toISOString();

      const payload = (row.payload ?? {}) as Record<string, unknown>;
      const eventRound =
        typeof payload.round_type === 'string'
          ? payload.round_type
          : typeof payload.phase === 'string'
            ? payload.phase
            : null;

      const cfg = this.strikeConfig();
      const isMedia = cfg.enableMediaStrikes && isMediaStrikeEvent(row.eventType);
      const isFocus = cfg.enableFocusStrikes && isFocusStrikeEvent(row.eventType);
      if (isMedia) media_strike_count += 1;
      if (isFocus) focus_strike_count += 1;

      if (currentRound && eventRound === currentRound) {
        if (isMedia) roundMedia += 1;
        if (isFocus) roundFocus += 1;
      } else if (!currentRound) {
        if (isMedia) roundMedia += 1;
        if (isFocus) roundFocus += 1;
      }
    }

    const summary: ProctorSummary = {
      total_events: rows.length,
      by_type,
      critical_count,
      warning_count,
      last_event_at,
      media_strike_count,
      focus_strike_count,
      current_round_type: currentRound,
      current_round_strikes: {
        round_type: currentRound,
        media_strikes: roundMedia,
        focus_strikes: roundFocus,
      },
    };
    summary.fraud_risk_score = computeFraudRiskScore(summary);
    return summary;
  }
}
