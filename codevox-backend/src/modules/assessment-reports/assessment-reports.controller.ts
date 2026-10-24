import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../common/decorators/require-permission.decorator';
import { AssessmentReportsService } from './assessment-reports.service';
import type { AssessmentReportsListFilters } from './assessment-reports.types';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/assessment-reports')
@UseGuards(JwtAuthGuard)
export class AssessmentReportsController {
  constructor(private readonly reports: AssessmentReportsService) {}

  @Get()
  @RequirePermissions('job_profiles:read')
  async list(
    @Query('q') q?: string,
    @Query('jobProfileId') jobProfileId?: string,
    @Query('stageType') stageType?: string,
    @Query('status') status?: string,
    @Query('minScore') minScore?: string,
    @Query('maxScore') maxScore?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('windowDays') windowDays?: string,
    @Query('windowField') windowField?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('sortBy') sortBy?: string,
  ) {
    const filters: AssessmentReportsListFilters = {
      q,
      jobProfileId,
      stageType,
      status,
      minScore: minScore != null && minScore !== '' ? Number(minScore) : undefined,
      maxScore: maxScore != null && maxScore !== '' ? Number(maxScore) : undefined,
      page: page != null ? Number(page) : undefined,
      pageSize: pageSize != null ? Number(pageSize) : undefined,
      windowDays: windowDays != null && windowDays !== '' ? Number(windowDays) : undefined,
      windowField:
        windowField === 'updatedAt' || windowField === 'appliedAt' ? windowField : undefined,
      startDate: startDate?.trim() || undefined,
      endDate: endDate?.trim() || undefined,
      sortBy:
        sortBy === 'score' || sortBy === 'recent' || sortBy === 'name' ? sortBy : undefined,
    };
    return ok('Assessment reports', await this.reports.list(filters));
  }

  @Get('summary')
  @RequirePermissions('job_profiles:read')
  async summary(
    @Query('q') q?: string,
    @Query('jobProfileId') jobProfileId?: string,
    @Query('stageType') stageType?: string,
    @Query('status') status?: string,
    @Query('minScore') minScore?: string,
    @Query('maxScore') maxScore?: string,
    @Query('windowDays') windowDays?: string,
    @Query('windowField') windowField?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const filters: AssessmentReportsListFilters = {
      q,
      jobProfileId,
      stageType,
      status,
      minScore: minScore != null && minScore !== '' ? Number(minScore) : undefined,
      maxScore: maxScore != null && maxScore !== '' ? Number(maxScore) : undefined,
      windowDays: windowDays != null && windowDays !== '' ? Number(windowDays) : undefined,
      windowField:
        windowField === 'updatedAt' || windowField === 'appliedAt' ? windowField : undefined,
      startDate: startDate?.trim() || undefined,
      endDate: endDate?.trim() || undefined,
    };
    return ok('Assessment reports summary', await this.reports.summary(filters));
  }

  @Get('stats/bulk')
  @RequirePermissions('job_profiles:read')
  async bulkStats(@Query('ids') ids?: string) {
    const profileIds = ids ? ids.split(',').filter(Boolean) : [];
    return ok('Bulk profiles stats', await this.reports.getProfilesStats(profileIds));
  }

  @Get(':applicationId')
  @RequirePermissions('job_profiles:read')
  async detail(@Param('applicationId') applicationId: string) {
    return ok('Assessment report', await this.reports.getDetail(applicationId));
  }

  @Post(':applicationId/integrity-override')
  @RequirePermissions('job_profiles:read')
  async integrityOverride(
    @Param('applicationId') applicationId: string,
    @Body() body: { action: 'disqualify' | 'allow_retake'; note?: string },
  ) {
    return ok(
      'Integrity override updated',
      await this.reports.applyIntegrityOverride({
        applicationId,
        action: body.action,
        note: body.note,
      }),
    );
  }

  @Post(':applicationId/overall-evaluation')
  @RequirePermissions('job_profiles:read')
  async regenerateOverallEvaluation(
    @Param('applicationId') applicationId: string,
    @Body() body?: { force?: boolean },
  ) {
    return ok(
      'Overall evaluation',
      await this.reports.ensureOverallEvaluationForApplication(applicationId, {
        force: body?.force !== false,
      }),
    );
  }
}
