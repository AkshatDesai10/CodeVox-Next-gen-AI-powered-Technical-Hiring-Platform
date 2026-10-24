import {

  BadRequestException,

  forwardRef,

  Inject,

  Injectable,

  NotFoundException,

} from '@nestjs/common';

import {

  AssessmentExecutionRepository,

  type AssessmentQuestionRow,

} from './assessment-execution.repository';

import { ExecutionService } from './services/execution.service';

import { EvaluationService } from './services/evaluation.service';

import { CandidateAssessmentStatus } from './candidate-assessment-status.enum';
import { AssessmentStatus } from './assessment-status.enum';

import { SubmissionStatus } from './submission-status.enum';

import { QuestionType } from './question-type.enum';

import type {

  RunCodeDto,

  SaveDraftDto,

  StartAssessmentDto,

  SubmitAssessmentDto,

} from './dto/assessment-execution.dto';

import type { SubmitAnswerDto } from './dto/submit-answer.dto';

import type { UpdateAssessmentDto } from './dto/update-assessment.dto';

import type { SubmissionMysql } from './entities/submission.mysql.entity';

import { AssessmentPlatformRepository } from '../assessment-platform/assessment-orchestrator/assessment-platform.repository';
import { AssessmentReportsService } from '../assessment-reports/assessment-reports.service';
import { mapJsonTestCases, readJsonTestCases } from './utils/test-case.util';



@Injectable()

export class AssessmentExecutionService {

  constructor(

    private readonly repo: AssessmentExecutionRepository,

    private readonly execution: ExecutionService,

    private readonly evaluation: EvaluationService,

    @Inject(forwardRef(() => AssessmentPlatformRepository))
    private readonly platformRepo: AssessmentPlatformRepository,

    private readonly reportsService: AssessmentReportsService,

  ) {}



  async startAssessment(dto: StartAssessmentDto) {

    const candidate = await this.repo.findCandidateById(dto.candidate_id);

    if (!candidate) throw new NotFoundException('Candidate not found');



    const assessment = await this.repo.findAssessmentById(dto.assessment_id);

    if (!assessment) throw new NotFoundException('Assessment not found');



    let attempt = await this.repo.findCandidateAssessment(

      dto.candidate_id,

      dto.assessment_id,

    );



    if (!attempt) {

      attempt = await this.repo.createCandidateAssessment(

        dto.candidate_id,

        dto.assessment_id,

      );

    }



    if (

      attempt.status === CandidateAssessmentStatus.SUBMITTED ||

      attempt.status === CandidateAssessmentStatus.GRADED

    ) {

      throw new BadRequestException('Assessment already submitted');

    }



    if (attempt.status === CandidateAssessmentStatus.ASSIGNED) {

      attempt = await this.repo.updateCandidateAssessment(attempt.id, {

        status: CandidateAssessmentStatus.IN_PROGRESS,

        startedAt: new Date(),

      });

    }



    const questions = await this.buildQuestionsWithVisibleCases(

      dto.assessment_id,

    );



    return {

      candidateAssessmentId: attempt!.id,

      status: attempt!.status,

      startedAt: attempt!.startedAt,

      assessment: {

        id: assessment.id,

        title: assessment.title,

        description: assessment.description,

        durationMinutes: assessment.durationMinutes,

        totalMarks: assessment.totalMarks,

      },

      questions,

    };

  }



  async getAttempt(candidateAssessmentId: string) {

    const attempt = await this.requireAttempt(candidateAssessmentId);

    const assessment = await this.repo.findAssessmentById(attempt.assessmentId);

    if (!assessment) throw new NotFoundException('Assessment not found');



    const questions = await this.buildQuestionsForAttempt(
      candidateAssessmentId,
      attempt.assessmentId,
    );

    const submissions = await this.repo.getSubmissionsForAttempt(

      candidateAssessmentId,

    );



    return {

      candidateAssessmentId: attempt.id,

      candidateId: attempt.candidateId,

      status: attempt.status,

      startedAt: attempt.startedAt,

      submittedAt: attempt.submittedAt,

      score: attempt.score,

      assessment: {

        id: assessment.id,

        title: assessment.title,

        description: assessment.description,

        durationMinutes: assessment.durationMinutes,

        totalMarks: assessment.totalMarks,

      },

      questions,

      submissions: submissions.map((s) => ({

        questionId: s.questionId,

        language: s.language,

        sourceCode: s.sourceCode,

        status: s.status,

        score: s.score,

        executionTime: s.executionTime,

      })),

    };

  }



  async runCode(dto: RunCodeDto) {

    const question = await this.repo.findQuestionById(dto.question_id);

    if (!question) throw new NotFoundException('Question not found');

    const testCases = await this.repo.resolveAllTestCases(dto.question_id);
    const lang = (dto.language ?? '').trim().toUpperCase();
    const sampleInput =
      lang === 'SQL'
        ? dto.input?.trim() || testCases[0]?.input || ''
        : testCases[0]?.input?.trim() || '';

    const result = await this.execution.executeCode(

      dto.language,

      dto.source_code,

      sampleInput,

      {
        question: {
          id: question.id,
          language: question.language,
          workspaceType: question.workspaceType ?? null,
          environmentConfig: question.environmentConfig ?? null,
          evaluationConfig: question.evaluationConfig ?? null,
          questionJson: (question.questionJson as Record<string, unknown> | null) ?? null,
        },
      },

    );



    return {

      stdout: result.stdout,

      stderr: result.stderr,

      executionTime: result.executionTime,

      timedOut: Boolean(result.timedOut),

      success: result.success,

    };

  }



  async saveDraft(dto: SaveDraftDto) {

    const attempt = await this.requireAttempt(dto.candidate_assessment_id);

    this.ensureEditable(attempt.status);



    const submission = await this.repo.upsertSubmission({

      candidateAssessmentId: dto.candidate_assessment_id,

      questionId: dto.question_id,

      language: dto.language,

      sourceCode: dto.source_code,

      status: SubmissionStatus.PENDING,

    });



    return {

      questionId: submission?.questionId,

      status: submission?.status,

      savedAt: new Date().toISOString(),

    };

  }



  async submitAnswer(dto: SubmitAnswerDto) {

    const attempt = await this.requireAttempt(dto.candidate_assessment_id);

    this.ensureEditable(attempt.status);



    const questions = await this.repo.getAssessmentQuestions(attempt.assessmentId);

    const question = questions.find((q) => q.questionId === dto.question_id);

    if (!question) throw new NotFoundException('Question not found in this assessment');

    if (question.questionType !== QuestionType.CODING) {
      return this.submitTextAnswer(dto, question);
    }

    await this.repo.upsertSubmission({

      candidateAssessmentId: dto.candidate_assessment_id,

      questionId: dto.question_id,

      language: dto.language,

      sourceCode: dto.source_code,

      status: SubmissionStatus.RUNNING,

    });



    const testCases = await this.repo.resolveAllTestCases(dto.question_id);
    const questionEntity = await this.repo.findQuestionById(dto.question_id);

    const evaluation = await this.evaluation.evaluateQuestion(

      {

        questionId: question.questionId,

        title: question.title,

        marks: question.marks,

      },

      dto.language,

      dto.source_code,

      testCases,

      questionEntity?.environmentConfig ?? null,

      (questionEntity?.questionJson as Record<string, unknown> | null) ?? null,

      questionEntity?.evaluationConfig ?? null,

    );



    await this.repo.upsertSubmission({

      candidateAssessmentId: dto.candidate_assessment_id,

      questionId: dto.question_id,

      language: dto.language,

      sourceCode: dto.source_code,

      score: evaluation.score.toFixed(2),

      executionTime: evaluation.executionTime,

      executionOutput: evaluation.executionOutput,

      status: evaluation.status,

    });

    const casePayload = JSON.parse(evaluation.executionOutput) as {
      cases: Array<{
        testCaseId: string;
        passed: boolean;
        timedOut: boolean;
        stderr: string;
        stdout: string;
        executionTime: number;
      }>;
    };
    const testCaseById = new Map(testCases.map((tc) => [tc.id, tc]));

    return {

      questionId: evaluation.questionId,

      title: evaluation.title,

      status: evaluation.status,

      score: evaluation.score,

      passedTests: evaluation.passedTests,

      totalTests: evaluation.totalTests,

      passedTestCases: evaluation.passedTestCases,

      totalTestCases: evaluation.totalTestCases,

      percentage: evaluation.percentage,

      executionTime: evaluation.executionTime,

      cases: casePayload.cases.map((row, index) => {
        const tc = testCaseById.get(row.testCaseId) ?? testCases[index];
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



  async submitAssessment(dto: SubmitAssessmentDto) {

    const attempt = await this.requireAttempt(dto.candidate_assessment_id);

    this.ensureEditable(attempt.status);



    const questions = await this.repo.getAssessmentQuestions(

      attempt.assessmentId,

    );

    const existingSubmissions = await this.repo.getSubmissionsForAttempt(

      dto.candidate_assessment_id,

    );

    const draftByQuestion = new Map(

      existingSubmissions.map((s) => [s.questionId, s]),

    );



    const breakdown: Array<{

      questionId: string;

      title: string;

      status: SubmissionStatus;

      score: number;

      passedTestCases: number;

      totalTestCases: number;

      executionTime: number;

    }> = [];



    let totalScore = 0;



    for (const question of questions) {

      const draft = draftByQuestion.get(question.questionId);

      const language = draft?.language || question.language || 'PYTHON';

      const sourceCode = draft?.sourceCode || '';



      if (question.questionType === QuestionType.CODING) {

        const evaluation = await this.resolveCodingEvaluation(

          dto.candidate_assessment_id,

          question,

          language,

          sourceCode,

          draft,

        );

        breakdown.push(evaluation);

        totalScore += evaluation.score;

        continue;

      }



      const status = sourceCode.trim()

        ? SubmissionStatus.PARTIAL

        : SubmissionStatus.PENDING;



      await this.repo.upsertSubmission({

        candidateAssessmentId: dto.candidate_assessment_id,

        questionId: question.questionId,

        language,

        sourceCode,

        score: '0',

        executionTime: 0,

        status,

      });



      breakdown.push({

        questionId: question.questionId,

        title: question.title,

        status,

        score: 0,

        passedTestCases: 0,

        totalTestCases: 0,

        executionTime: 0,

      });

    }



    const totalMarks = questions.reduce((sum, q) => sum + Number(q.marks), 0);

    const updated = await this.repo.updateCandidateAssessment(attempt.id, {

      status: CandidateAssessmentStatus.SUBMITTED,

      submittedAt: new Date(),

      score: totalScore.toFixed(2),

    });



    return {

      candidateAssessmentId: updated!.id,

      status: updated!.status,

      totalScore,

      totalMarks,

      percentage: totalMarks > 0 ? (totalScore / totalMarks) * 100 : 0,

      passed: totalScore > 0,

      breakdown,

    };

  }



  async getResult(candidateAssessmentId: string) {

    const attempt = await this.requireAttempt(candidateAssessmentId);

    const assessment = await this.repo.findAssessmentById(attempt.assessmentId);

    if (!assessment) throw new NotFoundException('Assessment not found');



    const questions = await this.repo.getAssessmentQuestions(

      attempt.assessmentId,

    );

    const submissions = await this.repo.getSubmissionsForAttempt(

      candidateAssessmentId,

    );

    const submissionByQuestion = new Map(

      submissions.map((s) => [s.questionId, s]),

    );



    const breakdown = questions.map((q) => {

      const submission = submissionByQuestion.get(q.questionId);

      const { passedTestCases, totalTestCases } = this.parseExecutionOutput(

        submission?.executionOutput,

      );

      return {

        questionId: q.questionId,

        title: q.title,

        marks: q.marks,

        status: submission?.status ?? SubmissionStatus.PENDING,

        score: Number(submission?.score ?? 0),

        executionTime: submission?.executionTime ?? 0,

        passedTestCases,

        totalTestCases,

      };

    });



    const totalScore = breakdown.reduce((sum, row) => sum + row.score, 0);

    const totalMarks = questions.reduce((sum, q) => sum + Number(q.marks), 0);



    return {

      candidateAssessmentId: attempt.id,

      status: attempt.status,

      submittedAt: attempt.submittedAt,

      totalScore,

      totalMarks,

      percentage: totalMarks > 0 ? (totalScore / totalMarks) * 100 : 0,

      passed: totalScore >= totalMarks * 0.6,

      breakdown,

    };

  }



  listCandidateAssignments(candidateId: string) {

    return this.repo.listCandidateAssignments(candidateId).then((rows) =>

      rows.map((row: Record<string, unknown>) => ({

        candidateAssessmentId:

          row.candidateAssessmentId != null

            ? String(row.candidateAssessmentId)

            : null,

        status: String(row.status ?? 'NOT_ASSIGNED'),

        startedAt: row.startedAt ?? null,

        submittedAt: row.submittedAt ?? null,

        score: row.score != null ? String(row.score) : null,

        assessmentId: String(row.assessmentId),

        title: String(row.title),

        description: row.description != null ? String(row.description) : null,

        durationMinutes: Number(row.durationMinutes),

        totalMarks: Number(row.totalMarks),

      })),

    );

  }



  listCandidates() {

    return this.repo.listCandidates();

  }



  listAssessments() {

    return this.repo.listAssessments();

  }

  async updateAssessment(id: string, dto: UpdateAssessmentDto) {
    const updated = await this.repo.updateAssessment(id, dto);
    if (!updated) throw new NotFoundException('Assessment not found');
    return updated;
  }



  async getDashboardSummary() {
    const rawSummary = await this.repo.getDashboardSummary();
    const reports = await this.reportsService.list({ pageSize: 50 });
    const reportsSummary = await this.reportsService.summary().catch(() => null);

    const recentActivity = reports.items.slice(0, 6).map(r => ({
      applicationId: String(r.applicationId),
      name: r.candidate.name,
      role: r.jobProfile.title,
      score: (r.overallScorePct ?? 0).toFixed(1),
      recommendation: r.recommendation,
      reportStatus: r.reportStatus,
    }));

    const sortedByScore = [...reports.items]
      .filter(r => r.overallScorePct != null)
      .sort((a, b) => (b.overallScorePct!) - (a.overallScorePct!));

    const topPerformers = sortedByScore.slice(0, 5).map(r => ({
      applicationId: String(r.applicationId),
      name: r.candidate.name,
      role: r.jobProfile.title,
      score: (r.overallScorePct ?? 0).toFixed(1),
      recommendation: r.recommendation,
    }));

    const reportsInsights = reportsSummary ? {
      avgCohortScorePct: reportsSummary.avgCohortScorePct,
      strongHireCount: reportsSummary.strongHireCount,
      pendingReviewCount: reportsSummary.pendingReviewCount,
      completedCount: reportsSummary.completedCount,
    } : null;

    return {
      ...rawSummary,
      recentActivity,
      topPerformers,
      reportsInsights,
    };
  }



  async getAssessmentQuestionsPreview(assessmentId: string) {

    const assessment = await this.repo.getPublishedAssessment(assessmentId);

    if (!assessment) throw new NotFoundException('Assessment not found');

    return this.buildQuestionsWithVisibleCases(assessmentId);

  }



  private async resolveCodingEvaluation(

    candidateAssessmentId: string,

    question: AssessmentQuestionRow,

    language: string,

    sourceCode: string,

    existing?: SubmissionMysql,

  ) {

    if (existing && this.evaluation.isGradedStatus(existing.status)) {

      const { passedTestCases, totalTestCases } = this.parseExecutionOutput(

        existing.executionOutput,

      );

      return {

        questionId: question.questionId,

        title: question.title,

        status: existing.status,

        score: Number(existing.score ?? 0),

        passedTestCases,

        totalTestCases,

        executionTime: existing.executionTime ?? 0,

      };

    }



    return this.evaluateAndPersistCodingQuestion(

      candidateAssessmentId,

      question,

      language,

      sourceCode,

    );

  }



  private async evaluateAndPersistCodingQuestion(

    candidateAssessmentId: string,

    question: AssessmentQuestionRow,

    language: string,

    sourceCode: string,

  ) {

    const testCases = await this.repo.resolveAllTestCases(question.questionId);
    const questionEntity = await this.repo.findQuestionById(question.questionId);

    const evaluation = await this.evaluation.evaluateQuestion(

      {

        questionId: question.questionId,

        title: question.title,

        marks: question.marks,

      },

      language,

      sourceCode,

      testCases,

      questionEntity?.environmentConfig ?? null,

      (questionEntity?.questionJson as Record<string, unknown> | null) ?? null,

      questionEntity?.evaluationConfig ?? null,

    );



    await this.repo.upsertSubmission({

      candidateAssessmentId,

      questionId: question.questionId,

      language,

      sourceCode,

      score: evaluation.score.toFixed(2),

      executionTime: evaluation.executionTime,

      executionOutput: evaluation.executionOutput,

      status: evaluation.status,

    });



    return {

      questionId: evaluation.questionId,

      title: evaluation.title,

      status: evaluation.status,

      score: evaluation.score,

      passedTestCases: evaluation.passedTestCases,

      totalTestCases: evaluation.totalTestCases,

      executionTime: evaluation.executionTime,

    };

  }



  private parseExecutionOutput(executionOutput?: string | null) {

    if (!executionOutput) {

      return { passedTestCases: 0, totalTestCases: 0 };

    }

    try {

      const parsed = JSON.parse(executionOutput) as {

        cases?: Array<{ passed?: boolean }>;

      };

      const cases = parsed.cases ?? [];

      return {

        passedTestCases: cases.filter((c) => c.passed).length,

        totalTestCases: cases.length,

      };

    } catch {

      return { passedTestCases: 0, totalTestCases: 0 };

    }

  }



  private async buildQuestionsWithVisibleCases(assessmentId: string) {

    const rows = await this.repo.getAssessmentQuestions(assessmentId);

    return this.mapQuestionsWithCases(rows);

  }

  async buildQuestionsForAttempt(candidateAssessmentId: string, assessmentId: string) {
    const queue = await this.repo.getQueueQuestionIds(candidateAssessmentId);
    if (!queue.length) {
      return this.buildQuestionsWithVisibleCases(assessmentId);
    }

    const allRows = await this.repo.getAssessmentQuestions(assessmentId);
    const aiRows = await Promise.all(
      queue
        .filter((q) => !allRows.some((r) => r.questionId === q.questionId))
        .map(async (q) => {
          const question = await this.repo.findQuestionById(q.questionId);
          if (!question) return null;
          return {
            questionId: question.id,
            sortOrder: q.sortOrder,
            marks: question.marks,
            title: question.title,
            description: question.description,
            questionType: question.questionType,
            difficulty: question.difficulty,
            language: question.language,
          };
        }),
    );

    const merged = [
      ...allRows,
      ...aiRows.filter(Boolean),
    ] as typeof allRows;

    const ordered = queue
      .map((q) => merged.find((r) => r.questionId === q.questionId))
      .filter(Boolean) as typeof allRows;

    return this.mapQuestionsWithCases(ordered.length ? ordered : allRows);
  }

  private async mapQuestionsWithCases(rows: AssessmentQuestionRow[]) {
    return Promise.all(
      rows
        .filter((row) => row.questionId)
        .map(async (row) => {
          const question = await this.repo.findQuestionById(row.questionId);
          const questionJson = (question?.questionJson ?? {}) as Record<string, unknown>;
          const evalConfig = (question?.evaluationConfig ?? {}) as Record<string, unknown>;
          const dbTestCases = await this.repo.getVisibleTestCases(row.questionId);
          const jsonTestCases = readJsonTestCases(questionJson, evalConfig);
          const testCases =
            dbTestCases.length > 0
              ? dbTestCases.map((tc) => ({
                  id: tc.id,
                  input: tc.input,
                  expectedOutput: tc.expectedOutput,
                }))
              : mapJsonTestCases(jsonTestCases, { includeHidden: false }).map((tc) => ({
                  id: tc.id,
                  input: tc.input,
                  expectedOutput: tc.expectedOutput,
                }));
          const dbMcqOptions = await this.platformRepo.getMcqOptions(row.questionId);
          const mcqOptions = dbMcqOptions.map((o) => ({
            label: o.label,
            text: o.text,
          }));
          const description =
            row.description ??
            (questionJson.prompt != null
              ? String(questionJson.prompt)
              : questionJson.question != null
                ? String(questionJson.question)
                : questionJson.scenario != null
                  ? String(questionJson.scenario)
                  : null);
          return {
            id: row.questionId,
            title: row.title,
            description,
            questionType: row.questionType,
            difficulty: row.difficulty,
            marks: row.marks,
            language: row.language,
            sortOrder: row.sortOrder,
            estimatedDuration: question?.estimatedDuration ?? null,
            questionJson,
            testCases,
            mcqOptions,
          };
        }),
    );
  }



  private async submitTextAnswer(dto: SubmitAnswerDto, question: AssessmentQuestionRow) {
    const trimmed = dto.source_code.trim();
    const status = trimmed ? SubmissionStatus.PARTIAL : SubmissionStatus.PENDING;

    await this.repo.upsertSubmission({
      candidateAssessmentId: dto.candidate_assessment_id,
      questionId: dto.question_id,
      language: dto.language || question.language || 'TEXT',
      sourceCode: dto.source_code,
      score: '0',
      executionTime: 0,
      executionOutput: JSON.stringify({
        type: question.questionType,
        manualReview: true,
      }),
      status,
    });

    return {
      questionId: question.questionId,
      title: question.title,
      status,
      score: 0,
      passedTests: 0,
      totalTests: 0,
      passedTestCases: 0,
      totalTestCases: 0,
      percentage: trimmed ? 100 : 0,
      executionTime: 0,
    };
  }



  private async requireAttempt(id: string) {

    const attempt = await this.repo.findCandidateAssessmentById(id);

    if (!attempt) throw new NotFoundException('Candidate assessment not found');

    return attempt;

  }



  private ensureEditable(status: CandidateAssessmentStatus) {

    if (

      status === CandidateAssessmentStatus.SUBMITTED ||

      status === CandidateAssessmentStatus.GRADED

    ) {

      throw new BadRequestException('Assessment already submitted');

    }

  }

}


