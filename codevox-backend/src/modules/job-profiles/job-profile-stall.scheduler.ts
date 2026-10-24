import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JobApplicationMysql, JobApplicationStatus } from './entities/job-application.mysql.entity';
import { JobProfileMysql } from './entities/job-profile.mysql.entity';
import { JobProfileStallAlertMysql } from './entities/job-profile-stall-alert.mysql.entity';
import type { NotificationConfig } from './job-profiles-phase2.util';

@Injectable()
export class JobProfileStallScheduler {
  private readonly logger = new Logger(JobProfileStallScheduler.name);

  constructor(
    @InjectRepository(JobApplicationMysql)
    private readonly applications: Repository<JobApplicationMysql>,
    @InjectRepository(JobProfileMysql)
    private readonly profiles: Repository<JobProfileMysql>,
    @InjectRepository(JobProfileStallAlertMysql)
    private readonly alerts: Repository<JobProfileStallAlertMysql>,
  ) {}

  @Cron('0 8 * * *')
  async detectStalledApplications() {
    const activeApps = await this.applications.find({
      where: { inactive: 0, status: JobApplicationStatus.IN_PROGRESS },
    });
    let created = 0;
    for (const app of activeApps) {
      const profile = await this.profiles.findOne({
        where: { id: app.jobProfileId, inactive: 0 },
      });
      const cfg = (profile?.notificationConfig ?? {}) as NotificationConfig;
      const threshold = cfg.stall_days_threshold ?? 7;
      const ref = app.stageEnteredAt ?? app.updatedAt ?? app.appliedAt;
      const days = Math.floor((Date.now() - ref.getTime()) / 86400000);
      if (days < threshold) continue;

      const existing = await this.alerts.findOne({
        where: {
          jobApplicationId: app.id,
          inactive: 0,
        },
        order: { notifiedAt: 'DESC' },
      });
      if (existing && days - existing.stallDays < 1) continue;

      await this.alerts.save(
        this.alerts.create({
          jobApplicationId: app.id,
          jobProfileId: app.jobProfileId,
          stallDays: days,
          inactive: 0,
        }),
      );
      created += 1;
      this.logger.log(
        `Stall alert: application ${app.id} on profile ${app.jobProfileId} (${days} days)`,
      );
    }
    if (created) {
      this.logger.log(`Created ${created} stall alert(s)`);
    }
  }
}
