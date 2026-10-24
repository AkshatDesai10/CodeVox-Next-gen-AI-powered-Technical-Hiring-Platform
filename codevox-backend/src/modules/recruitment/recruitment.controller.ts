import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UploadedFile,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import { RecruitmentService } from './recruitment.service';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/recruitment')
export class RecruitmentController {
  constructor(private readonly service: RecruitmentService) {}

  @Post('leads')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async listLeads(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return ok('Leads listed', await this.service.listLeads(user, body as never));
  }

  @Post('leads/stage-counts')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async leadStageCounts(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return ok(
      'Lead stage counts',
      await this.service.getLeadInboxStageCounts(user, body as never),
    );
  }

  @Post('leads/batch-invite')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async batchInviteLeads(
    @CurrentUser() user: JwtUserPayload,
    @Body()
    body: {
      lead_ids?: string[];
      job_profile_id?: string;
      min_score?: number;
    },
  ) {
    return ok(
      'Batch invite processed',
      await this.service.batchInviteLeads(user, body),
    );
  }

  @Get('leads/:leadId')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async getLead(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
  ) {
    return ok('Lead detail', await this.service.getLead(user, leadId));
  }

  @Patch('leads/:leadId/overlay')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async updateLeadOverlay(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return ok(
      'Lead overlay updated',
      await this.service.updateLeadOverlay(user, leadId, body as never),
    );
  }

  @Post('leads/:leadId/schedule-interview')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async scheduleInterview(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return ok(
      'Interview scheduled locally',
      await this.service.scheduleLocalInterview(user, leadId, body as never),
    );
  }

  @Post('leads/:leadId/start-ai-interview')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async startAiInterview(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
    @Body() body?: { job_profile_id?: string },
  ) {
    return ok(
      'AI interview started',
      await this.service.startAiInterview(user, leadId, body),
    );
  }

  @Post('candidates/bulk')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  @UseInterceptors(
    FilesInterceptor('resumes', 50, {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async bulkCreateCandidates(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: { job_profile_id?: string },
    @UploadedFiles() resumes?: Express.Multer.File[],
  ) {
    return ok(
      'Bulk candidates created',
      await this.service.bulkCreateCandidates(user, body, resumes ?? []),
    );
  }

  @Post('candidates')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  @UseInterceptors(
    FileInterceptor('resume', {
      storage: memoryStorage(),
      limits: { fileSize: 8 * 1024 * 1024 },
    }),
  )
  async createManualCandidate(
    @CurrentUser() user: JwtUserPayload,
    @Body()
    body: {
      name?: string;
      email?: string;
      job_profile_id?: string;
    },
    @UploadedFile() resume?: Express.Multer.File,
  ) {
    return ok(
      'Candidate created and magic link sent',
      await this.service.createManualCandidate(user, body, resume),
    );
  }

  @Post('leads/:leadId/invite')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async inviteLead(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
  ) {
    return ok(
      'Lead invite processed',
      await this.service.inviteLeadToAssessment(user, leadId),
    );
  }

  @Post('leads/:leadId/ai-score')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async aiScore(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
    @Body() body?: { course_name?: string },
  ) {
    return ok(
      'AI score computed',
      await this.service.scoreLeadAi(user, leadId, body?.course_name),
    );
  }

  @Post('leads/:leadId/ai-qualification')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async aiQualification(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
    @Body() body?: { course_name?: string },
  ) {
    return ok(
      'AI qualification computed',
      await this.service.qualifyLeadAi(user, leadId, body?.course_name),
    );
  }

  @Post('leads/:leadId/parse-resume')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async parseResume(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
  ) {
    return ok('Resume parsed', await this.service.parseResume(user, leadId));
  }

  @Get('leads/:leadId/resume-screen')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async getResumeScreen(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
  ) {
    return ok(
      'Resume screen result',
      await this.service.getResumeScreen(user, leadId),
    );
  }

  @Post('leads/:leadId/resume-screen')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async rerunResumeScreen(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
  ) {
    return ok(
      'Resume screen queued',
      await this.service.rerunResumeScreen(user, leadId),
    );
  }

  @Post('leads/:leadId/reminder')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async sendReminder(
    @CurrentUser() user: JwtUserPayload,
    @Param('leadId') leadId: string,
    @Body() body: { channel: string; message: string; subject?: string },
  ) {
    return ok('Reminder logged', await this.service.sendReminder(user, leadId, body));
  }

  @Post('interviews')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async listInterviews(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: Record<string, unknown>,
  ) {
    return ok(
      'Interviews listed',
      await this.service.listInterviews(user, body as never),
    );
  }

  @Get('interviews/today')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async todayInterviews(@CurrentUser() user: JwtUserPayload) {
    return ok("Today's interviews", await this.service.getTodayInterviews(user));
  }

  @Get('interviews/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async getInterview(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
  ) {
    return ok('Interview detail', await this.service.getInterview(user, id));
  }

  @Patch('interviews/:id/status')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async updateInterviewStatus(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return ok(
      'Interview status updated',
      await this.service.updateInterviewStatus(user, id, body as never),
    );
  }

  @Patch('interviews/:id/checklist')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async updateChecklist(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return ok(
      'Checklist updated',
      await this.service.updateInterviewChecklist(user, id, body as never),
    );
  }

  @Post('interviews/:id/ai-draft-result')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async aiDraftResult(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body?: { summary?: string },
  ) {
    return ok(
      'AI draft result generated',
      await this.service.draftInterviewResultAi(user, id, body),
    );
  }

}
