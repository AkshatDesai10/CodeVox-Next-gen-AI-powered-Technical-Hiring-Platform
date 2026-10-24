import { Injectable } from '@nestjs/common';
import { JobProfilesRepository } from '../../job-profiles/job-profiles.repository';
import {
  JobProfileMysql,
  JobProfileStatus,
} from '../../job-profiles/entities/job-profile.mysql.entity';
import { RESUME_MATCH_ERROR } from './resume-screening.constants';

export type JobResolveOk = { ok: true; profile: JobProfileMysql };
export type JobResolveFail = {
  ok: false;
  reason: typeof RESUME_MATCH_ERROR.NO_JOB_PROFILE | typeof RESUME_MATCH_ERROR.AMBIGUOUS_JOB;
};
export type JobResolveResult = JobResolveOk | JobResolveFail;

@Injectable()
export class ResumeScreeningJobResolver {
  constructor(private readonly jobRepo: JobProfilesRepository) {}

  /**
   * Exact unique ACTIVE title match only (§5.1). No fuzzy / silent [0] fallback.
   */
  async resolve(input: {
    courses?: Array<{ course_id?: string; course_name?: string }>;
    jobProfileIdOverride?: string | null;
  }): Promise<JobResolveResult> {
    const overrideId = input.jobProfileIdOverride?.trim();
    if (overrideId) {
      const row = await this.jobRepo.findById(overrideId);
      if (
        row &&
        row.inactive === 0 &&
        row.status === JobProfileStatus.ACTIVE
      ) {
        return { ok: true, profile: row };
      }
    }

    const courseNames = (input.courses ?? [])
      .map((c) => (c.course_name ?? '').trim())
      .filter(Boolean);

    if (!courseNames.length) {
      return { ok: false, reason: RESUME_MATCH_ERROR.NO_JOB_PROFILE };
    }

    const [activeProfiles] = await this.jobRepo.listProfiles({
      status: JobProfileStatus.ACTIVE,
      limit: 5000,
      offset: 0,
    });

    const byTitle = new Map<string, JobProfileMysql>();
    for (const p of activeProfiles) {
      if (p.inactive !== 0) continue;
      const key = p.title.trim().toLowerCase();
      if (!key) continue;
      // Prefer first if duplicate titles somehow exist — still count as multi if courses hit different ids
      if (!byTitle.has(key)) byTitle.set(key, p);
    }

    const matchedIds = new Set<string>();
    const matched: JobProfileMysql[] = [];
    for (const name of courseNames) {
      const key = name.toLowerCase();
      const profile = byTitle.get(key);
      if (profile && !matchedIds.has(profile.id)) {
        matchedIds.add(profile.id);
        matched.push(profile);
      }
    }

    if (matched.length === 0) {
      return { ok: false, reason: RESUME_MATCH_ERROR.NO_JOB_PROFILE };
    }
    if (matched.length > 1) {
      return { ok: false, reason: RESUME_MATCH_ERROR.AMBIGUOUS_JOB };
    }
    return { ok: true, profile: matched[0]! };
  }
}
