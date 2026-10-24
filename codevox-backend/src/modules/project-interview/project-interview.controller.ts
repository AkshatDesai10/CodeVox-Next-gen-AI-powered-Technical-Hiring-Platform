import { Body, Controller, Get, Param, Post, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../common/decorators/require-permission.decorator';
import { ProjectInterviewService } from './project-interview.service';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/project-interview')
export class ProjectInterviewController {
  constructor(private readonly projectInterview: ProjectInterviewService) {}

  @Get('submissions/:token')
  async getSubmission(@Param('token') token: string) {
    return ok('Project interview submission', await this.projectInterview.getCandidateView(token));
  }

  @Get('submissions/:token/projects/:projectId/files')
  async downloadFiles(
    @Param('token') token: string,
    @Param('projectId') projectId: string,
    @Res() res: Response,
  ) {
    const file = await this.projectInterview.downloadProjectFiles(token, projectId);
    const filename = file.filename.replace(/"/g, '');
    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', String(file.buffer.length));
    res.setHeader('Cache-Control', 'no-store');
    res.end(file.buffer);
  }

  @Post('submissions/:token/select')
  async select(@Param('token') token: string, @Body() body: { project_id?: string }) {
    return ok(
      'Project selected',
      await this.projectInterview.selectProject(token, String(body?.project_id ?? '')),
    );
  }

  @Post('submissions/:token/submit')
  async submit(
    @Param('token') token: string,
    @Body() body: { github_url?: string; github_branch?: string },
  ) {
    return ok('Project submitted', await this.projectInterview.submit(token, body ?? {}));
  }

  @Post('submissions/:token/submit-zip')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  async submitZip(@Param('token') token: string, @UploadedFile() file?: Express.Multer.File) {
    return ok('Project submitted', await this.projectInterview.submit(token, {}, file));
  }

  @Post('sessions/:token/leave-build')
  async leaveBuild(@Param('token') token: string) {
    return ok(
      'Build ended',
      await this.projectInterview.leaveBuildWithoutSubmission(token),
    );
  }

  @Get('applications/:applicationId/stages/:stageId/report')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read')
  async recruiterReport(
    @Param('applicationId') applicationId: string,
    @Param('stageId') stageId: string,
  ) {
    return ok(
      'Project interview report',
      await this.projectInterview.getReportSummary(applicationId, stageId),
    );
  }

  @Get('admin/eval-status/:token')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async adminEvalStatus(@Param('token') token: string) {
    return ok('Project interview eval status', await this.projectInterview.getEvalStatus(token));
  }

  @Post('admin/force-advance/:token')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async adminForceAdvance(@Param('token') token: string) {
    return ok(
      'Candidate advanced to Defend',
      await this.projectInterview.forceAdvanceToInterview(token),
    );
  }

  @Post('admin/rescore-code/:submissionId')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async adminRescoreCode(
    @Param('submissionId') submissionId: string,
    @Body() body: { github_url?: string; github_branch?: string },
  ) {
    return ok(
      'Code re-score started',
      await this.projectInterview.rescoreCode(submissionId, body ?? {}),
    );
  }
}
