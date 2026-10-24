import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ParseBigIntIdPipe } from '../../common/pipes/parse-bigint-id.pipe';
import { AssessmentExecutionService } from './assessment-execution.service';
import { AssessmentOrchestratorService } from '../assessment-platform/assessment-orchestrator/assessment-orchestrator.service';import {
  RunCodeDto,
  SaveDraftDto,
  StartAssessmentDto,
  SubmitAssessmentDto,
} from './dto/assessment-execution.dto';
import { SubmitAnswerDto } from './dto/submit-answer.dto';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/assessment')
export class AssessmentExecutionController {
  constructor(
    private readonly service: AssessmentExecutionService,
    private readonly orchestrator: AssessmentOrchestratorService,
  ) {}

  @Get('assessments/:assessmentId/questions')
  async previewQuestions(
    @Param('assessmentId', ParseBigIntIdPipe) assessmentId: string,
  ) {
    return ok(
      'Assessment questions fetched',
      await this.service.getAssessmentQuestionsPreview(assessmentId),
    );
  }

  @Post('start')
  async start(@Body() dto: StartAssessmentDto) {
    return ok('Assessment started', await this.orchestrator.startAssessment(dto));
  }

  @Get('candidate/:candidateId/assignments')
  async assignments(@Param('candidateId', ParseBigIntIdPipe) candidateId: string) {
    return ok(
      'Candidate assignments fetched',
      await this.service.listCandidateAssignments(candidateId),
    );
  }

  @Get('result/:candidateAssessmentId')
  async result(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
  ) {
    return ok(
      'Assessment result fetched',
      await this.service.getResult(candidateAssessmentId),
    );
  }

  @Post('run-code')
  async runCode(@Body() dto: RunCodeDto) {
    return ok('Code executed', await this.service.runCode(dto));
  }

  @Post('save-draft')
  async saveDraft(@Body() dto: SaveDraftDto) {
    return ok('Draft saved', await this.service.saveDraft(dto));
  }

  @Post('submit-answer')
  async submitAnswer(@Body() dto: SubmitAnswerDto) {
    return ok('Answer evaluated', await this.orchestrator.submitAnswer(dto));
  }

  @Post('interview/respond')
  async interviewRespond(
    @Body()
    dto: {
      candidate_assessment_id: string;
      question_id: string;
      transcript: string;
      audio_url?: string;
      response_duration?: number;
    },
  ) {
    return ok('Interview response saved', await this.orchestrator.respondInterview(dto));
  }

  @Post('submit')
  async submit(@Body() dto: SubmitAssessmentDto) {
    return ok('Assessment submitted', await this.orchestrator.submitAssessment(dto));
  }

  @Get(':candidateAssessmentId')
  async getAttempt(
    @Param('candidateAssessmentId', ParseBigIntIdPipe) candidateAssessmentId: string,
  ) {
    return ok(
      'Assessment attempt fetched',
      await this.service.getAttempt(candidateAssessmentId),
    );
  }
}
