import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequirePermissions } from '../../common/decorators/require-permission.decorator';
import type { JwtUserPayload } from '../../auth/types/jwt-user-payload';
import { AiDetectionService } from './ai-detection.service';

const MAX_BYTES = 15 * 1024 * 1024;

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/ai-detection')
@UseGuards(JwtAuthGuard)
export class AiDetectionController {
  constructor(private readonly aiDetection: AiDetectionService) {}

  @Post('analyze')
  @RequirePermissions('assessments:read')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES },
    }),
  )
  async analyze(
    @CurrentUser() user: JwtUserPayload,
    @Body() body: { text?: string; title?: string },
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const result = await this.aiDetection.analyze(user, {
      file,
      text: body?.text,
      title: body?.title,
    });
    return ok('Report analyzed', result);
  }

  @Get('history')
  @RequirePermissions('assessments:read')
  async history(@CurrentUser() user: JwtUserPayload) {
    return ok('Detection history', await this.aiDetection.list(user));
  }

  @Get(':id')
  @RequirePermissions('assessments:read')
  async get(
    @CurrentUser() user: JwtUserPayload,
    @Param('id') id: string,
  ) {
    return ok('Detection report', await this.aiDetection.get(user, id));
  }
}
