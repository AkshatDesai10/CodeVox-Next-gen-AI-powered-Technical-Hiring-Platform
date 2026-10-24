import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../../common/decorators/require-permission.decorator';
import { ParseBigIntIdPipe } from '../../../common/pipes/parse-bigint-id.pipe';
import { AssessmentEngineService } from './services/assessment-engine.service';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

class StartSessionDto {
  @IsString()
  candidate_id: string;

  @IsOptional()
  @IsString()
  template_id?: string;

  @IsOptional()
  @IsString()
  assessment_id?: string;

  @IsOptional()
  @IsString()
  candidate_assessment_id?: string;
}

class SubmitQuestionDto {
  @IsString()
  candidate_assessment_id: string;

  @IsString()
  question_id: string;

  response_json: Record<string, unknown>;
}

class EvaluateQuestionDto {
  @IsString()
  candidate_assessment_id: string;

  @IsString()
  question_id: string;
}

class SubmitSectionDto {
  @IsString()
  section_id: string;

  @IsString()
  submission_type: string;

  submission_data: Record<string, unknown>;
}

@Controller('api/assessment/engine')
@UseGuards(JwtAuthGuard)
export class AssessmentEngineController {
  constructor(private readonly engine: AssessmentEngineService) {}

  @Get('assessments/:id')
  @RequirePermissions('assessments:read')
  async getAssessment(@Param('id', ParseBigIntIdPipe) id: string) {
    return ok('Assessment fetched', await this.engine.getAssessmentDetails(id));
  }

  @Post('sessions/start')
  async startSession(@Body() dto: StartSessionDto) {
    return ok(
      'Session started',
      await this.engine.startSession({
        candidateId: dto.candidate_id,
        templateId: dto.template_id,
        assessmentId: dto.assessment_id,
        candidateAssessmentId: dto.candidate_assessment_id,
      }),
    );
  }

  @Get('sessions/:id')
  async getSession(@Param('id', ParseBigIntIdPipe) id: string) {
    return ok('Session fetched', await this.engine.getSession(id));
  }

  @Post('question/submit')
  async submitQuestion(@Body() dto: SubmitQuestionDto) {
    return ok(
      'Question submitted',
      await this.engine.submitQuestion({
        candidateAssessmentId: dto.candidate_assessment_id,
        questionId: dto.question_id,
        responseJson: dto.response_json,
      }),
    );
  }

  @Post('question/evaluate')
  async evaluateQuestion(@Body() dto: EvaluateQuestionDto) {
    return ok(
      'Question evaluated',
      await this.engine.evaluateQuestion({
        candidateAssessmentId: dto.candidate_assessment_id,
        questionId: dto.question_id,
      }),
    );
  }

  @Post('assessments/:candidateAssessmentId/submit')
  async submitAssessment(@Param('candidateAssessmentId', ParseBigIntIdPipe) id: string) {
    return ok('Assessment submitted', await this.engine.submitAssessment(id));
  }

  /** @deprecated */
  @Post('sessions/:id/sections/submit')
  async submitSection(
    @Param('id', ParseBigIntIdPipe) id: string,
    @Body() dto: SubmitSectionDto,
  ) {
    return ok(
      'Section submitted',
      await this.engine.submitSection({
        sessionId: id,
        sectionId: dto.section_id,
        submissionType: dto.submission_type,
        submissionData: dto.submission_data,
      }),
    );
  }

  /** @deprecated */
  @Post('sessions/:id/submit')
  async submitSession(@Param('id', ParseBigIntIdPipe) id: string) {
    return ok('Session submitted', await this.engine.submitSession(id));
  }
}
