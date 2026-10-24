import { IsEntityId } from '../../../common/validators/entity-id';
import { IsOptional, IsString } from 'class-validator';

export class StartAssessmentDto {
  @IsEntityId()
  candidate_id: string;

  @IsEntityId()
  assessment_id: string;
}

export class RunCodeDto {
  @IsEntityId()
  question_id: string;

  @IsString()
  language: string;

  @IsString()
  source_code: string;

  @IsOptional()
  @IsString()
  input?: string;
}

export class SaveDraftDto {
  @IsEntityId()
  candidate_assessment_id: string;

  @IsEntityId()
  question_id: string;

  @IsString()
  language: string;

  @IsString()
  source_code: string;
}

export class SubmitAssessmentDto {
  @IsEntityId()
  candidate_assessment_id: string;
}
