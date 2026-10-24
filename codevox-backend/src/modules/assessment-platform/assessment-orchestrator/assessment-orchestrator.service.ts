import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssessmentMysql } from '../../assessment-execution/entities/assessment.mysql.entity';
import { CandidateMysql } from '../../assessment-execution/entities/candidate.mysql.entity';
import { AssessmentExecutionService } from '../../assessment-execution/assessment-execution.service';
import { AssessmentExecutionRepository } from '../../assessment-execution/assessment-execution.repository';
import { QuestionType } from '../../assessment-execution/question-type.enum';
import { SubmissionStatus } from '../../assessment-execution/submission-status.enum';
import type { StartAssessmentDto, SubmitAssessmentDto } from '../../assessment-execution/dto/assessment-execution.dto';
import type { SubmitAnswerDto } from '../../assessment-execution/dto/submit-answer.dto';
import { AiQuestionGeneratorService } from '../assessment-ai/ai-question-generator.service';
import { EvaluationStrategyResolver } from '../assessment-evaluation/evaluation-strategies';
import { EnvironmentProvisionerRegistry } from '../assessment-environment/environment.services';
import { AssessmentInterviewService } from '../assessment-interview/assessment-interview.service';
import { AssessmentPlatformRepository } from './assessment-platform.repository';
import { readJsonTestCases } from '../../assessment-execution/utils/test-case.util';
import { PlagiarismSchedulerService } from '../../assessment-execution/plagiarism/plagiarism-scheduler.service';
import { AiDetectionSchedulerService } from '../../assessment-execution/ai-detection/ai-detection-scheduler.service';
import {
  EvaluationMode,
  EvaluationStrategyType,
  QuestionOrigin,
  QuestionSourceMode,
} from '../shared/enums';

@Injectable()
export class AssessmentOrchestratorService {
  private readonly log = new Logger(AssessmentOrchestratorService.name);

  constructor(
    private readonly execution: AssessmentExecutionService,
    private readonly repo: AssessmentExecutionRepository,
    private readonly platformRepo: AssessmentPlatformRepository,
    private readonly aiGenerator: AiQuestionGeneratorService,
    private readonly evaluationResolver: EvaluationStrategyResolver,
    private readonly environment: EnvironmentProvisionerRegistry,
    private readonly interview: AssessmentInterviewService,
    private readonly plagiarismScheduler: PlagiarismSchedulerService,
    private readonly aiDetectionScheduler: AiDetectionSchedulerService,
    @InjectRepository(AssessmentMysql)
    private readonly assessmentRepo: Repository<AssessmentMysql>,
    @InjectRepository(CandidateMysql)
    private readonly candidateRepo: Repository<CandidateMysql>,
  ) {}

  async startAssessment(dto: StartAssessmentDto) {
    const base = await this.execution.startAssessment(dto);
    const assessment = await this.assessmentRepo.findOne({
      where: { id: dto.assessment_id, inactive: 0 },
    });
    if (!assessment) return base;

    await this.interview.ensureSession({
      candidateId: dto.candidate_id,
      assessmentId: dto.assessment_id,
      candidateAssessmentId: base.candidateAssessmentId,
    });

    const queue = await this.resolveQuestionQueue(
      assessment,
      dto.candidate_id,
      base.candidateAssessmentId,
    );
    if (queue.length) {
      await this.platformRepo.replaceQueue(base.candidateAssessmentId, queue);
    }

    const questions = await this.execution.buildQuestionsForAttempt(
      base.candidateAssessmentId,
      dto.assessment_id,
    );

    return { ...base, questions };
  }

  private async resolveQuestionQueue(
    assessment: AssessmentMysql,
    candidateId: string,
    candidateAssessmentId: string,
  ) {
    const staticRows = await this.platformRepo.getStaticAssessmentQuestionIds(assessment.id);
    const staticItems = staticRows.map((row) => ({
      questionId: String(row.questionId),
      sortOrder: Number(row.sortOrder),
      source: QuestionOrigin.STATIC,
    }));

    if (assessment.questionSource === QuestionSourceMode.STATIC) {
      return staticItems;
    }

    // AI-generated templates materialize questions up front — use them as a fixed set.
    if (
      staticItems.length > 0 &&
      assessment.questionSource === QuestionSourceMode.AI
    ) {
      return staticItems;
    }

    const candidate = await this.candidateRepo.findOne({ where: { id: candidateId, inactive: 0 } });
    const skills = this.parseSkills(candidate?.skills);
    const aiConfig = (assessment.aiConfig ?? {}) as { questionCount?: number };
    const count =
      assessment.questionSource === QuestionSourceMode.AI
        ? aiConfig.questionCount ?? 3
        : Math.max(1, (aiConfig.questionCount ?? 2));

    const generated = await this.aiGenerator.generateBatch({
      candidateAssessmentId,
      assessmentId: assessment.id,
      skills,
      experienceLevel: assessment.experienceLevel,
      difficulty: 'MEDIUM',
      targetSkills: assessment.targetSkills ?? [],
      count,
    });

    const aiItems: Array<{ questionId: string; sortOrder: number; source: QuestionOrigin }> = [];
    let order =
      assessment.questionSource === QuestionSourceMode.HYBRID ? staticItems.length : 0;
    for (const payload of generated) {
      const question = await this.platformRepo.persistGeneratedQuestion(
        assessment.id,
        payload,
        order + 1,
      );
      if (payload.questionType === QuestionType.INTERVIEW) {
        const session = await this.interview.ensureSession({
          candidateId,
          assessmentId: assessment.id,
          candidateAssessmentId,
        });
        await this.interview.addInterviewQuestion(
          session.id,
          payload.problemStatement,
          order + 1,
        );
      }
      aiItems.push({
        questionId: question.id,
        sortOrder: order + 1,
        source: QuestionOrigin.AI_GENERATED,
      });
      order += 1;
    }

    if (assessment.questionSource === QuestionSourceMode.HYBRID) {
      return [...staticItems, ...aiItems];
    }
    return aiItems;
  }

  private parseSkills(raw: unknown): string[] {
    if (Array.isArray(raw)) return raw.map(String);
    if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : [];
      } catch {
        return [];
      }
    }
    return [];
  }

  private async resolveEvaluationMode(
    assessment: AssessmentMysql,
    question: {
      id?: string;
      evaluationConfig?: Record<string, unknown> | null;
      questionJson?: Record<string, unknown> | null;
    } | null,
  ): Promise<EvaluationStrategyType> {
    const evalConfig = question?.evaluationConfig ?? null;
    const questionJson = question?.questionJson ?? null;
    const fromQuestion = evalConfig?.mode as string | undefined;

    const jsonCaseCount = readJsonTestCases(questionJson, evalConfig).length;
    const dbCaseCount = question?.id
      ? (await this.repo.resolveAllTestCases(question.id)).length
      : 0;
    const hasTestCases = jsonCaseCount > 0 || dbCaseCount > 0;

    if (hasTestCases) {
      if (fromQuestion === 'HYBRID' || assessment.evaluationMode === EvaluationMode.HYBRID) {
        return EvaluationStrategyType.HYBRID;
      }
      return EvaluationStrategyType.TESTCASE;
    }

    if (fromQuestion === 'AI') return EvaluationStrategyType.AI;
    if (fromQuestion === 'HYBRID') return EvaluationStrategyType.HYBRID;
    if (fromQuestion === 'TESTCASE') return EvaluationStrategyType.TESTCASE;
    if (assessment.evaluationMode === EvaluationMode.AI) return EvaluationStrategyType.AI;
    if (assessment.evaluationMode === EvaluationMode.HYBRID) return EvaluationStrategyType.HYBRID;
    return EvaluationStrategyType.TESTCASE;
  }

  async submitAnswer(dto: SubmitAnswerDto) {
    const attempt = await this.repo.findCandidateAssessmentById(dto.candidate_assessment_id);
    if (!attempt) throw new NotFoundException('Candidate assessment not found');

    const questions = await this.repo.getAssessmentQuestions(attempt.assessmentId);
    const questionRow = questions.find((q) => q.questionId === dto.question_id);
    if (!questionRow) throw new NotFoundException('Question not found in this assessment');

    const question = await this.platformRepo.getQuestionById(dto.question_id);
    const assessment = await this.assessmentRepo.findOne({
      where: { id: attempt.assessmentId, inactive: 0 },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    if (questionRow.questionType === QuestionType.MCQ) {
      return this.submitMcqAnswer(dto, questionRow, assessment);
    }

    if (
      questionRow.questionType !== QuestionType.CODING &&
      questionRow.questionType !== QuestionType.SYSTEM_DESIGN
    ) {
      return this.execution.submitAnswer(dto);
    }

    await this.environment.provisionForQuestion(
      dto.candidate_assessment_id,
      dto.question_id,
      question?.environmentConfig,
    );

    const mode = await this.resolveEvaluationMode(assessment, question);
    const strategy = this.evaluationResolver.resolve(mode);

    await this.repo.upsertSubmission({
      candidateAssessmentId: dto.candidate_assessment_id,
      questionId: dto.question_id,
      language: dto.language,
      sourceCode: dto.source_code,
      status: SubmissionStatus.RUNNING,
    });

    const evaluation = await strategy.evaluate({
      candidateAssessmentId: dto.candidate_assessment_id,
      questionId: dto.question_id,
      questionTitle: questionRow.title,
      marks: questionRow.marks,
      language: dto.language,
      sourceCode: dto.source_code,
      questionType: questionRow.questionType,
      evaluationConfig: question?.evaluationConfig ?? null,
      environmentConfig: question?.environmentConfig ?? null,
      questionJson: (question?.questionJson as Record<string, unknown> | null) ?? null,
      problemDescription: question?.description ?? questionRow.description,
    });

    const review = await this.platformRepo.saveEvaluationReview({
      candidateAssessmentId: dto.candidate_assessment_id,
      questionId: dto.question_id,
      strategy: evaluation.strategy,
      score: evaluation.score.toFixed(2),
      maxScore: evaluation.maxScore.toFixed(2),
      strengths: evaluation.strengths ?? null,
      weaknesses: evaluation.weaknesses ?? null,
      recommendations: evaluation.recommendations ?? null,
      rubricJson: evaluation.rubricJson ?? null,
    });

    await this.repo.upsertSubmission({
      candidateAssessmentId: dto.candidate_assessment_id,
      questionId: dto.question_id,
      language: dto.language,
      sourceCode: dto.source_code,
      score: evaluation.score.toFixed(2),
      executionTime: evaluation.executionTime,
      executionOutput: evaluation.executionOutput ?? null,
      status: evaluation.status as SubmissionStatus,
      evaluationReviewId: review.id,
    });

    const testCases = await this.repo.resolveAllTestCases(dto.question_id);
    const casePayload = evaluation.executionOutput
      ? (JSON.parse(evaluation.executionOutput) as {
          cases: Array<{
            testCaseId: string;
            passed: boolean;
            timedOut: boolean;
            stderr: string;
            stdout: string;
            executionTime: number;
          }>;
        })
      : null;
    const testCaseById = new Map(testCases.map((tc) => [tc.id, tc]));

    return {
      questionId: dto.question_id,
      title: questionRow.title,
      status: evaluation.status,
      score: evaluation.score,
      passedTests: evaluation.passedTests ?? 0,
      totalTests: evaluation.totalTests ?? 0,
      passedTestCases: evaluation.passedTests ?? 0,
      totalTestCases: evaluation.totalTests ?? 0,
      percentage: evaluation.percentage ?? 0,
      executionTime: evaluation.executionTime,
      evaluationReview: {
        strengths: evaluation.strengths,
        weaknesses: evaluation.weaknesses,
        recommendations: evaluation.recommendations,
      },
      cases: casePayload?.cases.map((row, index) => {
        const tc = testCaseById.get(row.testCaseId);
        const hidden = Boolean(tc?.isHidden);
        return {
          index: index + 1,
          passed: row.passed,
          timedOut: row.timedOut,
          stdout: row.stdout,
          stderr: row.stderr,
          hidden,
          input: hidden ? undefined : tc?.input,
          expectedOutput: hidden ? undefined : tc?.expectedOutput,
        };
      }),
    };
  }

  private async submitMcqAnswer(
    dto: SubmitAnswerDto,
    questionRow: { questionId: string; title: string; marks: number },
    _assessment: AssessmentMysql,
  ) {
    const options = await this.platformRepo.getMcqOptions(dto.question_id);
    const selected = dto.source_code.trim().toUpperCase();
    const correct = options.find((o) => o.isCorrect === 1);
    const passed = correct?.label.toUpperCase() === selected;
    const score = passed ? questionRow.marks : 0;
    const status = passed ? SubmissionStatus.PASSED : SubmissionStatus.FAILED;

    await this.repo.upsertSubmission({
      candidateAssessmentId: dto.candidate_assessment_id,
      questionId: dto.question_id,
      language: 'MCQ',
      sourceCode: dto.source_code,
      score: score.toFixed(2),
      executionTime: 0,
      status,
    });

    return {
      questionId: dto.question_id,
      title: questionRow.title,
      status,
      score,
      passedTests: passed ? 1 : 0,
      totalTests: 1,
      passedTestCases: passed ? 1 : 0,
      totalTestCases: 1,
      percentage: passed ? 100 : 0,
      executionTime: 0,
    };
  }

  async submitAssessment(dto: SubmitAssessmentDto) {
    const attempt = await this.repo.findCandidateAssessmentById(dto.candidate_assessment_id);
    if (!attempt) throw new NotFoundException('Candidate assessment not found');

    await this.environment.teardownAttempt(dto.candidate_assessment_id);
    const result = await this.execution.submitAssessment(dto);

    // AI detection/evaluation + plagiarism run once on final submit, not per-question submit.
    void this.aiDetectionScheduler
      .scheduleAttemptAnalysis(attempt.candidateId, dto.candidate_assessment_id)
      .catch((err) =>
        this.log.warn(
          `Post-submit AI scheduling failed attempt=${dto.candidate_assessment_id}: ${String(err)}`,
        ),
      );
    void this.plagiarismScheduler
      .scheduleAttemptPlagiarism(attempt.candidateId, dto.candidate_assessment_id)
      .catch((err) =>
        this.log.warn(
          `Post-submit plagiarism scheduling failed attempt=${dto.candidate_assessment_id}: ${String(err)}`,
        ),
      );

    return result;
  }

  async respondInterview(dto: {
    candidate_assessment_id: string;
    question_id: string;
    transcript: string;
    audio_url?: string;
    response_duration?: number;
  }) {
    const attempt = await this.repo.findCandidateAssessmentById(dto.candidate_assessment_id);
    if (!attempt) throw new NotFoundException('Attempt not found');

    const session = await this.interview.ensureSession({
      candidateId: attempt.candidateId,
      assessmentId: attempt.assessmentId,
      candidateAssessmentId: attempt.id,
    });

    const response = await this.interview.saveResponse({
      sessionId: session.id,
      questionId: dto.question_id,
      transcript: dto.transcript,
      audioUrl: dto.audio_url,
      responseDuration: dto.response_duration,
    });

    await this.repo.upsertSubmission({
      candidateAssessmentId: dto.candidate_assessment_id,
      questionId: dto.question_id,
      language: 'TEXT',
      sourceCode: dto.transcript,
      status: SubmissionStatus.PARTIAL,
      score: '0',
      executionTime: 0,
    });

    return { responseId: response.id, status: SubmissionStatus.PARTIAL };
  }

  async previewGeneration(assessmentId: string) {
    const assessment = await this.assessmentRepo.findOne({
      where: { id: assessmentId, inactive: 0 },
    });
    if (!assessment) throw new NotFoundException('Assessment not found');

    return this.aiGenerator.generateBatch({
      assessmentId,
      skills: assessment.targetSkills ?? [],
      experienceLevel: assessment.experienceLevel,
      difficulty: 'MEDIUM',
      targetSkills: assessment.targetSkills ?? [],
      count: (assessment.aiConfig as { questionCount?: number })?.questionCount ?? 2,
    });
  }
}
