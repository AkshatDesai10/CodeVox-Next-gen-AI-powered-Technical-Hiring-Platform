import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InterviewGlobalConfigMysql } from './entities/interview-global-config.mysql.entity';
import { InterviewProctorEventMysql } from './entities/interview-proctor-event.mysql.entity';
import { InterviewGlobalConfigRepository } from './interview-global-config.repository';
import { InterviewProctorService } from './interview-proctor.service';
import { ProctorRepository } from './proctor.repository';

@Module({
  imports: [
    TypeOrmModule.forFeature([InterviewProctorEventMysql, InterviewGlobalConfigMysql]),
  ],
  providers: [
    ProctorRepository,
    InterviewGlobalConfigRepository,
    InterviewProctorService,
  ],
  exports: [
    ProctorRepository,
    InterviewGlobalConfigRepository,
    InterviewProctorService,
  ],
})
export class ProctorModule {}
