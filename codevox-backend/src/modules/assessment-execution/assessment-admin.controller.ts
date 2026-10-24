import { Controller, Get, Param, Patch, Body, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../common/decorators/require-permission.decorator';
import { ParseBigIntIdPipe } from '../../common/pipes/parse-bigint-id.pipe';
import { AssessmentExecutionService } from './assessment-execution.service';
import { UpdateAssessmentDto } from './dto/update-assessment.dto';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/assessment/admin')
@UseGuards(JwtAuthGuard)
export class AssessmentAdminController {
  constructor(private readonly service: AssessmentExecutionService) {}

  @Get('summary')
  @RequirePermissions('assessments:read')
  async summary() {
    return ok('Assessment summary fetched', await this.service.getDashboardSummary());
  }

  @Get('candidates')
  @RequirePermissions('assessments:read')
  async candidates() {
    return ok('Candidates fetched', await this.service.listCandidates());
  }

  @Get('assessments')
  @RequirePermissions('assessments:read')
  async assessments() {
    return ok('Assessments fetched', await this.service.listAssessments());
  }

  @Patch('assessments/:id')
  @RequirePermissions('assessments:write')
  async updateAssessment(
    @Param('id', ParseBigIntIdPipe) id: string,
    @Body() dto: UpdateAssessmentDto,
  ) {
    return ok('Assessment updated', await this.service.updateAssessment(id, dto));
  }
}
