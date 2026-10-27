import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import { DynamicConfigService } from './dynamic-config.service';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/recruitment/configurations')
export class SystemConfigController {
  constructor(private readonly config: DynamicConfigService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  list() {
    return ok('System configurations', {
      items: this.config.getAllEffective(),
    });
  }

  @Put()
  @UseGuards(JwtAuthGuard)
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async update(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: { values?: Record<string, string | null | undefined> },
  ) {
    const items = await this.config.setMany(body?.values ?? {}, user?.sub ?? null);
    return ok('System configurations updated', { items });
  }
}

@Controller('api/candidate/portal')
export class CandidateRuntimeConfigController {
  constructor(private readonly config: DynamicConfigService) {}

  /** Lightweight public flags for portal / interview clients (no auth). */
  @Get('runtime-config')
  runtimeConfig() {
    return ok('Runtime config', this.config.getRuntimePublicConfig());
  }
}
