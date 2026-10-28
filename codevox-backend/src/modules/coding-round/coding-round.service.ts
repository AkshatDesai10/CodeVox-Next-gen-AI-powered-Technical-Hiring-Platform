import { Injectable, Logger, NotFoundException, BadRequestException, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { TestCaseResult } from './coding-round-submission.entity';
import { CodingRoundSubmissionEntity } from './coding-round-submission.entity';
import { OpenAiClientService } from '../assessment-platform/assessment-ai/openai-client.service';
import { JobProfilePipelineService } from '../job-profiles/job-profile-pipeline.service';
import { CodingRoundProblemPickerService } from './coding-round-problem-picker.service';
import {
  CodingRoundConfig,
  LANGUAGE_DOCKER_IMAGE,
  LANGUAGE_FILE_EXT,
  DEFAULT_STARTER,
} from './coding-round.types';
import { RoundSnapshotService } from '../assessment-reports/round-snapshot.service';

// ---------------------------------------------------------------------------
// Types imported from other modules (avoid circular deps)
// ---------------------------------------------------------------------------
type ApplicationRow = {
  id: string;
  job_profile_id: string;
  candidateId: string;
  status: string;
  candidateToken: string;
};

type RoundConfig = CodingRoundConfig & {
  question_strategy?: string;
  total_problems?: number;
  coding_problem_count?: number;
  sql_problem_count?: number;
};

type StageRow = {
  stageKey: string;
  name: string;
  roundConfig: CodingRoundConfig | null;
};

@Injectable()
export class CodingRoundService {
  private readonly logger = new Logger(CodingRoundService.name);
  /** If background grading never finishes (process crash), unlock UI after this. */
  private static readonly STUCK_GRADING_MS = 30 * 60 * 1000;

  constructor(
    @InjectRepository(CodingRoundSubmissionEntity)
    private readonly submissions: Repository<CodingRoundSubmissionEntity>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly openai: OpenAiClientService,
    private readonly problemPicker: CodingRoundProblemPickerService,
    @Inject(forwardRef(() => JobProfilePipelineService))
    private readonly pipeline: JobProfilePipelineService,
    private readonly roundSnapshots: RoundSnapshotService,
  ) {}

  private stageKeyOf(stage: { stage_key?: string; stageKey?: string }): string {
    return String(stage.stage_key ?? stage.stageKey ?? '');
  }

  private findSubmission(applicationId: string, stageKey: string) {
    return this.submissions.findOne({
      where: { applicationId: String(applicationId), stageKey, inactive: false },
      order: { updatedAt: 'DESC' },
    });
  }

  private isStuckGrading(submission: CodingRoundSubmissionEntity): boolean {
    if (submission.status !== 'grading') return false;
    const anchor = submission.submittedAt ?? submission.updatedAt;
    if (!anchor) return false;
    return Date.now() - new Date(anchor).getTime() > CodingRoundService.STUCK_GRADING_MS;
  }

  private parseAssignedProblemIds(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.map((id) => String(id).trim()).filter(Boolean);
    }
    if (typeof value === 'string' && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.map((id) => String(id).trim()).filter(Boolean);
        }
      } catch {
        return [];
      }
    }
    return [];
  }

  private async loadProblemsFromStage(stageId: string) {
    const questions = await this.dataSource.query('SELECT * FROM job_profile_questions WHERE stage_id = ? AND inactive = 0 ORDER BY sort_order ASC', [stageId]);
    const ids: string[] = [];
    const seenProblemIds = new Set<string>();

    for (const q of questions) {
       let pId = null;
       try { pId = typeof q.metadata === 'string' ? JSON.parse(q.metadata).problem_bank_id : (q.metadata?.problem_bank_id); } catch(e){}
       if (!pId) continue;
       const id = String(pId);
       if (seenProblemIds.has(id)) continue;
       seenProblemIds.add(id);
       ids.push(id);
    }
    return this.loadProblemsByIds(ids);
  }

  private async loadProblemsByIds(ids: string[]) {
    const problems: any[] = [];
    for (const pId of ids) {
      const problem = await this.hydrateProblem(pId);
      if (problem) problems.push(problem);
    }
    return problems;
  }

  private async hydrateProblem(pId: string) {
       const [pb] = await this.dataSource.query('SELECT * FROM problem_bank_problems WHERE id = ?', [pId]);
       if (!pb) return null;
       
       const tcs = await this.dataSource.query('SELECT * FROM problem_bank_test_cases WHERE problem_id = ? AND inactive=0 ORDER BY sort_order ASC', [pId]);
       const langs = await this.dataSource.query('SELECT * FROM problem_bank_language_templates WHERE problem_id = ? AND inactive=0', [pId]);
       
       const starter_code: Record<string, string> = {};
       for (const l of langs) starter_code[l.language_code] = l.starter_code || '';
       
       let parsedTestCases = tcs.map((t: any) => ({
            id: t.id.toString(),
            name: t.description || 'Test Case',
            input: t.input_value,
            expected_output: t.expected_output,
            is_visible: t.is_visible ? true : false
       }));

       let evaluation_config: any = null;
       if (pb.evaluation_config) {
         try { evaluation_config = typeof pb.evaluation_config === 'string' ? JSON.parse(pb.evaluation_config) : pb.evaluation_config; } catch (e) {}
       }

       if (parsedTestCases.length === 0 && (pb.workspace_type === 'sql' || pb.title.toLowerCase().includes('sql'))) {
          // Extract DDL and Seed Data from the stashed evaluation_config or environment_config
          let environment_config: any = null;
          if (pb.environment_config) {
             try { environment_config = typeof pb.environment_config === 'string' ? JSON.parse(pb.environment_config) : pb.environment_config; } catch (e) {}
          }
          const ddl = evaluation_config?.database_setup?.ddl_sql || environment_config?.database_assessment?.ddl_sql || '';
          const insert = evaluation_config?.database_setup?.insert_sql || environment_config?.database_assessment?.seed_sql || '';
          const setupSql = `${ddl}\n;\n${insert}`.trim();
          
          if (setupSql && setupSql.length > 5) {
             parsedTestCases = [{
                id: 'sql_sandbox_1',
                name: 'Query Output (Sandbox)',
                input: setupSql,
                expected_output: '',
                is_visible: true
             }];
          } else {
             // Fallback for older problems that don't have database_setup stashed
             const sqlBlocks = [...pb.statement_md.matchAll(/```sql\s*([\s\S]*?)```/g)].map(m => m[1].trim());
             if (sqlBlocks.length > 0) {
                 parsedTestCases = [{
                    id: 'sql_sandbox_1',
                    name: 'Query Output (Sandbox)',
                    input: sqlBlocks.join(';\n'),
                    expected_output: '',
                    is_visible: true
                 }];
             }
          }
       }

       return {
         id: pb.id.toString(),
         title: pb.title,
         workspace_type: pb.workspace_type,
         evaluation_mode: pb.evaluation_mode,
         evaluation_config,
         difficulty: pb.difficulty ?? 'medium',
         marks: pb.marks ?? 10,
         // Assessment clock is fixed at 5 min/question (judge timeout stays in problem env).
         time_limit_minutes: 5,
         description_md: pb.statement_md,
         constraints: '',
         examples: [],
         starter_code,
         test_cases: parsedTestCases
       };
  }

  private async loadProblemsForAttempt(
    application: ApplicationRow,
    stage: { id: string; stage_key?: string; stageKey?: string },
    config: RoundConfig,
  ) {
    if (config.question_strategy === 'bank_only') {
      const ids = await this.ensureAssignedProblemIds(application, stage, config);
      return this.loadProblemsByIds(ids);
    }
    return this.loadProblemsFromStage(stage.id);
  }

  private bankPickCounts(config: RoundConfig): { codingCount: number; sqlCount: number } {
    const hasSplit =
      config.coding_problem_count != null || config.sql_problem_count != null;
    if (hasSplit) {
      return {
        codingCount: Number(config.coding_problem_count ?? 0),
        sqlCount: Number(config.sql_problem_count ?? 0),
      };
    }
    return {
      codingCount: Number(config.total_problems ?? 3),
      sqlCount: 0,
    };
  }

  private async ensureAssignedProblemIds(
    application: ApplicationRow,
    stage: { id: string; stage_key?: string; stageKey?: string },
    config: RoundConfig,
  ): Promise<string[]> {
    const stageKey = this.stageKeyOf(stage);
    let submission = await this.findSubmission(String(application.id), stageKey);
    const existing = this.parseAssignedProblemIds(submission?.assignedProblemIds);
    if (existing.length) return existing;

    const { codingCount, sqlCount } = this.bankPickCounts(config);
    const ids = await this.problemPicker.pickProblemIds({
      jobProfileId: String(application.job_profile_id),
      stageId: String(stage.id),
      candidateId: String(application.candidateId),
      codingCount,
      sqlCount,
    });

    if (!submission) {
      submission = this.submissions.create({
        applicationId: String(application.id),
        stageKey,
        status: 'in_progress',
        inactive: false,
        assignedProblemIds: ids,
      });
    } else {
      submission.assignedProblemIds = ids;
    }
    try {
      await this.submissions.save(submission);
    } catch (err: any) {
      // Race: another request inserted the unique row — reuse it
      const raced = await this.findSubmission(String(application.id), stageKey);
      const racedIds = this.parseAssignedProblemIds(raced?.assignedProblemIds);
      if (racedIds.length) return racedIds;
      throw err;
    }
    return ids;
  }

  // -------------------------------------------------------------------------
  // Load problem for the candidate
  // -------------------------------------------------------------------------
  async getProblem(token: string, dataSource: any) {
    const { application, stage, config } = await this.resolveContext(token, dataSource);
    const actualProblems = await this.loadProblemsForAttempt(application, stage, config);

    // Mask hidden test cases for all problems
    const problems = actualProblems.map(p => ({
      id: p.id,
      title: p.title,
      description_md: p.description_md,
      difficulty: p.difficulty ?? 'medium',
      marks: p.marks ?? 10,
      time_limit_minutes: 5,
      constraints: p.constraints,
      examples: p.examples,
      workspace_type: p.workspace_type,
      starter_code: p.starter_code ?? DEFAULT_STARTER,
      visible_test_cases: (p.test_cases ?? []).filter((tc) => tc.is_visible).map(tc => ({ id: tc.id, name: tc.name, input: tc.input, expected_output: tc.expected_output }))
    }));

    // Last saved submission (if any)
    let last = await this.findSubmission(String(application.id), this.stageKeyOf(stage));
    if (last && this.isStuckGrading(last)) {
      this.logger.warn(
        `Stuck grading recovered for application ${application.id} stage ${this.stageKeyOf(stage)}`,
      );
      await this.markGradingFailed(String(application.id), this.stageKeyOf(stage), 0);
      last = await this.findSubmission(String(application.id), this.stageKeyOf(stage));
    }

    const progression = stage.progression as any;
    const mode = progression?.mode ?? 'continue';
    const thresholdRaw = Number(progression?.elimination_threshold);
    const elimination_threshold = Number.isFinite(thresholdRaw) ? thresholdRaw : 50;
    const threshold = mode === 'elimination' ? elimination_threshold : null;
    const minutesPerQuestion = 5;
    const totalTimeLimitMinutes = Math.max(minutesPerQuestion, problems.length * minutesPerQuestion);

    return {
      problems,
      languages: config.languages?.length ? config.languages : Object.keys(LANGUAGE_DOCKER_IMAGE),
      time_limit_minutes: totalTimeLimitMinutes,
      threshold,
      last_submission: last
        ? {
            status: last.status,
            score_pct: last.scorePct,
            problem_submissions: last.problemSubmissions || {}
          }
        : null,
    };
  }

  // -------------------------------------------------------------------------
  // Run code against VISIBLE test cases only
  // -------------------------------------------------------------------------
  async runCode(
    token: string,
    problemId: string,
    language: string,
    sourceCode: string,
    dataSource: any,
  ) {
    const { application, stage, config } = await this.resolveContext(token, dataSource);

    const submission = await this.findSubmission(String(application.id), this.stageKeyOf(stage));
    if (submission && ['grading', 'submitted', 'error'].includes(submission.status)) {
      throw new BadRequestException('Cannot run code. Assessment already submitted.');
    }

    const actualProblems = await this.loadProblemsForAttempt(application, stage, config);

    const problem = actualProblems.find(p => p.id === String(problemId));
    if (!problem) throw new NotFoundException(`Problem ${problemId} not found`);

    const langInfo = LANGUAGE_DOCKER_IMAGE[language];
    if (!langInfo) throw new BadRequestException(`Unsupported language: ${language}`);

    const visibleCases = (problem.test_cases ?? []).filter((tc) => tc.is_visible);
    if (!visibleCases.length) {
      return { results: [], message: 'No visible test cases configured.' };
    }

    const results = await this.executeAgainstCases(language, sourceCode, visibleCases, true);

    // Auto-save progress
    await this.upsertProblemSubmission(application.id, this.stageKeyOf(stage), problemId, language, sourceCode, results, false);

    return { results };
  }

  // -------------------------------------------------------------------------
  // Final submit — run ALL test cases including hidden
  // -------------------------------------------------------------------------
  async submitCode(
    token: string,
    submissionsMap: Record<string, { language: string; source_code: string }>,
    dataSource: any,
  ) {
    const { application, stage, config } = await this.resolveContext(token, dataSource);
    const actualProblems = await this.loadProblemsForAttempt(application, stage, config);

    // Synchronously mark as grading to prevent retries
    let submission = await this.findSubmission(String(application.id), this.stageKeyOf(stage));

    if (submission) {
      if (submission.status === 'submitted' || submission.status === 'error') {
        throw new BadRequestException('Assessment already submitted.');
      }
      if (submission.status === 'grading') {
        if (this.isStuckGrading(submission)) {
          await this.markGradingFailed(String(application.id), this.stageKeyOf(stage), 0);
          throw new BadRequestException('Assessment already submitted.');
        }
        return { pending: true }; // Idempotent return
      }
    }

    // Take snapshot of submitted code for robustness
    const problemSubmissionsSnapshot: Record<string, any> = {};
    for (const p of actualProblems) {
       const sub = submissionsMap[p.id];
       if (sub) {
         problemSubmissionsSnapshot[p.id] = { language: sub.language, sourceCode: sub.source_code, testResults: [], scorePct: null };
       }
    }

    if (submission) {
      submission.status = 'grading';
      submission.problemSubmissions = problemSubmissionsSnapshot;
      submission.submittedAt = new Date();
      await this.submissions.save(submission);
    } else {
      submission = this.submissions.create({
        applicationId: String(application.id),
        stageKey: this.stageKeyOf(stage),
        status: 'grading',
        inactive: false,
        problemSubmissions: problemSubmissionsSnapshot,
        assignedProblemIds: actualProblems.map(p => p.id),
        submittedAt: new Date(),
      });
      await this.submissions.save(submission);
    }

    // Run grading asynchronously in the background so the candidate doesn't wait
    this.backgroundEvaluate(application, stage, actualProblems, submissionsMap, dataSource).catch(async err => {
       this.logger.error('Background AI evaluation failed', err);
       // Safety net if backgroundEvaluate itself rejects without handling
       try {
         await this.markGradingFailed(application.id, this.stageKeyOf(stage), 0);
         if (application.candidateToken) {
           await this.pipeline.finishRound(application.candidateToken, { score: 0, stageId: stage.id });
         }
       } catch (e) {
         this.logger.error('Failed to set fallback error status', e);
       }
    });

    return { pending: true };
  }

  private async backgroundEvaluate(
    application: any,
    stage: any,
    actualProblems: any[],
    submissionsMap: Record<string, { language: string; source_code: string }>,
    dataSource: any,
  ) {
    let partialProblemSubmissions: Record<string, any> = {};
    let partialTotalScorePoints = 0;
    let partialTotalPossiblePoints = 0;

    try {
      let totalScorePoints = 0;
      let totalPossiblePoints = 0;
      let totalPassed = 0;
      let totalCases = 0;
      const problemSubmissions: Record<string, any> = {};

      for (const problem of actualProblems) {
        const allCases = problem.test_cases ?? [];
        totalCases += allCases.length;
        totalPossiblePoints += problem.marks;
        partialTotalPossiblePoints += problem.marks;

        const sub = submissionsMap[problem.id];
        if (!sub || !sub.language || !sub.source_code || !LANGUAGE_DOCKER_IMAGE[sub.language]) {
          problemSubmissions[problem.id] = {
            language: sub?.language || 'python',
            sourceCode: sub?.source_code || '',
            testResults: [],
            scorePct: 0
          };
          partialProblemSubmissions[problem.id] = problemSubmissions[problem.id];
          continue;
        }

        // Run against Sandbox/Test Cases
        const results = await this.executeAgainstCases(sub.language, sub.source_code, allCases, false);
        const passed = results.filter((r) => r.passed).length;
        totalPassed += passed;

        let scorePct = 0;

        // -----------------------------------------------------
        // AI Hybrid Grading (for SQL and AI_HYBRID problems)
        // -----------------------------------------------------
        if (problem.workspace_type === 'sql' || problem.evaluation_mode === 'AI_HYBRID') {
           try {
             const sandboxResult = results[0] || { stdout: '', stderr: 'No execution output' };
             const ddlAndSeed = allCases[0]?.input || '';
             const rubricConfig = problem.evaluation_config?.rubric || { correctness: 40, performance_and_indexes: 40, edge_cases: 20 };
             
             const aiPrompt = `You are an expert SQL grading system. 
Grade this candidate's SQL query based on the following rubric.
RUBRIC (Weights): ${JSON.stringify(rubricConfig)}

SCHEMA & SEED DATA (Context):
${ddlAndSeed}

CANDIDATE SQL QUERY:
${sub.source_code}

EXECUTION RESULT:
STDOUT: ${sandboxResult.stdout}
STDERR: ${sandboxResult.stderr}

Evaluate the query strictly against the rubric. Output a JSON object with:
{
  "score": <number between 0 and 100>,
  "feedback": "<detailed string explaining the score>"
}`;

             const aiResult = await this.openai.chatJson<{ score: number; feedback: string }>([
               { role: 'system', content: 'You are an autonomous SQL grading system. Return strictly JSON.' },
               { role: 'user', content: aiPrompt }
             ]);

             scorePct = Math.min(Math.max(aiResult.score || 0, 0), 100);
             
             problemSubmissions[problem.id] = {
               language: sub.language,
               sourceCode: sub.source_code,
               testResults: results,
               scorePct,
               aiFeedback: aiResult.feedback
             };
           } catch (e) {
             this.logger.error('AI Grading failed, falling back to 0', e);
             problemSubmissions[problem.id] = {
               language: sub.language,
               sourceCode: sub.source_code,
               testResults: results,
               scorePct: 0,
               aiFeedback: 'AI Grading failed due to an internal error.'
             };
           }
        } else {
           // Standard Test Case Grading
           scorePct = allCases.length > 0 ? Math.round((passed / allCases.length) * 100 * 10) / 10 : 0;
           problemSubmissions[problem.id] = {
             language: sub.language,
             sourceCode: sub.source_code,
             testResults: results,
             scorePct
           };
        }

        totalScorePoints += (scorePct / 100) * problem.marks;
        partialTotalScorePoints += (scorePct / 100) * problem.marks;
        partialProblemSubmissions[problem.id] = problemSubmissions[problem.id];
      }

      const overallScorePct = totalPossiblePoints > 0 
         ? Math.round((totalScorePoints / totalPossiblePoints) * 100 * 10) / 10 
         : 0;

      await this.upsertFinalSubmissions(application.id, this.stageKeyOf(stage), problemSubmissions, overallScorePct);

      if (application.candidateToken) {
        await this.pipeline.finishRound(application.candidateToken, {
          score: overallScorePct,
          stageId: stage.id,
        });
      }
    } catch (err) {
      this.logger.error('Unhandled error in backgroundEvaluate', err);

      // Compute best-effort score from whatever problems finished grading before the error
      const bestEffortScore = partialTotalPossiblePoints > 0
        ? Math.round((partialTotalScorePoints / partialTotalPossiblePoints) * 100 * 10) / 10
        : 0;

      await this.markGradingFailed(application.id, this.stageKeyOf(stage), bestEffortScore);
      if (application.candidateToken) {
        // Use best-effort score so a partial failure does NOT wrongly eliminate a candidate
        await this.pipeline.finishRound(application.candidateToken, { score: bestEffortScore, stageId: stage.id });
      }
      // Do not rethrow — outer .catch would finishRound again
    }
  }

  // -------------------------------------------------------------------------
  // Core: execute code against test cases in Docker
  // -------------------------------------------------------------------------
  private async executeAgainstCases(
    language: string,
    sourceCode: string,
    testCases: any[],
    visibleOnly: boolean,
  ): Promise<TestCaseResult[]> {
    const results: TestCaseResult[] = [];

    for (const tc of testCases) {
      const start = Date.now();
      try {
        const { stdout, stderr, timedOut } = await this.runInDocker(language, sourceCode, tc.input);
        const actualOutput = stdout.trim();
        const expectedOutput = tc.expected_output.trim();
        const passed = !timedOut && actualOutput === expectedOutput;

        results.push({
          id: tc.id,
          name: tc.name,
          passed,
          stdout: visibleOnly ? stdout : stdout,
          stderr: timedOut ? 'Time Limit Exceeded' : stderr,
          time_ms: Date.now() - start,
          is_visible: tc.is_visible,
        });
      } catch (err) {
        results.push({
          id: tc.id,
          name: tc.name,
          passed: false,
          stdout: '',
          stderr: String(err),
          time_ms: Date.now() - start,
          is_visible: tc.is_visible,
        });
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Docker execution — isolated, no network, resource-limited
  // -------------------------------------------------------------------------
  private async runInDocker(
    language: string,
    sourceCode: string,
    stdin: string,
  ): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
    const langInfo = LANGUAGE_DOCKER_IMAGE[language]!;
    const ext = LANGUAGE_FILE_EXT[language] ?? 'txt';

    // Write code to a temp file
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'coding-'));
    const fileName = language === 'java' ? 'Solution.' + ext : 'solution.' + ext;
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, sourceCode, 'utf8');

    try {
      const cmd = langInfo.cmd(`/code/${fileName}`).join(' ');
      const dockerArgs = [
        'run', '--rm',
        '--network', 'none',
        '--memory', language === 'sql' ? '512m' : '256m',
        '--cpus', '1.0',
        '--pids-limit', '128',
        '--read-only',
        '--tmpfs', '/tmp:size=256m',
        '-v', `${tmpDir}:/code:ro`,
        '-i',
        langInfo.image,
        'sh', '-c', `timeout 20 ${cmd}`,
      ];

      const result = spawnSync('docker', dockerArgs, {
        input: stdin,
        timeout: 25000,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024,
      });

      const timedOut = result.status === 124 || result.signal === 'SIGTERM';

      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        timedOut,
      };
    } finally {
      try { fs.rmSync(tmpDir, { recursive: true }); } catch {}
    }
  }

  // -------------------------------------------------------------------------
  // Upsert partial problem submission
  // -------------------------------------------------------------------------
  private async upsertProblemSubmission(
    applicationId: string,
    stageKey: string,
    problemId: string,
    language: string,
    sourceCode: string,
    testResults: TestCaseResult[],
    submitted: boolean,
  ) {
    let submission = await this.findSubmission(String(applicationId), stageKey);

    if (!submission) {
      submission = this.submissions.create({
        applicationId: String(applicationId),
        stageKey,
        status: 'in_progress',
        inactive: false,
        problemSubmissions: {
          [problemId]: { language, sourceCode, testResults, scorePct: null }
        },
      });
    } else {
      submission.problemSubmissions = submission.problemSubmissions || {};
      submission.problemSubmissions[problemId] = { language, sourceCode, testResults, scorePct: null };
    }

    await this.submissions.save(submission);
  }

  // -------------------------------------------------------------------------
  // Upsert final submissions map
  // -------------------------------------------------------------------------
  private async markGradingFailed(
    applicationId: string,
    stageKey: string,
    scorePct: number,
  ) {
    let submission = await this.findSubmission(String(applicationId), stageKey);
    if (!submission) {
      submission = this.submissions.create({
        applicationId: String(applicationId),
        stageKey,
        status: 'error',
        inactive: false,
        problemSubmissions: {},
        scorePct,
        submittedAt: new Date(),
      });
    } else {
      // Keep code snapshot; only flip terminal status + score
      submission.status = 'error';
      submission.scorePct = scorePct;
      submission.submittedAt = new Date();
    }
    await this.submissions.save(submission);
  }

  private async upsertFinalSubmissions(
    applicationId: string,
    stageKey: string,
    problemSubmissions: Record<string, any>,
    scorePct: number,
    status: 'submitted' | 'error' = 'submitted'
  ) {
    let submission = await this.findSubmission(String(applicationId), stageKey);

    if (!submission) {
      submission = this.submissions.create({
        applicationId: String(applicationId),
        stageKey,
        status,
        inactive: false,
        problemSubmissions,
        scorePct,
        submittedAt: new Date(),
      });
    } else {
      // On error with empty map, preserve existing snapshot instead of wiping code
      if (status === 'error' && Object.keys(problemSubmissions || {}).length === 0) {
        submission.status = status;
        submission.scorePct = scorePct;
        submission.submittedAt = new Date();
      } else {
        submission.problemSubmissions = problemSubmissions;
        submission.status = status;
        submission.scorePct = scorePct;
        submission.submittedAt = new Date();
      }
    }

    await this.submissions.save(submission);
    void this.roundSnapshots.upsertFromCoding(submission);
  }

  // -------------------------------------------------------------------------
  // Resolve token -> application + stage + config
  // -------------------------------------------------------------------------
  private async resolveContext(token: string, dataSource: any) {
    const [appRow] = await dataSource.query(
      `SELECT id, job_profile_id, candidate_id as candidateId, status, candidate_token as candidateToken FROM job_applications WHERE candidate_token = ? AND inactive = 0 LIMIT 1`,
      [token],
    );
    if (!appRow) throw new NotFoundException('Invalid or expired token');

    const stages = await dataSource.query(
      `SELECT id, stage_key, name, round_config FROM job_profile_stages WHERE job_profile_id = ? AND stage_type = 'coding' AND inactive = 0 ORDER BY sort_order ASC LIMIT 1`,
      [appRow.job_profile_id],
    );
    if (!stages.length) throw new NotFoundException('No coding round configured for this job');

    const stage = stages[0];
    const config: RoundConfig = typeof stage.round_config === 'string'
      ? JSON.parse(stage.round_config)
      : (stage.round_config ?? {});

    return { application: appRow as ApplicationRow, stage, config };
  }
}
