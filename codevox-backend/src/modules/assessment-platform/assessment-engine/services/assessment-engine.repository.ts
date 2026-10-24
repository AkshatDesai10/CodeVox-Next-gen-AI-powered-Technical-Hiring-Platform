import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssessmentMysql } from '../../../assessment-execution/entities/assessment.mysql.entity';
import { QuestionMysql } from '../../../assessment-execution/entities/question.mysql.entity';
import { AssessmentQuestionMysql } from '../../../assessment-execution/entities/assessment-question.mysql.entity';
import { CandidateAssessmentMysql } from '../../../assessment-execution/entities/candidate-assessment.mysql.entity';
import { CandidateAssessmentStatus } from '../../../assessment-execution/candidate-assessment-status.enum';
import { AssessmentStatus } from '../../../assessment-execution/assessment-status.enum';
import { QuestionOrigin, QuestionSourceMode, EvaluationMode, ExperienceLevel } from '../../shared/enums';
import { normalizeAiEnvironment } from '../../shared/normalize-ai-environment.util';
import { QuestionType } from '../../../assessment-execution/question-type.enum';
import {
  AssessmentTemplateMysql,
  AssessmentTemplateStatus,
} from '../entities/assessment-template.mysql.entity';
import {
  AssessmentSessionMysql,
  AssessmentSessionStatus,
} from '../entities/assessment-session.mysql.entity';
import { AssessmentSessionSubmissionMysql } from '../entities/assessment-session-submission.mysql.entity';
import { EvaluationResultMysql } from '../entities/evaluation-result.mysql.entity';
import { AssessmentWorkspaceMysql } from '../entities/assessment-workspace.mysql.entity';
import {
  CandidateQuestionResponseMysql,
  CandidateQuestionResponseStatus,
} from '../entities/candidate-question-response.mysql.entity';
import { QuestionEvaluationMysql } from '../entities/question-evaluation.mysql.entity';
import { McqOptionMysql } from '../../entities/mcq-option.mysql.entity';
import { mcqOptionsFromQuestionJson } from '../../shared/mcq-options.util';
import type {
  AssessmentWithQuestions,
  GeneratedAssessmentBundle,
  GeneratedQuestionPayload,
  LoadedAssessmentQuestion,
} from '../types/assessment-bundle.types';
import { resolveQuestionLanguage } from '../utils/question-language.util';

@Injectable()
export class AssessmentEngineRepository {
  constructor(
    @InjectRepository(AssessmentTemplateMysql)
    private readonly templateRepo: Repository<AssessmentTemplateMysql>,
    @InjectRepository(AssessmentSessionMysql)
    private readonly sessionRepo: Repository<AssessmentSessionMysql>,
    @InjectRepository(AssessmentSessionSubmissionMysql)
    private readonly legacySubmissionRepo: Repository<AssessmentSessionSubmissionMysql>,
    @InjectRepository(EvaluationResultMysql)
    private readonly legacyResultRepo: Repository<EvaluationResultMysql>,
    @InjectRepository(AssessmentWorkspaceMysql)
    private readonly workspaceRepo: Repository<AssessmentWorkspaceMysql>,
    @InjectRepository(AssessmentMysql)
    private readonly assessmentRepo: Repository<AssessmentMysql>,
    @InjectRepository(QuestionMysql)
    private readonly questionRepo: Repository<QuestionMysql>,
    @InjectRepository(AssessmentQuestionMysql)
    private readonly mappingRepo: Repository<AssessmentQuestionMysql>,
    @InjectRepository(CandidateAssessmentMysql)
    private readonly attemptRepo: Repository<CandidateAssessmentMysql>,
    @InjectRepository(CandidateQuestionResponseMysql)
    private readonly responseRepo: Repository<CandidateQuestionResponseMysql>,
    @InjectRepository(QuestionEvaluationMysql)
    private readonly questionEvalRepo: Repository<QuestionEvaluationMysql>,
    @InjectRepository(McqOptionMysql)
    private readonly mcqRepo: Repository<McqOptionMysql>,
  ) {}

  listTemplates(limit = 100) {
    return this.templateRepo.find({
      where: { inactive: 0 },
      order: { id: 'DESC' },
      take: limit,
    });
  }

  findTemplate(id: string) {
    return this.templateRepo.findOne({ where: { id, inactive: 0 } });
  }

  saveTemplate(data: Partial<AssessmentTemplateMysql>) {
    return this.templateRepo.save(this.templateRepo.create(data));
  }

  findSession(id: string) {
    return this.sessionRepo.findOne({ where: { id, inactive: 0 } });
  }

  saveSession(data: Partial<AssessmentSessionMysql>) {
    return this.sessionRepo.save(this.sessionRepo.create(data));
  }

  updateSession(id: string, patch: Partial<AssessmentSessionMysql>) {
    return this.sessionRepo.findOne({ where: { id, inactive: 0 } }).then(async (existing) => {
      if (!existing) return null;
      return this.sessionRepo.save({ ...existing, ...patch });
    });
  }

  async materializeBundle(bundle: GeneratedAssessmentBundle, role: string) {
    const totalMarks = bundle.questions.reduce((s, q) => s + (q.marks ?? 20), 0);

    const assessment = await this.assessmentRepo.save(
      this.assessmentRepo.create({
        title: bundle.assessment.title,
        description: bundle.assessment.description ?? null,
        durationMinutes: bundle.assessment.durationMinutes ?? 60,
        totalMarks,
        status: AssessmentStatus.DRAFT,
        createdBy: '1',
        questionSource: QuestionSourceMode.STATIC,
        evaluationMode: EvaluationMode.AI,
        experienceLevel: ExperienceLevel.MID,
        targetSkills: [bundle.assessment.role ?? role],
        aiConfig: { role: bundle.assessment.role ?? role },
      }),
    );

    for (const [index, q] of bundle.questions.entries()) {
      const question = await this.createQuestionFromPayload(q, index, role);
      await this.mappingRepo.save(
        this.mappingRepo.create({
          assessmentId: assessment.id,
          questionId: question.id,
          marks: q.marks ?? 20,
          sortOrder: q.sortOrder ?? index + 1,
          mandatory: q.mandatory === false ? 0 : 1,
        }),
      );
    }

    return assessment;
  }

  async createQuestionFromPayload(
    payload: GeneratedQuestionPayload,
    index: number,
    role: string,
  ) {
    const questionType = this.mapQuestionType(payload.questionType);
    const language = resolveQuestionLanguage(payload, role);
    const workspaceType = payload.workspaceType ?? (language === 'TEXT' ? 'none' : language.toLowerCase());

    const question = await this.questionRepo.save(
      this.questionRepo.create({
        title: payload.title,
        description: payload.description ?? null,
        questionType,
        difficulty: (payload.difficulty ?? 'MEDIUM').toUpperCase(),
        marks: payload.marks ?? 20,
        language,
        source: QuestionOrigin.AI_GENERATED,
        questionJson: { ...payload.questionJson, language },
        workspaceType,
        evaluationMode: payload.evaluationMode ?? 'AI',
        estimatedDuration: payload.estimatedDuration ?? null,
        status: 'ACTIVE',
        environmentConfig: normalizeAiEnvironment(
          (payload.questionJson.environment as Record<string, unknown> | undefined) ?? null,
        ),
        evaluationConfig: {
          mode: payload.evaluationMode ?? 'AI',
          criteria: payload.questionJson.evaluationCriteria,
          testCases: payload.questionJson.testCases,
        },
        aiMetadata: { sortOrder: payload.sortOrder ?? index + 1 },
      }),
    );

    if (questionType === QuestionType.MCQ) {
      const options = mcqOptionsFromQuestionJson(payload.questionJson);
      if (options.length) {
        await this.mcqRepo.update({ questionId: question.id }, { inactive: 1 });
        for (const [optIndex, opt] of options.entries()) {
          await this.mcqRepo.save(
            this.mcqRepo.create({
              questionId: question.id,
              label: opt.label,
              text: opt.text,
              isCorrect: opt.isCorrect ? 1 : 0,
              sortOrder: optIndex + 1,
            }),
          );
        }
      }
    }

    return question;
  }

  private mapQuestionType(type: string): QuestionType {
    const t = type.toUpperCase();
    if (Object.values(QuestionType).includes(t as QuestionType)) {
      return t as QuestionType;
    }
    return QuestionType.SHORT_ANSWER;
  }

  async getAssessmentWithQuestions(assessmentId: string): Promise<AssessmentWithQuestions | null> {
    const assessment = await this.assessmentRepo.findOne({
      where: { id: assessmentId, inactive: 0 },
    });
    if (!assessment) return null;

    const mappings = await this.mappingRepo.find({
      where: { assessmentId, inactive: 0 },
      order: { sortOrder: 'ASC' },
    });

    const questions: LoadedAssessmentQuestion[] = [];
    for (const m of mappings) {
      const q = await this.questionRepo.findOne({ where: { id: m.questionId, inactive: 0 } });
      if (!q) continue;
      questions.push({
        id: q.id,
        questionType: q.questionType,
        title: q.title,
        description: q.description,
        questionJson: q.questionJson ?? {},
        workspaceType: q.workspaceType,
        evaluationMode: q.evaluationMode,
        difficulty: q.difficulty,
        estimatedDuration: q.estimatedDuration,
        marks: m.marks,
        sortOrder: m.sortOrder,
        mandatory: m.mandatory === 1,
        language: q.language,
        environmentConfig: q.environmentConfig,
        evaluationConfig: q.evaluationConfig,
      });
    }

    return {
      assessment: {
        id: assessment.id,
        title: assessment.title,
        description: assessment.description,
        durationMinutes: assessment.durationMinutes,
        totalMarks: assessment.totalMarks,
        status: assessment.status,
        role: (assessment.aiConfig as { role?: string })?.role ?? null,
      },
      questions,
    };
  }

  async createCandidateAttempt(candidateId: string, assessmentId: string) {
    let attempt = await this.attemptRepo.findOne({
      where: { candidateId, assessmentId, inactive: 0 },
      order: { id: 'DESC' },
    });
    if (!attempt || attempt.status === CandidateAssessmentStatus.SUBMITTED) {
      attempt = await this.attemptRepo.save(
        this.attemptRepo.create({
          candidateId,
          assessmentId,
          status: CandidateAssessmentStatus.IN_PROGRESS,
          startedAt: new Date(),
        }),
      );
    } else if (attempt.status === CandidateAssessmentStatus.ASSIGNED) {
      attempt.status = CandidateAssessmentStatus.IN_PROGRESS;
      attempt.startedAt = new Date();
      await this.attemptRepo.save(attempt);
    }
    return attempt;
  }

  async upsertQuestionResponse(data: {
    candidateAssessmentId: string;
    questionId: string;
    responseJson: Record<string, unknown>;
    status?: CandidateQuestionResponseStatus;
  }) {
    const existing = await this.responseRepo.findOne({
      where: {
        candidateAssessmentId: data.candidateAssessmentId,
        questionId: data.questionId,
        inactive: 0,
      },
    });
    if (existing) {
      existing.responseJson = data.responseJson;
      existing.status = data.status ?? CandidateQuestionResponseStatus.SUBMITTED;
      return this.responseRepo.save(existing);
    }
    return this.responseRepo.save(
      this.responseRepo.create({
        candidateAssessmentId: data.candidateAssessmentId,
        questionId: data.questionId,
        responseJson: data.responseJson,
        status: data.status ?? CandidateQuestionResponseStatus.SUBMITTED,
      }),
    );
  }

  findQuestionResponse(candidateAssessmentId: string, questionId: string) {
    return this.responseRepo.findOne({
      where: { candidateAssessmentId, questionId, inactive: 0 },
    });
  }

  listQuestionResponses(candidateAssessmentId: string) {
    return this.responseRepo.find({
      where: { candidateAssessmentId, inactive: 0 },
    });
  }

  saveQuestionEvaluation(data: Partial<QuestionEvaluationMysql>) {
    return this.questionEvalRepo.save(this.questionEvalRepo.create(data));
  }

  listQuestionEvaluations(candidateAssessmentId: string) {
    return this.questionEvalRepo.find({
      where: { candidateAssessmentId, inactive: 0 },
    });
  }

  async finalizeAttempt(candidateAssessmentId: string, totalScore: number) {
    await this.attemptRepo.update(
      { id: candidateAssessmentId },
      {
        status: CandidateAssessmentStatus.SUBMITTED,
        submittedAt: new Date(),
        score: totalScore.toFixed(2),
      },
    );
  }

  findAttempt(id: string) {
    return this.attemptRepo.findOne({ where: { id, inactive: 0 } });
  }

  publishAssessment(assessmentId: string) {
    return this.assessmentRepo.update({ id: assessmentId }, { status: AssessmentStatus.PUBLISHED });
  }

  findSessionByAttempt(candidateAssessmentId: string) {
    return this.sessionRepo.findOne({ where: { candidateAssessmentId, inactive: 0 } });
  }

  // Legacy session submission support (backward compat)
  upsertLegacySubmission(data: {
    sessionId: string;
    sectionId: string;
    submissionType: string;
    submissionData: Record<string, unknown>;
  }) {
    return this.legacySubmissionRepo.manager.transaction(async (em) => {
      const repo = em.getRepository(AssessmentSessionSubmissionMysql);
      const existing = await repo.findOne({
        where: { sessionId: data.sessionId, sectionId: data.sectionId, inactive: 0 },
      });
      if (existing) {
        existing.submissionType = data.submissionType;
        existing.submissionData = data.submissionData;
        return repo.save(existing);
      }
      return repo.save(repo.create(data));
    });
  }

  saveLegacyEvaluationResult(data: Partial<EvaluationResultMysql>) {
    return this.legacyResultRepo.save(this.legacyResultRepo.create(data));
  }

  listLegacySubmissions(sessionId: string) {
    return this.legacySubmissionRepo.find({ where: { sessionId, inactive: 0 } });
  }

  listLegacyResults(sessionId: string) {
    return this.legacyResultRepo.find({ where: { sessionId, inactive: 0 } });
  }
}
