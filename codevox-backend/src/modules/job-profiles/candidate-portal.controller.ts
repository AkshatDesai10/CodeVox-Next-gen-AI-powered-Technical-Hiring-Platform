import { Controller, Get, Param, Post, Body, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CandidatePortalService } from './candidate-portal.service';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/candidate/portal')
export class CandidatePortalController {
  constructor(private readonly candidatePortalService: CandidatePortalService) { }

  @Get(':token/dashboard')
  async getDashboard(@Param('token') token: string) {
    const data = await this.candidatePortalService.getDashboardPayload(token);
    return ok('Candidate dashboard', data);
  }

  @Post(':token/consent')
  async recordConsent(@Param('token') token: string) {
    const data = await this.candidatePortalService.recordFaceConsent(token);
    return ok('Consent recorded', data);
  }

  @Post(':token/preferences')
  async savePreferences(
    @Param('token') token: string,
    @Body() body: { interview_language?: string; accept_guidelines?: boolean },
  ) {
    const data = await this.candidatePortalService.savePortalPreferences(token, body ?? {});
    return ok('Preferences saved', data);
  }

  @Post(':token/face-capture')
  async captureFace(
    @Param('token') token: string,
    @Body() body: { image_base64?: string; face_descriptor?: number[] | null },
  ) {
    const data = await this.candidatePortalService.captureFacePhoto(token, body ?? {});
    return ok('Face photo captured', data);
  }

  @Post(':token/start')
  async startStage(
    @Param('token') token: string,
    @Body() body: { stageId: string },
  ) {
    const data = await this.candidatePortalService.startStage(token, body.stageId);
    return ok('Stage started', data);
  }

  @Post('demo-link')
  @UseInterceptors(FileInterceptor('resume'))
  async createDemoApplication(
    @Body() body: { job_profile_id: string; candidate_name: string; candidate_email: string },
    @UploadedFile() resumeFile?: Express.Multer.File
  ) {
    const data = await this.candidatePortalService.createDemoApplication(
      body.job_profile_id,
      body.candidate_name,
      body.candidate_email,
      resumeFile
    );
    return ok('Demo application created', data);
  }
}
