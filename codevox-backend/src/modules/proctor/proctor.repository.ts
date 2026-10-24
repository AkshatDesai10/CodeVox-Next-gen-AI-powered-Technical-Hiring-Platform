import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  InterviewProctorEventMysql,
  InterviewProctorSessionType,
  InterviewProctorSeverity,
} from './entities/interview-proctor-event.mysql.entity';
import {
  computeFraudRiskScore,
  ProctorEventInput,
  ProctorSummary,
} from './proctor.types';

@Injectable()
export class ProctorRepository {
  constructor(
    @InjectRepository(InterviewProctorEventMysql)
    private readonly events: Repository<InterviewProctorEventMysql>,
  ) {}

  async insertBatch(
    sessionToken: string,
    sessionType: InterviewProctorSessionType,
    items: ProctorEventInput[],
  ) {
    if (!items.length) return [];
    const rows = items.map((item) =>
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
  ): Promise<ProctorSummary> {
    const rows = await this.listBySession(sessionToken, sessionType, 2000);
    const by_type: Record<string, number> = {};
    let critical_count = 0;
    let warning_count = 0;
    let last_event_at: string | null = null;

    for (const row of rows) {
      by_type[row.eventType] = (by_type[row.eventType] ?? 0) + 1;
      if (row.severity === InterviewProctorSeverity.CRITICAL) critical_count += 1;
      if (row.severity === InterviewProctorSeverity.WARNING) warning_count += 1;
      last_event_at = row.createdAt.toISOString();
    }

    const summary: ProctorSummary = {
      total_events: rows.length,
      by_type,
      critical_count,
      warning_count,
      last_event_at,
    };
    summary.fraud_risk_score = computeFraudRiskScore(summary);
    return summary;
  }
}
