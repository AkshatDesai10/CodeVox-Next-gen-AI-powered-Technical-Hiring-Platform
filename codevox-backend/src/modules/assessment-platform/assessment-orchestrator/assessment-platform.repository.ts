import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SessionQuestionQueueMysql } from '../entities/session-question-queue.mysql.entity';
import { EvaluationReviewMysql } from '../entities/evaluation-review.mysql.entity';
import { QuestionMysql } from '../../assessment-execution/entities/question.mysql.entity';
import { QuestionTestCaseMysql } from '../../assessment-execution/entities/question-test-case.mysql.entity';
import { McqOptionMysql } from '../entities/mcq-option.mysql.entity';
import { QuestionOrigin } from '../shared/enums';
import { QuestionType } from '../../assessment-execution/question-type.enum';
import { serializeTestCaseValue } from '../../assessment-execution/utils/output.util';
import {
  extractStarterCodeFromText,
  stripCodeFences,
} from '../shared/starter-code.util';
import type { GeneratedQuestionPayload } from '../assessment-ai/ai-question-generator.service';
import { mcqOptionsFromQuestionJson } from '../shared/mcq-options.util';
import { normalizeAiEnvironment } from '../shared/normalize-ai-environment.util';

function buildQuestionJsonFromPayload(payload: GeneratedQuestionPayload) {
  const extended = payload as GeneratedQuestionPayload & {
    starterCode?: string;
    buggyCode?: string;
    code?: string;
  };
  const problem = payload.problemStatement ?? '';
  const starterCode =
    extended.starterCode?.trim() ||
    extended.buggyCode?.trim() ||
    extended.code?.trim() ||
    extractStarterCodeFromText(problem, payload.language);

  return {
    prompt: stripCodeFences(problem) || problem,
    language: payload.language ?? 'TEXT',
    starterCode,
    requirements: payload.requirements ?? [],
    constraints: [],
    testCases: payload.testCases ?? [],
    options: payload.options ?? [],
    problemStatement: problem,
  };
}

@Injectable()
export class AssessmentPlatformRepository {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(SessionQuestionQueueMysql)
    private readonly queueRepo: Repository<SessionQuestionQueueMysql>,
    @InjectRepository(EvaluationReviewMysql)
    private readonly reviewRepo: Repository<EvaluationReviewMysql>,
    @InjectRepository(QuestionMysql)
    private readonly questionRepo: Repository<QuestionMysql>,
    @InjectRepository(QuestionTestCaseMysql)
    private readonly testCaseRepo: Repository<QuestionTestCaseMysql>,
    @InjectRepository(McqOptionMysql)
    private readonly mcqRepo: Repository<McqOptionMysql>,
  ) {}

  async getQueue(candidateAssessmentId: string) {
    return this.queueRepo.find({
      where: { candidateAssessmentId, inactive: 0 },
      order: { sortOrder: 'ASC' },
    });
  }

  async replaceQueue(
    candidateAssessmentId: string,
    items: Array<{ questionId: string; sortOrder: number; source: QuestionOrigin }>,
  ) {
    await this.queueRepo.update({ candidateAssessmentId }, { inactive: 1 });
    for (const item of items) {
      await this.queueRepo.save(
        this.queueRepo.create({
          candidateAssessmentId,
          questionId: item.questionId,
          sortOrder: item.sortOrder,
          source: item.source,
        }),
      );
    }
  }

  async persistGeneratedQuestion(
    assessmentId: string,
    payload: GeneratedQuestionPayload,
    sortOrder: number,
  ) {
    const questionType = (payload.questionType as QuestionType) ?? QuestionType.CODING;
    const questionJson = buildQuestionJsonFromPayload(payload);
    const question = await this.questionRepo.save(
      this.questionRepo.create({
        title: payload.title,
        description: `${payload.problemStatement}\n\nRequirements:\n${(payload.requirements ?? []).map((r) => `- ${r}`).join('\n')}`,
        questionType,
        difficulty: payload.difficulty ?? 'MEDIUM',
        marks: payload.marks ?? 20,
        language: payload.language ?? 'PYTHON',
        source: QuestionOrigin.AI_GENERATED,
        questionJson,
        workspaceType: payload.language?.toLowerCase() === 'text' ? 'none' : (payload.language?.toLowerCase() ?? 'python'),
        evaluationMode: payload.testCases?.length ? 'HYBRID' : 'AI',
        environmentConfig:
          normalizeAiEnvironment(payload.environmentTemplate) ??
          payload.environmentTemplate ??
          null,
        evaluationConfig: {
          criteria: payload.evaluationCriteria,
          mode: payload.testCases?.length ? 'HYBRID' : 'AI',
          testCases: payload.testCases ?? [],
        },
        aiMetadata: { assessmentId, generated: true },
      }),
    );

    if (payload.testCases?.length) {
      for (const tc of payload.testCases) {
        await this.testCaseRepo.save(
          this.testCaseRepo.create({
            questionId: question.id,
            input: serializeTestCaseValue(tc.input),
            expectedOutput: serializeTestCaseValue(tc.expectedOutput),
            isHidden: tc.isHidden ? 1 : 0,
          }),
        );
      }
    }

    if (questionType === QuestionType.MCQ) {
      const options = mcqOptionsFromQuestionJson(questionJson);
      if (options.length) {
        await this.saveMcqOptions(question.id, options);
      }
    }

    return question;
  }

  async persistToQuestionBank(payload: GeneratedQuestionPayload) {
    return this.persistGeneratedQuestion('0', payload, 0);
  }

  async saveEvaluationReview(data: Partial<EvaluationReviewMysql>) {
    return this.reviewRepo.save(this.reviewRepo.create(data));
  }

  async getStaticAssessmentQuestionIds(assessmentId: string) {
    const rows = await this.dataSource.query(
      `SELECT q.id AS questionId, aq.sort_order AS sortOrder
       FROM assessment_questions aq
       INNER JOIN questions q ON q.id = aq.question_id AND q.inactive = 0
       WHERE aq.assessment_id = ? AND aq.inactive = 0
       ORDER BY aq.sort_order ASC`,
      [assessmentId],
    );
    return rows as Array<{ questionId: string; sortOrder: number }>;
  }

  async getQuestionById(questionId: string) {
    return this.questionRepo.findOne({ where: { id: questionId, inactive: 0 } });
  }

  async saveMcqOptions(questionId: string, options: Array<{ label: string; text: string; isCorrect: boolean }>) {
    await this.mcqRepo.update({ questionId }, { inactive: 1 });
    for (const [index, opt] of options.entries()) {
      await this.mcqRepo.save(
        this.mcqRepo.create({
          questionId,
          label: opt.label,
          text: opt.text,
          isCorrect: opt.isCorrect ? 1 : 0,
          sortOrder: index + 1,
        }),
      );
    }
  }

  async getMcqOptions(questionId: string) {
    const dbRows = await this.mcqRepo.find({
      where: { questionId, inactive: 0 },
      order: { sortOrder: 'ASC' },
    });
    if (dbRows.length) return dbRows;

    const question = await this.questionRepo.findOne({
      where: { id: questionId, inactive: 0 },
    });
    const fromJson = mcqOptionsFromQuestionJson(
      (question?.questionJson ?? null) as Record<string, unknown> | null,
    );
    return fromJson.map((opt, index) =>
      this.mcqRepo.create({
        questionId,
        label: opt.label,
        text: opt.text,
        isCorrect: opt.isCorrect ? 1 : 0,
        sortOrder: index + 1,
      }),
    );
  }
}
