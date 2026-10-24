import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AssessmentSessionStatus } from '../entities/assessment-session.mysql.entity';
import { CandidateQuestionResponseStatus } from '../entities/candidate-question-response.mysql.entity';
import { AssessmentEngineRepository } from './assessment-engine.repository';
import { WorkspaceProviderRegistry } from '../providers/docker-workspace.provider';
import { EvaluationProviderRegistry } from '../providers/evaluation-providers';
import { questionToSection, workspaceFromQuestions } from '../utils/question-adapter.util';
import type { AssessmentDocument } from '../types/assessment-document.types';

@Injectable()
export class AssessmentEngineService {
  constructor(
    private readonly repo: AssessmentEngineRepository,
    private readonly workspaces: WorkspaceProviderRegistry,
    private readonly evaluations: EvaluationProviderRegistry,
  ) {}

  async getAssessmentDetails(assessmentId: string) {
    const details = await this.repo.getAssessmentWithQuestions(assessmentId);
    if (!details) throw new NotFoundException('Assessment not found');
    return details;
  }

  async startSession(input: {
    candidateId: string;
    templateId?: string;
    assessmentId?: string;
    candidateAssessmentId?: string;
  }) {
    let assessmentId = input.assessmentId ?? null;

    if (input.templateId) {
      const template = await this.repo.findTemplate(input.templateId);
      if (!template) throw new NotFoundException('Template not found');
      assessmentId = template.assessmentId ?? assessmentId;
      if (!assessmentId) {
        throw new BadRequestException('Template has no linked assessment — save template first');
      }
    }

    if (!assessmentId) throw new BadRequestException('assessment_id or template_id required');

    const details = await this.repo.getAssessmentWithQuestions(assessmentId);
    if (!details) throw new NotFoundException('Assessment not found');

    const attempt = input.candidateAssessmentId
      ? await this.repo.findAttempt(input.candidateAssessmentId)
      : await this.repo.createCandidateAttempt(input.candidateId, assessmentId);

    if (!attempt) throw new NotFoundException('Candidate attempt not found');

    const session = await this.repo.saveSession({
      candidateId: input.candidateId,
      assessmentId,
      candidateAssessmentId: attempt.id,
      templateId: input.templateId ?? null,
      role: details.assessment.role ?? null,
      assessmentJson: null,
      status: AssessmentSessionStatus.IN_PROGRESS,
      startedAt: new Date(),
    });

    const workspace = workspaceFromQuestions(details.questions);
    await this.workspaces.resolve(workspace).provision({
      sessionId: session.id,
      workspace,
    });

    return {
      sessionId: session.id,
      candidateAssessmentId: attempt.id,
      status: session.status,
      startedAt: session.startedAt,
      assessment: details.assessment,
      questions: details.questions,
    };
  }

  async getSession(sessionId: string) {
    const session = await this.repo.findSession(sessionId);
    if (!session) throw new NotFoundException('Session not found');

    if (!session.assessmentId) {
      throw new BadRequestException('Session has no assessment_id');
    }

    const details = await this.repo.getAssessmentWithQuestions(session.assessmentId);
    const responses = session.candidateAssessmentId
      ? await this.repo.listQuestionResponses(session.candidateAssessmentId)
      : [];
    const evaluations = session.candidateAssessmentId
      ? await this.repo.listQuestionEvaluations(session.candidateAssessmentId)
      : [];

    return {
      sessionId: session.id,
      candidateId: session.candidateId,
      candidateAssessmentId: session.candidateAssessmentId,
      assessmentId: session.assessmentId,
      status: session.status,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      assessment: details?.assessment,
      questions: details?.questions ?? [],
      responses: responses.map((r) => ({
        questionId: r.questionId,
        responseJson: r.responseJson,
        status: r.status,
      })),
      evaluations,
    };
  }

  async submitQuestion(input: {
    candidateAssessmentId: string;
    questionId: string;
    responseJson: Record<string, unknown>;
  }) {
    const attempt = await this.repo.findAttempt(input.candidateAssessmentId);
    if (!attempt) throw new NotFoundException('Attempt not found');

    const details = await this.repo.getAssessmentWithQuestions(attempt.assessmentId);
    const question = details?.questions.find((q) => q.id === input.questionId);
    if (!question) throw new NotFoundException('Question not part of this assessment');

    const response = await this.repo.upsertQuestionResponse({
      candidateAssessmentId: input.candidateAssessmentId,
      questionId: input.questionId,
      responseJson: input.responseJson,
      status: CandidateQuestionResponseStatus.SUBMITTED,
    });

    return { response };
  }

  async evaluateQuestion(input: {
    candidateAssessmentId: string;
    questionId: string;
  }) {
    const attempt = await this.repo.findAttempt(input.candidateAssessmentId);
    if (!attempt) throw new NotFoundException('Attempt not found');

    const details = await this.repo.getAssessmentWithQuestions(attempt.assessmentId);
    const question = details?.questions.find((q) => q.id === input.questionId);
    if (!question) throw new NotFoundException('Question not found');

    const response = await this.repo.findQuestionResponse(
      input.candidateAssessmentId,
      input.questionId,
    );
    if (!response) throw new BadRequestException('Submit a response before evaluation');

    const section = questionToSection(question);
    const document: AssessmentDocument = {
      version: 1,
      meta: {
        title: details!.assessment.title,
        role: details!.assessment.role ?? '',
        difficulty: question.difficulty,
        assessmentType: 'TECHNICAL',
        evaluationMode: (question.evaluationMode?.toLowerCase() ?? 'ai') as never,
      },
      workspace: workspaceFromQuestions(details!.questions),
      sections: [section],
    };

    const mode = section.evaluation?.mode ?? document.meta.evaluationMode ?? 'ai';
    const evaluation = await this.evaluations.resolve(mode).evaluate({
      sessionId: input.candidateAssessmentId,
      section,
      document,
      submission: response.responseJson,
    });

    const result = await this.repo.saveQuestionEvaluation({
      responseId: response.id,
      questionId: input.questionId,
      candidateAssessmentId: input.candidateAssessmentId,
      score: evaluation.overallScore.toFixed(2),
      maxScore: evaluation.maxScore.toFixed(2),
      evaluationJson: evaluation as unknown as Record<string, unknown>,
    });

    await this.repo.upsertQuestionResponse({
      candidateAssessmentId: input.candidateAssessmentId,
      questionId: input.questionId,
      responseJson: response.responseJson,
      status: CandidateQuestionResponseStatus.EVALUATED,
    });

    return { evaluation: result };
  }

  async submitAssessment(candidateAssessmentId: string) {
    const attempt = await this.repo['attemptRepo'].findOne({
      where: { id: candidateAssessmentId, inactive: 0 },
    });
    if (!attempt) throw new NotFoundException('Attempt not found');

    const details = await this.repo.getAssessmentWithQuestions(attempt.assessmentId);
    const evaluations = await this.repo.listQuestionEvaluations(candidateAssessmentId);
    const totalScore = evaluations.reduce((sum, e) => sum + Number(e.score), 0);
    const totalMarks = details?.questions.reduce((s, q) => s + q.marks, 0) ?? 0;

    await this.repo.finalizeAttempt(candidateAssessmentId, totalScore);

    const session = await this.repo.findSessionByAttempt(candidateAssessmentId);
    if (session) {
      await this.repo.updateSession(session.id, {
        status: AssessmentSessionStatus.SUBMITTED,
        submittedAt: new Date(),
      });
    }

    return {
      candidateAssessmentId,
      status: 'SUBMITTED',
      totalScore,
      totalMarks,
      evaluations,
    };
  }

  /** @deprecated Use submitQuestion — kept for backward compat */
  async submitSection(input: {
    sessionId: string;
    sectionId: string;
    submissionType: string;
    submissionData: Record<string, unknown>;
  }) {
    const session = await this.repo.findSession(input.sessionId);
    if (!session?.candidateAssessmentId || !session.assessmentId) {
      throw new BadRequestException('Use submitQuestion with candidate_assessment_id');
    }
    return this.submitQuestion({
      candidateAssessmentId: session.candidateAssessmentId,
      questionId: input.sectionId,
      responseJson: input.submissionData,
    });
  }

  /** @deprecated Use submitAssessment */
  async submitSession(sessionId: string) {
    const session = await this.repo.findSession(sessionId);
    if (!session?.candidateAssessmentId) throw new NotFoundException('Session not found');
    return this.submitAssessment(session.candidateAssessmentId);
  }
}
