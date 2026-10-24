import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InterviewGlobalConfigMysql } from './entities/interview-global-config.mysql.entity';

@Injectable()
export class InterviewGlobalConfigRepository {
  constructor(
    @InjectRepository(InterviewGlobalConfigMysql)
    private readonly repo: Repository<InterviewGlobalConfigMysql>,
  ) {}

  async getConfig(): Promise<InterviewGlobalConfigMysql> {
    let row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      row = await this.repo.save(
        this.repo.create({
          id: 1,
          consentText:
            'I consent to this interview being recorded and analyzed for identity verification, fraud prevention, and hiring evaluation.',
        }),
      );
    }
    return row;
  }
}
