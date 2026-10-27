import { Controller, Get, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Lightweight public endpoints for candidate pre-flight network measurement.
 * No auth — used by SystemReadinessLobby before assessments / interviews.
 */
@Controller('api/network-check')
export class NetworkCheckController {
  @Get('ping')
  ping() {
    return { ok: true, t: Date.now() };
  }

  @Post('upload')
  upload(@Req() req: Request) {
    const body = req.body as unknown;
    let bytes = 0;
    if (Buffer.isBuffer(body)) {
      bytes = body.length;
    } else if (typeof body === 'string') {
      bytes = Buffer.byteLength(body);
    } else if (body != null) {
      bytes = Buffer.byteLength(JSON.stringify(body));
    }
    return { ok: true, bytes_received: bytes };
  }
}
