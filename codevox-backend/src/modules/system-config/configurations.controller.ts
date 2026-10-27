import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import { DynamicConfigService } from './dynamic-config.service';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/recruitment/configurations')
@UseGuards(JwtAuthGuard)
export class ConfigurationsController {
  constructor(private readonly dynamicConfig: DynamicConfigService) {}

  @Get()
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async list() {
    return ok('System configurations', await this.dynamicConfig.getAllEffective());
  }

  @Get('logs')
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async logs() {
    return ok('Configuration change history', await this.dynamicConfig.getRecentChangeLogs(50));
  }

  @Put()
  @RequirePermissions('job_profiles:write', 'assessments:write')
  async update(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: { values?: Record<string, string | null> } | Record<string, string | null>,
  ) {
    const values =
      body && typeof body === 'object' && 'values' in body && body.values
        ? body.values
        : (body as Record<string, string | null>);

    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new BadRequestException('Body must include configuration values');
    }

    try {
      const actor = user?.email || user?.sub || null;
      const data = await this.dynamicConfig.setMany(values, actor);
      return ok('Configurations saved', data);
    } catch (err) {
      throw new BadRequestException(err instanceof Error ? err.message : 'Invalid configuration');
    }
  }
}
