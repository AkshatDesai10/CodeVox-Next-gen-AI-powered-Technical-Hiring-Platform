import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { AssessmentMysql } from './entities/assessment.mysql.entity';
import { QuestionMysql } from './entities/question.mysql.entity';
import { QuestionTestCaseMysql } from './entities/question-test-case.mysql.entity';
import { AssessmentQuestionMysql } from './entities/assessment-question.mysql.entity';
import { CandidateAssessmentMysql } from './entities/candidate-assessment.mysql.entity';
import { SubmissionMysql } from './entities/submission.mysql.entity';
import { CandidateMysql } from './entities/candidate.mysql.entity';
import { CandidateAssessmentStatus } from './candidate-assessment-status.enum';
import { AssessmentStatus } from './assessment-status.enum';
import { SubmissionStatus } from './submission-status.enum';
import { mapJsonTestCases, readJsonTestCases } from './utils/test-case.util';

export type AssessmentQuestionRow = {
  questionId: string;
  sortOrder: number;
  marks: number;
  title: string;
  description: string | null;
  questionType: string;
  difficulty: string;
  language: string | null;
};

@Injectable()
export class AssessmentExecutionRepository {
  constructor(
    @InjectRepository(AssessmentMysql)
    private readonly assessments: Repository<AssessmentMysql>,
    @InjectRepository(QuestionMysql)
    private readonly questions: Repository<QuestionMysql>,
    @InjectRepository(QuestionTestCaseMysql)
    private readonly testCases: Repository<QuestionTestCaseMysql>,
    @InjectRepository(AssessmentQuestionMysql)
    private readonly assessmentQuestions: Repository<AssessmentQuestionMysql>,
    @InjectRepository(CandidateAssessmentMysql)
    private readonly candidateAssessments: Repository<CandidateAssessmentMysql>,
    @InjectRepository(SubmissionMysql)
    private readonly submissions: Repository<SubmissionMysql>,
    @InjectRepository(CandidateMysql)
    private readonly candidates: Repository<CandidateMysql>,
    private readonly dataSource: DataSource,
  ) {}

  findAssessmentById(id: string) {
    return this.assessments.findOne({ where: { id } });
  }

  findCandidateById(id: string) {
    return this.candidates.findOne({ where: { id } });
  }

  findQuestionById(id: string) {
    return this.questions.findOne({ where: { id } });
  }

  findCandidateAssessmentById(id: string) {
    return this.candidateAssessments.findOne({ where: { id } });
  }

  findCandidateAssessment(candidateId: string, assessmentId: string) {
    return this.candidateAssessments.findOne({
      where: { candidateId, assessmentId },
    });
  }

  async createCandidateAssessment(candidateId: string, assessmentId: string) {
    const row = this.candidateAssessments.create({
      candidateId,
      assessmentId,
      status: CandidateAssessmentStatus.ASSIGNED,
    });
    return this.candidateAssessments.save(row);
  }

  async updateCandidateAssessment(
    id: string,
    patch: Partial<CandidateAssessmentMysql>,
  ) {
    await this.candidateAssessments.update({ id }, patch);
    return this.findCandidateAssessmentById(id);
  }

  async getAssessmentQuestions(assessmentId: string): Promise<AssessmentQuestionRow[]> {
    const rows = await this.dataSource.query(
      `SELECT
        q.id AS questionId,
        aq.sort_order AS sortOrder,
        aq.marks AS marks,
        q.title AS title,
        q.description AS description,
        q.question_type AS questionType,
        q.difficulty AS difficulty,
        q.language AS language
      FROM assessment_questions aq
      INNER JOIN questions q ON q.id = aq.question_id AND q.inactive = 0
      WHERE aq.assessment_id = ?
        AND aq.inactive = 0
      ORDER BY aq.sort_order ASC, aq.id ASC`,
      [assessmentId],
    );

    return rows.map((row: Record<string, unknown>) => ({
      questionId: String(row.questionId ?? row.questionid ?? ''),
      sortOrder: Number(row.sortOrder ?? row.sort_order ?? 0),
      marks: Number(row.marks ?? 0),
      title: String(row.title ?? ''),
      description: row.description != null ? String(row.description) : null,
      questionType: String(row.questionType ?? row.question_type ?? 'CODING'),
      difficulty: String(row.difficulty ?? 'MEDIUM'),
      language: row.language != null ? String(row.language) : null,
    }));
  }

  getPublishedAssessment(assessmentId: string) {
    return this.assessments.findOne({
      where: { id: assessmentId, status: AssessmentStatus.PUBLISHED },
    });
  }

  getVisibleTestCases(questionId: string) {
    return this.testCases.find({
      where: { questionId, isHidden: 0 },
      order: { id: 'ASC' },
    });
  }

  getAllTestCases(questionId: string) {
    return this.testCases.find({
      where: { questionId },
      order: { id: 'ASC' },
    });
  }

  async resolveAllTestCases(questionId: string): Promise<QuestionTestCaseMysql[]> {
    const dbTestCases = await this.getAllTestCases(questionId);
    if (dbTestCases.length) return dbTestCases;

    const question = await this.findQuestionById(questionId);
    if (!question) return [];

    const questionJson = (question.questionJson ?? {}) as Record<string, unknown>;
    const evalConfig = (question.evaluationConfig ?? {}) as Record<string, unknown>;
    const jsonRows = readJsonTestCases(questionJson, evalConfig);
    return mapJsonTestCases(jsonRows, { includeHidden: true, forExecution: true }).map((tc) =>
      this.testCases.create({
        id: tc.id,
        questionId,
        input: tc.input,
        expectedOutput: tc.expectedOutput,
        isHidden: tc.isHidden,
      }),
    );
  }

  getSubmissionsForAttempt(candidateAssessmentId: string) {
    return this.submissions.find({
      where: { candidateAssessmentId },
      order: { questionId: 'ASC' },
    });
  }

  async listSubmissionsPendingAiAnalysis(candidateAssessmentId: string) {
    const rows = await this.dataSource.query(
      `SELECT
         s.question_id AS questionId,
         s.language,
         s.source_code AS sourceCode,
         q.question_type AS questionType
       FROM submissions s
       INNER JOIN questions q ON q.id = s.question_id AND q.inactive = 0
       WHERE s.candidate_assessment_id = ?
         AND s.inactive = 0
         AND TRIM(s.source_code) != ''
         AND q.question_type IN ('CODING', 'SHORT_ANSWER', 'SYSTEM_DESIGN')
         AND (
           s.ai_detection IS NULL
           OR s.ai_code_evaluation IS NULL
         )
       ORDER BY s.question_id ASC`,
      [candidateAssessmentId],
    );
    return rows.map((row: Record<string, unknown>) => ({
      questionId: String(row.questionId ?? row.questionid ?? ''),
      language: String(row.language ?? 'TEXT'),
      sourceCode: String(row.sourceCode ?? row.source_code ?? ''),
      questionType: String(row.questionType ?? row.question_type ?? ''),
    }));
  }

  async listSubmissionsPendingPlagiarism(candidateAssessmentId: string) {
    const rows = await this.dataSource.query(
      `SELECT
         s.question_id AS questionId,
         s.language,
         s.source_code AS sourceCode
       FROM submissions s
       INNER JOIN questions q ON q.id = s.question_id AND q.inactive = 0
       WHERE s.candidate_assessment_id = ?
         AND s.inactive = 0
         AND TRIM(s.source_code) != ''
         AND s.plagiarism_checked_at IS NULL
         AND q.question_type = 'CODING'
       ORDER BY s.question_id ASC`,
      [candidateAssessmentId],
    );
    return rows.map((row: Record<string, unknown>) => ({
      questionId: String(row.questionId ?? row.questionid ?? ''),
      language: String(row.language ?? 'PYTHON'),
      sourceCode: String(row.sourceCode ?? row.source_code ?? ''),
    }));
  }

  async submissionHasAiDetection(
    candidateAssessmentId: string,
    questionId: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT ai_detection AS detection
       FROM submissions
       WHERE candidate_assessment_id = ?
         AND question_id = ?
         AND inactive = 0
       LIMIT 1`,
      [candidateAssessmentId, questionId],
    );
    return rows[0]?.detection != null;
  }

  async submissionHasCodeEvaluation(
    candidateAssessmentId: string,
    questionId: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT ai_code_evaluation AS evaluation
       FROM submissions
       WHERE candidate_assessment_id = ?
         AND question_id = ?
         AND inactive = 0
       LIMIT 1`,
      [candidateAssessmentId, questionId],
    );
    return rows[0]?.evaluation != null;
  }

  /** @deprecated Prefer submissionHasAiDetection / submissionHasCodeEvaluation */
  async submissionAiAlreadyChecked(
    candidateAssessmentId: string,
    questionId: string,
  ): Promise<boolean> {
    const rows = await this.dataSource.query(
      `SELECT ai_checked_at AS aiCheckedAt
       FROM submissions
       WHERE candidate_assessment_id = ?
         AND question_id = ?
         AND inactive = 0
       LIMIT 1`,
      [candidateAssessmentId, questionId],
    );
    const checkedAt = rows[0]?.aiCheckedAt ?? rows[0]?.ai_checked_at;
    return checkedAt != null;
  }

  async getQueueQuestionIds(candidateAssessmentId: string) {
    const rows = await this.dataSource.query(
      `SELECT question_id AS questionId, sort_order AS sortOrder
       FROM session_question_queue
       WHERE candidate_assessment_id = ? AND inactive = 0
       ORDER BY sort_order ASC`,
      [candidateAssessmentId],
    );
    return rows as Array<{ questionId: string; sortOrder: number }>;
  }

  async upsertSubmission(data: {
    candidateAssessmentId: string;
    questionId: string;
    language: string;
    sourceCode: string;
    score?: string | null;
    executionTime?: number | null;
    executionOutput?: string | null;
    evaluationReviewId?: string | null;
    status: SubmissionStatus;
  }) {
    await this.dataSource.query(
      `INSERT INTO submissions (
        candidate_assessment_id, question_id, language, source_code, execution_output,
        evaluation_review_id, score, execution_time, status, inactive
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON DUPLICATE KEY UPDATE
        language = VALUES(language),
        source_code = VALUES(source_code),
        execution_output = VALUES(execution_output),
        evaluation_review_id = VALUES(evaluation_review_id),
        score = VALUES(score),
        execution_time = VALUES(execution_time),
        status = VALUES(status),
        inactive = 0`,
      [
        data.candidateAssessmentId,
        data.questionId,
        data.language,
        data.sourceCode,
        data.executionOutput ?? null,
        data.evaluationReviewId ?? null,
        data.score ?? null,
        data.executionTime ?? null,
        data.status,
      ],
    );
    return this.submissions.findOne({
      where: {
        candidateAssessmentId: data.candidateAssessmentId,
        questionId: data.questionId,
      },
    });
  }

  listCandidateAssignments(candidateId: string) {
    return this.dataSource.query(
      `SELECT
        ca.id AS candidateAssessmentId,
        ca.status AS status,
        ca.started_at AS startedAt,
        ca.submitted_at AS submittedAt,
        ca.score AS score,
        a.id AS assessmentId,
        a.title AS title,
        a.description AS description,
        a.duration_minutes AS durationMinutes,
        a.total_marks AS totalMarks
      FROM assessments a
      INNER JOIN candidate_assessments ca
        ON ca.assessment_id = a.id
        AND ca.candidate_id = ?
        AND ca.inactive = 0
      WHERE a.status = 'PUBLISHED'
        AND a.inactive = 0
      ORDER BY a.id DESC`,
      [candidateId],
    );
  }

  listCandidates() {
    return this.candidates.find({ order: { id: 'DESC' } });
  }

  listAssessments() {
    return this.assessments.find({ where: { inactive: 0 }, order: { id: 'DESC' } });
  }

  async updateAssessment(id: string, patch: { status?: AssessmentStatus }) {
    const existing = await this.assessments.findOne({ where: { id, inactive: 0 } });
    if (!existing) return null;
    if (patch.status !== undefined) {
      existing.status = patch.status;
      return this.assessments.save(existing);
    }
    return existing;
  }

  async getDashboardSummary() {
    const [row] = await this.dataSource.query(
      `SELECT
        (SELECT COUNT(*) FROM candidates WHERE inactive = 0) AS candidateCount,
        (SELECT COUNT(*) FROM job_profiles WHERE inactive = 0) AS assessmentCount,
        (SELECT COUNT(DISTINCT job_application_id) FROM application_round_snapshots WHERE status = 'in_progress' AND inactive = 0) AS activeAttempts,
        (SELECT COUNT(DISTINCT job_application_id) FROM application_round_snapshots WHERE status IN ('submitted', 'graded', 'completed', 'UNDER_REVIEW', 'AUTO_PASS_TO_OFFER') AND inactive = 0) AS completedAttempts`
    );

    const recentActivity = await this.dataSource.query(
      `SELECT 
         c.first_name AS name, 
         jp.title AS role, 
         crs.score_pct AS score
       FROM coding_round_submissions crs
       JOIN job_applications ja ON crs.application_id = ja.id
       JOIN candidates c ON ja.candidate_id = c.id
       JOIN job_profiles jp ON ja.job_profile_id = jp.id
       WHERE crs.status = 'submitted'
       ORDER BY crs.id DESC
       LIMIT 5`
    );

    const topPerformers = await this.dataSource.query(
      `SELECT 
         c.first_name AS name, 
         jp.title AS role, 
         crs.score_pct AS score
       FROM coding_round_submissions crs
       JOIN job_applications ja ON crs.application_id = ja.id
       JOIN candidates c ON ja.candidate_id = c.id
       JOIN job_profiles jp ON ja.job_profile_id = jp.id
       WHERE crs.status = 'submitted' AND crs.score_pct IS NOT NULL
       ORDER BY CAST(crs.score_pct AS DECIMAL(5,2)) DESC
       LIMIT 5`
    );

    const chartRawData = await this.dataSource.query(
      `SELECT 
        dateStr,
        COUNT(DISTINCT candidateKey) as count
      FROM (
        SELECT 
          DATE_FORMAT(s.attempted_at, '%Y-%m-%d') as dateStr,
          CONCAT('cand_', COALESCE(ja.candidate_id, s.job_application_id)) as candidateKey
        FROM application_round_snapshots s
        LEFT JOIN job_applications ja ON s.job_application_id = ja.id
        WHERE s.inactive = 0 AND s.attempted_at IS NOT NULL AND s.attempted_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)

        UNION ALL

        SELECT 
          DATE_FORMAT(COALESCE(ca.submitted_at, ca.started_at), '%Y-%m-%d') as dateStr,
          CONCAT('cand_', ca.candidate_id) as candidateKey
        FROM candidate_assessments ca
        WHERE ca.inactive = 0 
          AND COALESCE(ca.submitted_at, ca.started_at) IS NOT NULL 
          AND COALESCE(ca.submitted_at, ca.started_at) >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)

        UNION ALL

        SELECT 
          DATE_FORMAT(air.created_at, '%Y-%m-%d') as dateStr,
          CONCAT('air_', air.candidate_token) as candidateKey
        FROM autonomous_interview_rounds air
        WHERE air.created_at >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
          AND NOT EXISTS (
            SELECT 1 FROM application_round_snapshots s 
            WHERE s.source_table = 'candidate_autonomous_interviews' 
              AND s.source_id COLLATE utf8mb4_unicode_ci = air.candidate_token
          )
      ) all_conducted
      GROUP BY dateStr
      ORDER BY dateStr ASC`
    );

    const chartData: { day: string; date: string; count: number }[] = [];
    const daysArr = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const targetDate = `${year}-${month}-${day}`;
      
      const found = chartRawData.find((r: any) => String(r.dateStr) === targetDate);

      chartData.push({
        day: daysArr[d.getDay()],
        date: targetDate,
        count: found ? Number(found.count) : 0
      });
    }

    const activeAttempts = Number(row.activeAttempts || 0);

    return {
      candidateCount: Number(row.candidateCount || 0),
      assessmentCount: Number(row.assessmentCount || 0),
      activeAttempts,
      completedAttempts: Number(row.completedAttempts || 0),
      integrity: await this.getIntegritySummary(activeAttempts),
      recentActivity: recentActivity.map((r: any) => ({
        name: r.name,
        role: r.role,
        score: parseFloat(r.score || '0').toFixed(1)
      })),
      topPerformers: topPerformers.map((r: any) => ({
        name: r.name,
        role: r.role,
        score: parseFloat(r.score || '0').toFixed(1)
      })),
      chartData
    };
  }

  /**
   * Live integrity snapshot for the admin dashboard.
   * Active tests are in-progress coding rounds.
   * Flagged counts (last 7 days) are AI-detection reports above 40% AI,
   * assessment submissions above 40% AI or plagiarism-flagged, and proctor
   * sessions with a window blur, hidden tab, or bulk paste.
   * Trust score is the share of those reviewed items that stayed clean.
   */
  async getIntegritySummary(activeTests: number) {
    const [stats] = await this.dataSource.query(
      `SELECT
        (SELECT COUNT(*) FROM ai_detection_reports
          WHERE inactive = 0
            AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND ai_probability IS NOT NULL) AS checkedReports,
        (SELECT COUNT(*) FROM ai_detection_reports
          WHERE inactive = 0
            AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND (ai_probability > 0.4 OR verdict = 'ai_generated')) AS flaggedReports,
        (SELECT COUNT(DISTINCT candidate_assessment_id) FROM submissions
          WHERE inactive = 0
            AND (
              (ai_checked_at IS NOT NULL AND ai_checked_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))
              OR (plagiarism_checked_at IS NOT NULL AND plagiarism_checked_at >= DATE_SUB(NOW(), INTERVAL 7 DAY))
            )) AS checkedAssessments,
        (SELECT COUNT(DISTINCT candidate_assessment_id) FROM submissions
          WHERE inactive = 0
            AND (
              (ai_checked_at IS NOT NULL AND ai_checked_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND ai_probability > 40)
              OR (plagiarism_checked_at IS NOT NULL AND plagiarism_checked_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND plagiarism_flagged = 1)
            )) AS flaggedAssessments,
        (SELECT COUNT(DISTINCT session_token) FROM interview_proctor_events
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)) AS proctorSessions,
        (SELECT COUNT(DISTINCT session_token) FROM interview_proctor_events
          WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
            AND event_type IN ('window_blur', 'tab_hidden', 'bulk_paste_suspected')) AS flaggedProctorSessions`,
    );

    const reviewed =
      Number(stats?.checkedReports || 0) +
      Number(stats?.checkedAssessments || 0) +
      Number(stats?.proctorSessions || 0);
    const flagged =
      Number(stats?.flaggedReports || 0) +
      Number(stats?.flaggedAssessments || 0) +
      Number(stats?.flaggedProctorSessions || 0);
    const denominator = Math.max(reviewed, flagged);
    const averageTrustScore =
      denominator === 0 ? 100 : Math.round((100 * (denominator - flagged)) / denominator);

    return {
      activeTests,
      flaggedCandidates: flagged,
      averageTrustScore,
    };
  }

  async updateSubmissionGrade(
    submissionId: string,
    score: string,
    status: SubmissionStatus,
  ) {
    await this.dataSource.query(
      `UPDATE submissions SET score = ?, status = ? WHERE id = ?`,
      [score, status, submissionId],
    );
  }

  async getHistoricalSubmissionsForQuestion(
    questionId: string,
    excludeCandidateId: string,
    limit = Number(process.env.PLAGIARISM_MAX_HISTORY ?? 200),
  ): Promise<Array<{ candidateId: string; sourceCode: string; language: string }>> {
    const rows = await this.dataSource.query(
      `SELECT ca.candidate_id AS candidateId, s.source_code AS sourceCode, s.language AS language
       FROM submissions s
       INNER JOIN candidate_assessments ca ON ca.id = s.candidate_assessment_id
       WHERE s.question_id = ?
         AND ca.candidate_id != ?
         AND s.inactive = 0
         AND TRIM(s.source_code) != ''
       ORDER BY s.id DESC
       LIMIT ?`,
      [questionId, excludeCandidateId, limit],
    );
    return rows.map((row: Record<string, unknown>) => ({
      candidateId: String(row.candidateId ?? row.candidate_id ?? ''),
      sourceCode: String(row.sourceCode ?? row.source_code ?? ''),
      language: String(row.language ?? 'PHP'),
    }));
  }

  async updateSubmissionPlagiarism(data: {
    candidateAssessmentId: string;
    questionId: string;
    plagiarismScore: number | null;
    plagiarismFlagged: boolean;
    plagiarismCheckedAt: Date;
  }) {
    await this.dataSource.query(
      `UPDATE submissions
       SET plagiarism_score = ?,
           plagiarism_flagged = ?,
           plagiarism_checked_at = ?
       WHERE candidate_assessment_id = ?
         AND question_id = ?
         AND inactive = 0`,
      [
        data.plagiarismScore,
        data.plagiarismFlagged ? 1 : 0,
        data.plagiarismCheckedAt,
        data.candidateAssessmentId,
        data.questionId,
      ],
    );
  }

  async patchSubmissionAiDetection(data: {
    candidateAssessmentId: string;
    questionId: string;
    aiProbability: number;
    detection: {
      aiProbability: number;
      flagged: boolean;
      signals: string[];
    };
  }) {
    await this.dataSource.query(
      `UPDATE submissions
       SET ai_probability = ?,
           ai_checked_at = ?,
           ai_detection = CAST(? AS JSON)
       WHERE candidate_assessment_id = ?
         AND question_id = ?
         AND inactive = 0`,
      [
        data.aiProbability,
        new Date(),
        JSON.stringify(data.detection),
        data.candidateAssessmentId,
        data.questionId,
      ],
    );
  }

  async patchSubmissionCodeEvaluation(data: {
    candidateAssessmentId: string;
    questionId: string;
    evaluation: {
      score: number;
      architecturalFlaws: string[];
      isProductionReady: boolean;
    };
  }) {
    await this.dataSource.query(
      `UPDATE submissions
       SET ai_code_evaluation_checked_at = ?,
           ai_code_evaluation = CAST(? AS JSON)
       WHERE candidate_assessment_id = ?
         AND question_id = ?
         AND inactive = 0`,
      [
        new Date(),
        JSON.stringify(data.evaluation),
        data.candidateAssessmentId,
        data.questionId,
      ],
    );
  }

  async refreshAttemptAiAggregate(candidateAssessmentId: string): Promise<void> {
    const rows = await this.dataSource.query(
      `SELECT MAX(ai_probability) AS maxProbability
       FROM submissions
       WHERE candidate_assessment_id = ?
         AND inactive = 0
         AND ai_probability IS NOT NULL`,
      [candidateAssessmentId],
    );
    const maxProbability = rows[0]?.maxProbability ?? rows[0]?.maxprobability;
    if (maxProbability === null || maxProbability === undefined) return;

    await this.dataSource.query(
      `UPDATE candidate_assessments
       SET ai_generated_percentage = ?
       WHERE id = ?
         AND inactive = 0`,
      [Number(maxProbability), candidateAssessmentId],
    );
  }
}
