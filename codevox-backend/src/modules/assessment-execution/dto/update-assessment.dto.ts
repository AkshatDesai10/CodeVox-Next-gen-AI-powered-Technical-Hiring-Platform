import { IsEnum, IsOptional } from 'class-validator';
import { AssessmentStatus } from '../assessment-status.enum';

export class UpdateAssessmentDto {
  @IsOptional()
  @IsEnum(AssessmentStatus)
  status?: AssessmentStatus;
}
