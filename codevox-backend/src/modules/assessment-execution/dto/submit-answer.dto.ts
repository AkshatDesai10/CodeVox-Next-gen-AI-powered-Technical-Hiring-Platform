import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { IsEntityId } from '../../../common/validators/entity-id';

export class SubmitAnswerDto {
  @IsEntityId()
  candidate_assessment_id: string;

  @IsEntityId()
  question_id: string;

  @IsString()
  @IsNotEmpty()
  language: string;

  @IsString()
  @IsNotEmpty()
  source_code: string;
}
