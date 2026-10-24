import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { underUploads, uploadBuffer } from '../../files/local-storage';
import { extractReportText } from '../ai-detection/text-extraction.util';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import { JobProfilesService } from './job-profiles.service';
import { JobProfilesPhase2Service } from './job-profiles-phase2.service';
import { JobProfilesAiService } from './job-profiles-ai.service';
import { JobProfileStatus } from './entities/job-profile.mysql.entity';
import type { ProjectGradingRubric } from './project-interview-round.types';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/job-profiles')
export class JobProfilesController {
  constructor(
    private readonly service: JobProfilesService,
    private readonly phase2: JobProfilesPhase2Service,
    private readonly ai: JobProfilesAiService,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async list(
    @CurrentUser() user: JwtUserPayload,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('department') department?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return ok(
      'Job profiles listed',
      await this.service.list(user, {
        search,
        status,
        department,
        page: page ? parseInt(page, 10) : undefined,
        pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      }),
    );
  }

  /** Public endpoint – no auth required. Used by the candidate demo page. */
  @Get('public/list')
  async publicList() {
    return ok(
      'Published job profiles',
      await this.service.listPublished(),
    );
  }

  @Get('export')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  @Header('Content-Type', 'text/csv')
  async exportCsv(@CurrentUser() user: JwtUserPayload) {
    const { csv } = await this.service.exportCsv(user);
    return csv;
  }

  @Get('approvals/pending')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:approve', 'job_profiles:write')
  async pendingApprovals(@CurrentUser() user: JwtUserPayload) {
    return ok('Pending approvals', await this.phase2.listPendingApprovals(user));
  }

  @Get('library/competencies')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async competencyLibrary(
    @CurrentUser() user: JwtUserPayload,
    @Query('department') department?: string,
  ) {
    return ok('Competency library', await this.phase2.listCompetencyLibrary(user, department));
  }

  @Get('library/profile-competencies')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async jobProfileCompetencyCatalog(
    @CurrentUser() user: JwtUserPayload,
    @Query('department') department?: string,
  ) {
    return ok(
      'Job profile competencies',
      await this.phase2.listJobProfileCompetencyCatalog(user, department),
    );
  }

  @Get('library/questions')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async questionLibrary(
    @CurrentUser() user: JwtUserPayload,
    @Query('department') department?: string,
  ) {
    return ok('Question library', await this.phase2.listQuestionLibrary(user, department));
  }

  @Post('question-bank')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async listQuestionBank(@CurrentUser() user: JwtUserPayload, @Body() body: Record<string, unknown>) {
    return ok('Question bank listed', await this.phase2.listQuestionBank(user, body as never));
  }

  @Post('question-bank/create')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async createQuestionBank(@CurrentUser() user: JwtUserPayload, @Body() body: Record<string, unknown>) {
    return ok('Question created', await this.phase2.createQuestionBankQuestion(user, body as never));
  }

  @Get('question-bank/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async getQuestionBank(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Question loaded', await this.phase2.getQuestionBankQuestion(user, id));
  }

  @Patch('question-bank/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async updateQuestionBank(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return ok('Question updated', await this.phase2.updateQuestionBankQuestion(user, id, body as never));
  }

  @Post('question-bank/:id/archive')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async archiveQuestionBank(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Question archived', await this.phase2.archiveQuestionBankQuestion(user, id));
  }

  @Post('question-bank/bulk')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async bulkQuestionBank(@CurrentUser() user: JwtUserPayload, @Body() body: Record<string, unknown>) {
    return ok('Question bank bulk action complete', await this.phase2.bulkQuestionBankAction(user, body as never));
  }

  @Get('question-bank/:id/versions')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async questionBankVersions(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Question versions listed', await this.phase2.listQuestionVersions(user, id));
  }

  @Post('question-bank/:id/restore')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async restoreQuestionBankVersion(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { version_number: number },
  ) {
    return ok('Question restored', await this.phase2.restoreQuestionVersion(user, id, body.version_number));
  }

  @Get('dashboard/stats')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read')
  async getDashboardStats(@CurrentUser() actor: JwtUserPayload) {
    return ok('Stats fetched', await this.phase2.getDashboardStats(actor));
  }

  @Post('problem-bank')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async listProblemBank(@CurrentUser() user: JwtUserPayload, @Body() body: Record<string, unknown>) {
    return ok('Problem bank listed', await this.phase2.listProblemBank(user, body as never));
  }

  @Post('problem-bank/create')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async createProblemBank(@CurrentUser() user: JwtUserPayload, @Body() body: Record<string, unknown>) {
    return ok('Problem created', await this.phase2.createProblem(user, body as never));
  }

  @Post('problem-bank/verify-draft')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async verifyProblemDraft(@CurrentUser() user: JwtUserPayload, @Body() body: Record<string, unknown>) {
    return ok('Problem draft verified', await this.phase2.verifyProblemDraft(user, body as never));
  }

  @Patch('problem-bank/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async updateProblemBank(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return ok('Problem updated', await this.phase2.updateProblem(user, id, body as never));
  }

  @Put('problem-bank/:id/test-cases')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async upsertProblemCases(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { test_cases: Array<Record<string, unknown>> },
  ) {
    return ok(
      'Problem test cases updated',
      await this.phase2.upsertProblemTestCases(user, id, body.test_cases as never),
    );
  }

  @Post('problem-bank/:id/publish')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async publishProblemBank(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Problem published', await this.phase2.validateProblemForPublish(user, id));
  }

  @Post('problem-bank/:id/archive')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async archiveProblemBank(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Problem archived', await this.phase2.archiveProblemBank(user, id));
  }

  @Get('problem-bank/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async getProblemBankDetail(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Problem detail', await this.phase2.getProblemDetail(user, id));
  }

  @Get('problem-bank/:id/versions')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async problemBankVersions(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Problem versions listed', await this.phase2.listProblemVersions(user, id));
  }

  @Post('round-content/snapshot')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async snapshotRoundContent(@CurrentUser() user: JwtUserPayload, @Body() body: Record<string, unknown>) {
    return ok('Round content snapshotted', await this.phase2.snapshotInterviewRoundContent(user, body as never));
  }

  @Get('round-content/snapshot/:jobApplicationId')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async getRoundSnapshot(@CurrentUser() user: JwtUserPayload, @Param('jobApplicationId') jobApplicationId: string) {
    return ok('Round snapshot', await this.phase2.getInterviewRoundSnapshot(user, jobApplicationId));
  }

  @Post('question-bank/ai/generate')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async aiGenerateQuestions(@CurrentUser() user: JwtUserPayload, @Body() body: Record<string, unknown>) {
    return ok('AI question drafts generated', await this.phase2.aiQuestionGenerator(user, body as never));
  }

  @Post('problem-bank/ai/generate')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async aiGenerateProblems(@CurrentUser() user: JwtUserPayload, @Body() body: Record<string, unknown>) {
    return ok('AI problem draft generated', await this.phase2.aiProblemGenerator(user, body as never));
  }

  @Post('problem-bank/ai/generate-database')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async aiGenerateDatabaseAssessment(@CurrentUser() user: JwtUserPayload, @Body() body: Record<string, unknown>) {
    return ok('AI database assessment generated', await this.phase2.aiDatabaseGenerator(user, body));
  }

  @Get('banks/analytics')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async bankAnalytics(@CurrentUser() user: JwtUserPayload) {
    return ok('Question/problem bank analytics', await this.phase2.getBankAnalytics(user));
  }

  @Post(':id/invite')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async inviteLead(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body()
    body: {
      lead_id: string;
      first_name: string;
      last_name?: string;
      email: string;
      phone?: string;
      resume_url?: string;
      experience_years?: number;
      skills?: string[];
    },
  ) {
    return ok(
      'Interview invitation created',
      await this.service.inviteLeadToInterview(user, id, body),
    );
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async create(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: { title: string; department?: string },
  ) {
    return ok('Job profile created', await this.service.create(user, body));
  }

  @Post('ai/draft-jd')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async draftJd(@Body() body: { title: string; brief?: string; department?: string }) {
    return ok('JD draft generated', await this.ai.draftJd(body));
  }

  @Post('project-interview/files')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async uploadProjectInterviewFile(
    @CurrentUser() user: JwtUserPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { kind?: string },
  ) {
    if (!file?.buffer?.length) throw new BadRequestException('Choose a file to upload.');
    const kind = body?.kind;
    if (kind !== 'assessment_document' && kind !== 'supporting_dataset' && kind !== 'answer_key') {
      throw new BadRequestException('kind must be assessment_document, supporting_dataset, or answer_key');
    }
    const filename = (file.originalname || 'upload').replace(/[^\w.\- ()]/g, '_').slice(0, 180);
    const lower = filename.toLowerCase();
    if (kind === 'assessment_document') {
      if (
        !lower.endsWith('.docx') &&
        !lower.endsWith('.pdf') &&
        !lower.endsWith('.xlsx') &&
        !lower.endsWith('.xls')
      ) {
        throw new BadRequestException('Assessment document must be a .docx, .pdf, or .xlsx file.');
      }
      if (file.size > 25 * 1024 * 1024) {
        throw new BadRequestException('Assessment document must not exceed 25 MB.');
      }
    }
    if (kind === 'answer_key') {
      if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
        throw new BadRequestException('Master answer key must be a .xlsx file.');
      }
      if (file.size > 25 * 1024 * 1024) {
        throw new BadRequestException('Answer key must not exceed 25 MB.');
      }
    }
    if (kind === 'supporting_dataset') {
      if (!/\.(sql|csv|json|txt|md|tsv)$/i.test(lower)) {
        throw new BadRequestException('Supporting files must be .sql, .csv, .json, .txt, .md, or .tsv.');
      }
      if (file.size > 25 * 1024 * 1024) {
        throw new BadRequestException('Supporting dataset must not exceed 25 MB.');
      }
    }

    let extracted_text: string | undefined;
    let teaser: string | undefined;
    let title: string | undefined;
    let requirements: Array<{ text: string; weight: number }> | undefined;
    let grading_rubric: ProjectGradingRubric | null | undefined;
    const isSpreadsheet = lower.endsWith('.xlsx') || lower.endsWith('.xls');
    if (kind === 'assessment_document' && !isSpreadsheet) {
      extracted_text = (await extractReportText(file)).slice(0, 80_000);
      const summary = await this.ai.summarizeAssessmentDocument(user, extracted_text);
      title = summary.title;
      teaser = summary.teaser;
      requirements = summary.requirements;
      grading_rubric = summary.grading_rubric;
    }

    const folder =
      kind === 'assessment_document' ? 'assessments' : kind === 'answer_key' ? 'answer-keys' : 'datasets';
    const key = underUploads('project-interview', folder, `${Date.now()}-${filename}`);
    const file_url = await uploadBuffer({
      key,
      body: file.buffer,
      contentType: file.mimetype || 'application/octet-stream',
    });
    return ok('File uploaded', {
      filename,
      file_url,
      extracted_text,
      title,
      teaser,
      requirements,
      grading_rubric,
      ...(kind === 'answer_key' ? { uploaded_at: new Date().toISOString() } : {}),
    });
  }

  @Post('ai/generate-project-requirements')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async generateProjectRequirements(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: { title: string; description_md: string },
  ) {
    return ok(
      'Project requirements generated',
      await this.ai.generateProjectRequirements(user, body),
    );
  }

  @Post('ai/suggest-competencies/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async suggestCompetencies(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Query('stage_type') stageType?: string,
  ) {
    return ok('Competency suggestions', await this.ai.suggestCompetencies(user, id, stageType));
  }

  @Post('ai/suggest-rubric/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async suggestRubric(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Rubric suggestions', await this.ai.suggestRubricWeights(user, id));
  }

  @Post('ai/generate-questions/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async generateQuestions(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { count?: number; stage_id?: string },
  ) {
    return ok('Questions generated', await this.ai.generateQuestions(user, id, body.count, body.stage_id));
  }

  @Post('ai/map-bank-content/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async mapBankContent(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body()
    body: {
      stage_id?: string;
      max_questions?: number;
      max_problems?: number;
      content_type?: 'question' | 'problem' | 'both';
    },
  ) {
    return ok('Bank content mapped', await this.ai.mapBankContent(user, id, body ?? {}));
  }

  @Post('ai/bias-screen/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async biasScreen(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Bias screening', await this.ai.biasScreen(user, id));
  }

  @Post('ai/compensation-benchmark/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async compensationBenchmark(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Compensation benchmark', await this.ai.compensationBenchmark(user, id));
  }

  @Post('ai/generate-faq/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async generateFaq(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('FAQ generated', await this.ai.generateFaq(user, id));
  }

  @Post('ai/nl-edit/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async nlEdit(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { instruction: string },
  ) {
    return ok('NL edit applied', await this.ai.nlEdit(user, id, body.instruction));
  }

  @Get('ai/check-duplicates/:id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async checkDuplicates(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Duplicate check', await this.ai.checkDuplicates(user, id));
  }

  @Get('public/:slug')
  async getPublic(@Param('slug') slug: string) {
    return ok('Public job profile', await this.service.getPublicProfile(slug));
  }

  @Post('public/:slug/apply')
  async applyPublic(
    @Param('slug') slug: string,
    @Body()
    body: {
      first_name: string;
      last_name?: string;
      email: string;
      phone?: string;
      experience_years?: number;
      skills?: string[];
    },
  ) {
    return ok('Application submitted', await this.service.publicApply(slug, body));
  }

  @Get(':id/ai-insights')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async aiInsights(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('AI insights', await this.ai.getInsights(user, id));
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async get(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Job profile', await this.service.get(user, id));
  }

  @Patch(':id/basics')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async updateBasics(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return ok('Basics updated', await this.service.updateBasics(user, id, body));
  }

  @Put(':id/jd')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async updateJd(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return ok('JD updated', await this.service.updateJd(user, id, body));
  }

  @Get(':id/stages')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async getStages(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    const data = await this.service.get(user, id);
    return ok('Stages', data.stages);
  }

  @Put(':id/stages')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async updateStages(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { stages: Array<Record<string, unknown>> },
  ) {
    return ok('Stages updated', await this.service.updateStages(user, id, body.stages ?? []));
  }

  @Put(':id/stages/reorder')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async reorderStages(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { stage_ids: string[] },
  ) {
    return ok('Stages reordered', await this.service.reorderStages(user, id, body.stage_ids ?? []));
  }

  @Put(':id/competencies')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async updateCompetencies(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { competencies: Array<Record<string, unknown>> },
  ) {
    return ok(
      'Competencies updated',
      await this.service.updateCompetencies(user, id, body.competencies ?? []),
    );
  }

  @Put(':id/questions')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async updateQuestions(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { questions: Array<Record<string, unknown>> },
  ) {
    return ok('Questions updated', await this.service.updateQuestions(user, id, body.questions ?? []));
  }

  @Get(':id/pipeline')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async pipeline(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Pipeline', await this.service.getPipeline(user, id));
  }

  @Get(':id/analytics')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async analytics(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Query('days') days?: string,
  ) {
    const daysNum = days && days !== 'all' ? Math.max(1, parseInt(days, 10)) : undefined;
    return ok('Analytics', await this.phase2.getExtendedAnalytics(user, id, daysNum));
  }

  @Get(':id/versions')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async versions(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Versions', await this.phase2.listVersions(user, id));
  }

  @Get(':id/versions/diff')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async versionDiff(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return ok(
      'Version diff',
      await this.phase2.diffVersions(user, id, parseInt(from, 10), parseInt(to, 10)),
    );
  }

  @Get(':id/preview-audits')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:read', 'assessments:read')
  async previewAudits(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Preview audits', await this.phase2.listPreviewAudits(user, id));
  }

  @Patch(':id/phase2-config')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async phase2Config(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return ok('Phase 2 config updated', await this.phase2.updatePhase2Config(user, id, body));
  }

  @Post(':id/submit-for-approval')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async submitForApproval(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Submitted for approval', await this.phase2.submitForApproval(user, id));
  }

  @Post(':id/approve')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:approve', 'job_profiles:write')
  async approve(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { comment?: string },
  ) {
    return ok('Profile approved', await this.phase2.approveProfile(user, id, body ?? {}));
  }

  @Post(':id/reject-approval')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:approve', 'job_profiles:write')
  async rejectApproval(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body: { comment?: string },
  ) {
    return ok('Approval rejected', await this.phase2.rejectApproval(user, id, body ?? {}));
  }

  @Post(':id/activate')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async activate(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    await this.ai.assertPublishAllowed(id);
    return ok('Profile activated', await this.phase2.activateProfile(user, id));
  }

  @Post(':id/preview-session')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async previewSession(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
    @Body() body?: { stage_id?: string },
    @Query('stage_id') stageIdQuery?: string,
  ) {
    const stageId = body?.stage_id || stageIdQuery;
    const session = await this.service.createPreviewSession(user, id, stageId);
    const audit = await this.phase2.startPreviewAudit(user, id, session.candidate_token);
    return ok('Preview session created', { ...session, audit_id: audit.audit_id });
  }

  @Post(':id/clone')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async clone(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Profile cloned', await this.service.clone(user, id));
  }

  @Post(':id/publish')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async publish(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    await this.ai.assertPublishAllowed(id);
    return ok('Profile published', await this.service.publish(user, id));
  }

  @Post(':id/pause')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async pause(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Profile paused', await this.service.setStatus(user, id, JobProfileStatus.PAUSED));
  }

  @Post(':id/close')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async close(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Profile closed', await this.service.setStatus(user, id, JobProfileStatus.CLOSED));
  }

  @Post(':id/archive')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async archive(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Profile archived', await this.service.archive(user, id));
  }

  @Post(':id/reopen')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async reopen(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Profile reopened', await this.service.reopen(user, id));
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async remove(@CurrentUser() user: JwtUserPayload, @Param('id') id: string) {
    return ok('Profile deleted', await this.service.delete(user, id));
  }
}

