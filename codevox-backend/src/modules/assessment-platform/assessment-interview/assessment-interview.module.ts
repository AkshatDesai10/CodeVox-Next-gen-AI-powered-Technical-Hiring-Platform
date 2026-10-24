import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InterviewSessionMysql } from '../entities/interview-session.mysql.entity';
import { InterviewQuestionMysql } from '../entities/interview-question.mysql.entity';
import { InterviewResponseMysql } from '../entities/interview-response.mysql.entity';
import { AssessmentInterviewService } from './assessment-interview.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InterviewSessionMysql,
      InterviewQuestionMysql,
      InterviewResponseMysql,
    ]),
  ],
  providers: [AssessmentInterviewService],
  exports: [AssessmentInterviewService],
})
export class AssessmentInterviewModule {}
