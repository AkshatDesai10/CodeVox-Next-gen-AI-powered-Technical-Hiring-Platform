import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../../common/decorators/require-permission.decorator';
import { ParseBigIntIdPipe } from '../../../common/pipes/parse-bigint-id.pipe';
import { AssessmentOrchestratorService } from './assessment-orchestrator.service';
import { AssessmentPlatformRepository } from './assessment-platform.repository';
import { EnvironmentTemplateService } from '../assessment-environment/environment.services';
import { AiQuestionGeneratorService } from '../assessment-ai/ai-question-generator.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssessmentMysql } from '../../assessment-execution/entities/assessment.mysql.entity';
import { QuestionMysql } from '../../assessment-execution/entities/question.mysql.entity';
import { AssessmentQuestionMysql } from '../../assessment-execution/entities/assessment-question.mysql.entity';
import { CandidateAssessmentMysql } from '../../assessment-execution/entities/candidate-assessment.mysql.entity';
import { QuestionSourceMode, EvaluationMode, ExperienceLevel } from '../shared/enums';
import { AssessmentStatus } from '../../assessment-execution/assessment-status.enum';
import { CandidateAssessmentStatus } from '../../assessment-execution/candidate-assessment-status.enum';
import { IsArray, IsEnum, IsInt, IsObject, IsOptional, IsString, Min } from 'class-validator';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

class CreateAssessmentDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsInt()
  @Min(1)
  duration_minutes: number;

  @IsOptional()
  @IsEnum(QuestionSourceMode)
  question_source?: QuestionSourceMode;

  @IsOptional()
  @IsEnum(EvaluationMode)
  evaluation_mode?: EvaluationMode;

  @IsOptional()
  @IsEnum(ExperienceLevel)
  experience_level?: ExperienceLevel;

  @IsOptional()
  @IsArray()
  target_skills?: string[];

  @IsOptional()
  @IsEnum(AssessmentStatus)
  status?: AssessmentStatus;
}

class CreateQuestionDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsString()
  question_type: string;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsInt()
  @Min(0)
  marks: number;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  environment_config?: Record<string, unknown>;

  @IsOptional()
  evaluation_config?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  mcq_options?: Array<{ label: string; text: string; is_correct: boolean }>;
}

class GenerateQuestionDto {
  @IsString()
  prompt: string;

  @IsOptional()
  @IsString()
  difficulty?: string;

  @IsOptional()
  @IsEnum(ExperienceLevel)
  experience_level?: ExperienceLevel;

  @IsOptional()
  @IsString()
  question_type?: string;

  @IsOptional()
  @IsArray()
  skills?: string[];

  @IsOptional()
  save?: boolean;
}

class SaveGeneratedQuestionDto {
  @IsObject()
  generated: Record<string, unknown>;
}

class AssignCandidateDto {
  @IsString()
  candidate_id: string;

  @IsString()
  assessment_id: string;
}

@Controller('api/assessment/admin/platform')
@UseGuards(JwtAuthGuard)
export class AssessmentPlatformAdminController {
  constructor(
    private readonly orchestrator: AssessmentOrchestratorService,
    private readonly platformRepo: AssessmentPlatformRepository,
    private readonly templates: EnvironmentTemplateService,
    private readonly aiGenerator: AiQuestionGeneratorService,
    @InjectRepository(AssessmentMysql)
    private readonly assessmentRepo: Repository<AssessmentMysql>,
    @InjectRepository(QuestionMysql)
    private readonly questionRepo: Repository<QuestionMysql>,
    @InjectRepository(AssessmentQuestionMysql)
    private readonly assessmentQuestionRepo: Repository<AssessmentQuestionMysql>,
    @InjectRepository(CandidateAssessmentMysql)
    private readonly candidateAssessmentRepo: Repository<CandidateAssessmentMysql>,
  ) {}

  @Get('questions')
  @RequirePermissions('assessments:read')
  async listQuestions() {
    const rows = await this.questionRepo.find({
      where: { inactive: 0 },
      order: { id: 'DESC' },
      take: 200,
    });
    return ok('Questions fetched', rows);
  }

  @Post('assessments')
  @RequirePermissions('assessments:write')
  async createAssessment(@Body() dto: CreateAssessmentDto) {
    const row = await this.assessmentRepo.save(
      this.assessmentRepo.create({
        title: dto.title,
        description: dto.description ?? null,
        durationMinutes: dto.duration_minutes,
        totalMarks: 0,
        status: AssessmentStatus.DRAFT,
        createdBy: '1',
        questionSource: dto.question_source ?? QuestionSourceMode.STATIC,
        evaluationMode: dto.evaluation_mode ?? EvaluationMode.TESTCASE,
        experienceLevel: dto.experience_level ?? ExperienceLevel.MID,
        targetSkills: dto.target_skills ?? null,
      }),
    );
    return ok('Assessment created', row);
  }

  @Patch('assessments/:id')
  @RequirePermissions('assessments:write')
  async updateAssessment(
    @Param('id', ParseBigIntIdPipe) id: string,
    @Body() dto: Partial<CreateAssessmentDto>,
  ) {
    await this.assessmentRepo.update(
      { id },
      {
        title: dto.title,
        description: dto.description,
        durationMinutes: dto.duration_minutes,
        questionSource: dto.question_source,
        evaluationMode: dto.evaluation_mode,
        experienceLevel: dto.experience_level,
        targetSkills: dto.target_skills,
        status: dto.status,
      },
    );
    return ok('Assessment updated', await this.assessmentRepo.findOne({ where: { id } }));
  }

  @Post('questions')
  @RequirePermissions('assessments:write')
  async createQuestion(@Body() dto: CreateQuestionDto) {
    const question = await this.questionRepo.save(
      this.questionRepo.create({
        title: dto.title,
        description: dto.description ?? null,
        questionType: dto.question_type as QuestionMysql['questionType'],
        difficulty: dto.difficulty ?? 'MEDIUM',
        marks: dto.marks,
        language: dto.language ?? null,
        environmentConfig: dto.environment_config ?? null,
        evaluationConfig: dto.evaluation_config ?? null,
      }),
    );
    if (dto.mcq_options?.length) {
      await this.platformRepo.saveMcqOptions(
        question.id,
        dto.mcq_options.map((o) => ({
          label: o.label,
          text: o.text,
          isCorrect: o.is_correct,
        })),
      );
    }
    return ok('Question created', question);
  }

  @Post('questions/generate')
  @RequirePermissions('assessments:write')
  async generateQuestion(@Body() dto: GenerateQuestionDto) {
    const generated = await this.aiGenerator.generateFromPrompt({
      prompt: dto.prompt,
      skills: dto.skills,
      experienceLevel: dto.experience_level ?? ExperienceLevel.MID,
      difficulty: dto.difficulty ?? 'MEDIUM',
      questionType: dto.question_type,
    });

    if (dto.save) {
      const question = await this.platformRepo.persistToQuestionBank(generated);
      return ok('Question generated and saved', { generated, question });
    }

    return ok('Question generated', generated);
  }

  @Post('questions/save')
  @RequirePermissions('assessments:write')
  async saveGeneratedQuestion(@Body() dto: SaveGeneratedQuestionDto) {
    const question = await this.platformRepo.persistToQuestionBank(
      dto.generated as never,
    );
    return ok('Question saved', { generated: dto.generated, question });
  }

  @Post('assessments/:assessmentId/questions')
  @RequirePermissions('assessments:write')
  async mapQuestion(
    @Param('assessmentId', ParseBigIntIdPipe) assessmentId: string,
    @Body() body: { question_id: string; marks: number; sort_order: number },
  ) {
    const row = await this.assessmentQuestionRepo.save(
      this.assessmentQuestionRepo.create({
        assessmentId,
        questionId: body.question_id,
        marks: body.marks,
        sortOrder: body.sort_order,
      }),
    );
    return ok('Question mapped', row);
  }

  @Post('assignments')
  @RequirePermissions('assessments:write')
  async assignCandidate(@Body() dto: AssignCandidateDto) {
    const row = await this.candidateAssessmentRepo.save(
      this.candidateAssessmentRepo.create({
        candidateId: dto.candidate_id,
        assessmentId: dto.assessment_id,
        status: CandidateAssessmentStatus.ASSIGNED,
      }),
    );
    return ok('Candidate assigned', row);
  }

  @Post('assessments/:id/preview-generation')
  @RequirePermissions('assessments:write')
  async previewGeneration(@Param('id', ParseBigIntIdPipe) id: string) {
    return ok('Preview generated', await this.orchestrator.previewGeneration(id));
  }

  @Get('environment-templates')
  @RequirePermissions('assessments:read')
  async listTemplates() {
    return ok('Environment templates', await this.templates.list());
  }
}
