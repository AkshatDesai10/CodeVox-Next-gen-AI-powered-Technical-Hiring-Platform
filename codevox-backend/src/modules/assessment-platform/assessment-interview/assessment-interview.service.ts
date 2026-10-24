import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InterviewSessionMysql, InterviewSessionStatus } from '../entities/interview-session.mysql.entity';
import { InterviewQuestionMysql, InterviewQuestionType } from '../entities/interview-question.mysql.entity';
import { InterviewResponseMysql } from '../entities/interview-response.mysql.entity';

@Injectable()
export class AssessmentInterviewService {
  constructor(
    @InjectRepository(InterviewSessionMysql)
    private readonly sessionRepo: Repository<InterviewSessionMysql>,
    @InjectRepository(InterviewQuestionMysql)
    private readonly questionRepo: Repository<InterviewQuestionMysql>,
    @InjectRepository(InterviewResponseMysql)
    private readonly responseRepo: Repository<InterviewResponseMysql>,
  ) {}

  async ensureSession(params: {
    candidateId: string;
    assessmentId: string;
    candidateAssessmentId: string;
  }) {
    let session = await this.sessionRepo.findOne({
      where: {
        candidateAssessmentId: params.candidateAssessmentId,
        inactive: 0,
      },
    });
    if (session) return session;

    session = await this.sessionRepo.save(
      this.sessionRepo.create({
        candidateId: params.candidateId,
        assessmentId: params.assessmentId,
        candidateAssessmentId: params.candidateAssessmentId,
        status: InterviewSessionStatus.IN_PROGRESS,
        startedAt: new Date(),
      }),
    );
    return session;
  }

  async addInterviewQuestion(sessionId: string, question: string, sequenceNo: number) {
    return this.questionRepo.save(
      this.questionRepo.create({
        sessionId,
        question,
        questionType: InterviewQuestionType.TECHNICAL,
        sequenceNo,
      }),
    );
  }

  async saveResponse(params: {
    sessionId: string;
    questionId: string;
    transcript: string;
    audioUrl?: string;
    responseDuration?: number;
  }) {
    return this.responseRepo.save(
      this.responseRepo.create({
        sessionId: params.sessionId,
        questionId: params.questionId,
        transcript: params.transcript,
        audioUrl: params.audioUrl ?? null,
        responseDuration: params.responseDuration ?? null,
      }),
    );
  }

  async completeSession(sessionId: string) {
    await this.sessionRepo.update(
      { id: sessionId },
      { status: InterviewSessionStatus.COMPLETED, endedAt: new Date() },
    );
  }
}
