import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { RecruitmentLeadOverlayMysql } from './entities/recruitment-lead-overlay.mysql.entity';
import { RecruitmentInterviewOverlayMysql } from './entities/recruitment-interview-overlay.mysql.entity';
import { RecruitmentInterviewTimeSlotMysql } from './entities/recruitment-interview-time-slot.mysql.entity';
import {
  RecruitmentActivityLogMysql,
  RecruitmentCommunicationLogMysql,
  RecruitmentInterviewStatusHistoryMysql,
  RecruitmentLeadInterviewLinkMysql,
} from './entities/recruitment-support.mysql.entity';

@Injectable()
export class RecruitmentRepository {
  constructor(
    @InjectRepository(RecruitmentLeadOverlayMysql)
    readonly leadOverlays: Repository<RecruitmentLeadOverlayMysql>,
    @InjectRepository(RecruitmentInterviewOverlayMysql)
    readonly interviewOverlays: Repository<RecruitmentInterviewOverlayMysql>,
    @InjectRepository(RecruitmentInterviewTimeSlotMysql)
    readonly timeSlots: Repository<RecruitmentInterviewTimeSlotMysql>,
    @InjectRepository(RecruitmentLeadInterviewLinkMysql)
    readonly links: Repository<RecruitmentLeadInterviewLinkMysql>,
    @InjectRepository(RecruitmentCommunicationLogMysql)
    readonly communications: Repository<RecruitmentCommunicationLogMysql>,
    @InjectRepository(RecruitmentActivityLogMysql)
    readonly activities: Repository<RecruitmentActivityLogMysql>,
    @InjectRepository(RecruitmentInterviewStatusHistoryMysql)
    readonly statusHistory: Repository<RecruitmentInterviewStatusHistoryMysql>,
  ) {}

  findLeadOverlay(leadId: string) {
    return this.leadOverlays.findOne({
      where: { leadId, inactive: 0 },
    });
  }

  findLeadOverlaysByIds(leadIds: string[]) {
    if (!leadIds.length) return Promise.resolve([]);
    return this.leadOverlays.find({
      where: { leadId: In(leadIds), inactive: 0 },
    });
  }

  upsertLeadOverlay(
    leadId: string,
    patch: Partial<RecruitmentLeadOverlayMysql>,
  ) {
    return this.leadOverlays.save(
      this.leadOverlays.create({
        leadId,
        ...patch,
        lastLocalActionAt: new Date(),
        inactive: 0,
      }),
    );
  }

  async mergeLeadOverlay(
    leadId: string,
    patch: Partial<RecruitmentLeadOverlayMysql>,
  ) {
    const existing = await this.findLeadOverlay(leadId);
    if (existing) {
      Object.assign(existing, patch, { lastLocalActionAt: new Date() });
      return this.leadOverlays.save(existing);
    }
    return this.upsertLeadOverlay(leadId, patch);
  }

  findInterviewOverlayByRefId(interviewRefId: string) {
    return this.interviewOverlays.findOne({
      where: { interviewRefId, inactive: 0 },
    });
  }

  findInterviewOverlayById(id: string) {
    return this.interviewOverlays.findOne({
      where: { id, inactive: 0 },
    });
  }

  findLocalInterviewsForLead(leadId: string) {
    return this.interviewOverlays.find({
      where: { leadId, inactive: 0 },
      order: { createdAt: 'DESC' },
    });
  }

  findLinksForLead(leadId: string) {
    return this.links.find({
      where: { leadId, inactive: 0 },
      order: { createdAt: 'DESC' },
    });
  }

  findManualLeadOverlays() {
    return this.leadOverlays
      .createQueryBuilder('o')
      .where('o.inactive = 0')
      .andWhere("o.lead_id LIKE 'manual_%'")
      .orderBy('o.created_at', 'DESC')
      .getMany();
  }

  /** Inbox candidates: manual + other local overlays (excludes app: demo keys). */
  findInboxLeadOverlays() {
    return this.leadOverlays
      .createQueryBuilder('o')
      .where('o.inactive = 0')
      .andWhere("o.lead_id NOT LIKE 'app:%'")
      .orderBy('o.created_at', 'DESC')
      .getMany();
  }

  logActivity(input: {
    leadId?: string;
    interviewRefId?: string;
    eventType: string;
    eventSummary: string;
    eventJson?: Record<string, unknown>;
    actorId?: string;
  }) {
    return this.activities.save(
      this.activities.create({
        leadId: input.leadId ?? null,
        interviewRefId: input.interviewRefId ?? null,
        eventType: input.eventType,
        eventSummary: input.eventSummary,
        eventJson: input.eventJson ?? null,
        actorId: input.actorId ?? null,
        inactive: 0,
      }),
    );
  }

  listActivitiesForLead(leadId: string, limit = 50) {
    return this.activities.find({
      where: { leadId, inactive: 0 },
      order: { occurredAt: 'DESC' },
      take: limit,
    });
  }

  listCommunicationsForLead(leadId: string) {
    return this.communications.find({
      where: { leadId, inactive: 0 },
      order: { sentAt: 'DESC' },
    });
  }

  recordStatusChange(input: {
    interviewOverlayId: string;
    fromStatus: string | null;
    toStatus: string;
    reason?: string;
    changedBy?: string;
  }) {
    return this.statusHistory.save(
      this.statusHistory.create({
        interviewOverlayId: input.interviewOverlayId,
        fromStatus: input.fromStatus,
        toStatus: input.toStatus,
        reason: input.reason ?? null,
        changedBy: input.changedBy ?? null,
        inactive: 0,
      }),
    );
  }

  listStatusHistory(interviewOverlayId: string) {
    return this.statusHistory.find({
      where: { interviewOverlayId, inactive: 0 },
      order: { changedAt: 'ASC' },
    });
  }
}
