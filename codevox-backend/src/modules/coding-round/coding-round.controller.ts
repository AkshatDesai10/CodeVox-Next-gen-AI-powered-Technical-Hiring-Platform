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

function ok(message: string, data: unknown) {
  return { success: true, message, data };
}

@Controller('api/coding-round')
export class CodingRoundController {
  constructor(
    private readonly codingRoundService: CodingRoundService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** Load problem statement + starter code */
  @Get(':token')
  async getProblem(@Param('token') token: string) {
    const data = await this.codingRoundService.getProblem(token, this.dataSource);
    return ok('Problem loaded', data);
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
    return ok('Submission saved', data);
  }
}
