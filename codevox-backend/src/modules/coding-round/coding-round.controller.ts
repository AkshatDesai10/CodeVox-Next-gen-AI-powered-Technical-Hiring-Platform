import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpCode,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CodingRoundService } from './coding-round.service';
import { CodingRoundLiveKitService } from './coding-round-livekit.service';

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/coding-round')
export class CodingRoundController {
  constructor(
    private readonly codingRoundService: CodingRoundService,
    private readonly codingLiveKit: CodingRoundLiveKitService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Load problem statement + starter code */
  @Get(':token')
  async getProblem(@Param('token') token: string) {
    const data = await this.codingRoundService.getProblem(token, this.dataSource);
    return ok('Problem loaded', data);
  }

  /** Create / resume LiveKit room for coding (screen share + recording + monitor). */
  @Post(':token/livekit/init')
  @HttpCode(200)
  async initLiveKit(@Param('token') token: string) {
    const data = await this.codingLiveKit.initLiveKit(token);
    return ok('Coding LiveKit session ready', data);
  }

  /** Start track egress once the candidate has published screen share. */
  @Post(':token/recording/start')
  @HttpCode(200)
  async startRecording(
    @Param('token') token: string,
    @Body() body: { track_id: string; kind?: string },
  ) {
    const data = await this.codingLiveKit.startTrackRecording(token, body);
    return ok('Recording started', data);
  }

  /** Stop egresses + close LiveKit room (also called on submit). */
  @Post(':token/livekit/stop')
  @HttpCode(200)
  async stopLiveKit(@Param('token') token: string) {
    const data = await this.codingLiveKit.stopRecording(token);
    return ok('Coding LiveKit session stopped', data);
  }

  /** Run code against visible test cases */
  @Post(':token/run')
  @HttpCode(200)
  async runCode(
    @Param('token') token: string,
    @Body() body: { problem_id: string; language: string; source_code: string },
  ) {
    const data = await this.codingRoundService.runCode(
      token,
      body.problem_id,
      body.language,
      body.source_code,
      this.dataSource,
    );
    return ok('Code executed', data);
  }

  /** Submit final code */
  @Post(':token/submit')
  @HttpCode(200)
  async submitCode(
    @Param('token') token: string,
    @Body() body: { submissions: Record<string, { language: string; source_code: string }> },
  ) {
    const data = await this.codingRoundService.submitCode(
      token,
      body.submissions,
      this.dataSource,
    );
    // Best-effort: stop screen recording when the attempt ends.
    void this.codingLiveKit.stopRecording(token).catch(() => undefined);
    return ok('Submission saved', data);
  }
}
