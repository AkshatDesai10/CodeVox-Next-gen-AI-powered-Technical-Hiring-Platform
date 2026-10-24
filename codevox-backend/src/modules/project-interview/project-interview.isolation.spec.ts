/**
 * Build & Defend acceptance checks (no Jest runner required).
 * Run: npx ts-node -r tsconfig-paths/register src/modules/project-interview/project-interview.isolation.spec.ts
 */
import { mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  normalizeProjectInterviewRoundConfig,
  sanitizeProjectChoiceForCandidate,
  scaleRubricMarksTo100,
  validateProjectInterviewStages,
  type ProjectChoice,
} from '../job-profiles/project-interview-round.types';
import {
  applyRubricEvidence,
  bundleZipForGrading,
  everyTaskAtPrintedTotal,
  quoteAppearsInFile,
  readZipEntries,
  resolveGradingRubric,
  submissionScorePct,
} from './document-pack.util';
import { AutonomousInterviewPhase } from '../autonomous-interview/entities/candidate-autonomous-interview.mysql.entity';
import { AutonomousInterviewRoundType } from '../autonomous-interview/entities/autonomous-interview-round.mysql.entity';
import { JobStageType } from '../job-profiles/entities/job-profile-stage.mysql.entity';
import { ProjectInterviewStatus } from './entities/project-interview-submission.mysql.entity';
import {
  buildProjectEvaluationMessages,
  normalizeProjectProfile,
  ProjectEvaluationService,
} from './project-evaluation.service';
import { ProjectInterviewService } from './project-interview.service';
import {
  buildRepoSnapshotFromDirectory,
  normalizeGithubRepoUrl,
  RepoFetchError,
  type RepoSnapshot,
  type RepoSnapshotFetcher,
} from './repo-snapshot.fetcher';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

async function expectThrow(fn: () => Promise<unknown>, match: RegExp, msg: string) {
  try {
    await fn();
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    assert(match.test(text), `${msg} (got: ${text})`);
    return;
  }
  throw new Error(`${msg} (did not throw)`);
}

const PROJECT: ProjectChoice = {
  id: 'lms',
  title: 'Classroom LMS',
  description_md: '# Build an LMS\nTeachers create assignments, students submit.',
  twist_requirement: 'Students can only see assignments of their enrolled class.',
  must_have_requirements: [
    { id: 'auth', text: 'Role based login for Teacher and Student', weight: 3 },
    { id: 'crud', text: 'Teachers can create assignments', weight: 1 },
  ],
  tech_stack: { mode: 'allowed', languages_frameworks: ['React', 'Node.js'] },
  deliverables: {
    require_readme: true,
    require_decisions_md: false,
    require_tests: true,
    run_instructions_required: true,
  },
  duration_hours: 48,
  submission_type: 'github_url',
  attached_documents: [],
  category: 'Full-stack',
  difficulty: 'intermediate',
};

async function createDummyRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pi-dummy-'));
  const files: Record<string, string> = {
    'README.md': '# Classroom LMS\n\n## Getting started\n\n```\nnpm install\nnpm start\n```\n',
    'package.json': JSON.stringify({
      name: 'lms',
      scripts: { start: 'react-scripts start', test: 'jest' },
      dependencies: { react: '^18', 'react-router-dom': '^6', axios: '^1' },
      devDependencies: { jest: '^29' },
    }),
    'server/package.json': JSON.stringify({
      name: 'lms-api',
      scripts: { dev: 'nodemon index.js' },
      dependencies: { express: '^4', mongoose: '^8' },
    }),
    'server/index.js': "const express = require('express');\nconst app = express();\n",
    'server/models/User.js':
      "const mongoose = require('mongoose');\nconst userSchema = new mongoose.Schema({ role: { type: String, enum: ['teacher', 'student'], required: true } });\nuserSchema.methods.canLogin = function canLogin() { return this.role === 'teacher' || this.role === 'student'; };\nmodule.exports = mongoose.model('User', userSchema);\n",
    'src/api/client.js': "import axios from 'axios';\nexport default axios.create({ baseURL: '/api' });\n",
    'src/App.jsx': "import { BrowserRouter } from 'react-router-dom';\n",
    'tests/app.test.js': "test('x', () => {});\n",
    '.env': 'SECRET=should-not-be-read',
    '.env.example': 'MONGO_URL=mongodb://localhost/lms',
    'node_modules/axios/index.js': 'ignored',
  };
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, body, 'utf8');
  }
  return root;
}

async function testSnapshotFromDummyRepo(root: string): Promise<RepoSnapshot> {
  const snap = await buildRepoSnapshotFromDirectory(root, {
    repoUrl: 'https://github.com/acme/lms',
    branch: null,
  });
  assert(snap.readme.includes('npm start'), 'README captured');
  assert(Object.keys(snap.manifests).includes('package.json'), 'root package.json captured');
  assert(Object.keys(snap.manifests).includes('server/package.json'), 'nested package.json captured');
  assert(Object.keys(snap.config_files).includes('.env.example'), '.env.example captured');
  assert(!Object.keys(snap.config_files).includes('.env'), '.env never read');
  assert(!snap.file_tree.some((f) => f.startsWith('node_modules')), 'node_modules skipped');
  assert(snap.has_tests, 'tests detected');
  assert(Object.keys(snap.key_source_files).includes('src/api/client.js'), 'axios client picked as key source');
  assert(!Object.keys(snap.key_source_files).some((f) => f.includes('test')), 'tests not in key sources');
  return snap;
}

function testUrlValidation() {
  assert(normalizeGithubRepoUrl('https://github.com/acme/lms.git') === 'https://github.com/acme/lms', 'strip .git');
  assert(normalizeGithubRepoUrl('https://github.com/acme/lms/') === 'https://github.com/acme/lms', 'strip slash');
  assert(normalizeGithubRepoUrl('http://github.com/acme/lms') === null, 'https only');
  assert(normalizeGithubRepoUrl('https://evil.com/acme/lms') === null, 'github only');
  assert(normalizeGithubRepoUrl('https://github.com/acme/lms --upload-pack=x') === null, 'no arg injection');
}

function testConfig() {
  const cfg = normalizeProjectInterviewRoundConfig({
    project_choices: [PROJECT, { ...PROJECT }],
    max_assessment_hours: 200,
    ai_interviewer: { focus_areas: ['x'], question_count: 99, duration_minutes: 1 },
    scoring_weights: { interview_performance: 150 },
  });
  assert(cfg.project_choices[1].id !== cfg.project_choices[0].id, 'duplicate project ids de-duplicated');
  assert(cfg.max_assessment_hours === 168, 'max_assessment_hours clamped to 168');
  assert(cfg.ai_interviewer.question_count === 99, 'question_count keeps HR value (no max 6)');
  assert(cfg.ai_interviewer.duration_minutes === 5, 'duration clamped');
  assert(cfg.scoring_weights.interview_performance === 100, 'weight clamped');
  assert(cfg.scoring_weights.code_submission === 0, 'legacy interview-only infers code remainder');
  const defaults = normalizeProjectInterviewRoundConfig(null).scoring_weights;
  assert(defaults.interview_performance === 60, 'default interview weight 60');
  assert(defaults.code_submission === 40, 'default code weight 40');
  assert(
    normalizeProjectInterviewRoundConfig(null).max_assessment_hours === 4,
    'default max_assessment_hours 4',
  );
  assert(
    normalizeProjectInterviewRoundConfig({
      project_choices: [{ ...PROJECT, duration_hours: 12 }],
    }).max_assessment_hours === 12,
    'legacy duration_hours backfills max_assessment_hours',
  );
  const withDoc = normalizeProjectInterviewRoundConfig({
    project_choices: [
      {
        ...PROJECT,
        submission_type: 'zip_upload',
        assessment_document: {
          filename: 'exam.docx',
          file_url: 'https://example.com/exam.docx',
          extracted_text: 'Task 1 is worth 30 marks.',
        },
        supporting_datasets: [{ filename: 'task1.sql', file_url: 'https://example.com/task1.sql' }],
      },
    ],
  });
  assert(withDoc.project_choices[0].assessment_document?.filename === 'exam.docx', 'assessment document kept on save');
  assert(withDoc.project_choices[0].supporting_datasets?.[0]?.filename === 'task1.sql', 'dataset kept on save');
  const candidateView = sanitizeProjectChoiceForCandidate(withDoc.project_choices[0]);
  assert(candidateView.assessment_document?.file_url === 'https://example.com/exam.docx', 'candidate can download the document');
  assert(!('extracted_text' in (candidateView.assessment_document ?? {})), 'extracted text stays off the candidate payload');
  const excelCleared = normalizeProjectInterviewRoundConfig({
    project_choices: [
      {
        ...PROJECT,
        submission_type: 'excel_or_pdf',
        twist_requirement: 'should strip',
        must_have_requirements: [{ id: 'r1', text: 'CCTV leftover', weight: 10 }],
        tech_stack: { mode: 'mandatory', languages_frameworks: ['PHP'] },
        assessment_document: { filename: 'prob.xlsx', file_url: 'https://example.com/p.xlsx' },
        answer_key: { filename: 'key.xlsx', file_url: 'https://example.com/k.xlsx' },
      },
    ],
  });
  assert(excelCleared.project_choices[0].must_have_requirements.length === 0, 'excel drops must-have on normalize');
  assert(!excelCleared.project_choices[0].twist_requirement, 'excel drops twist on normalize');
  assert(
    excelCleared.project_choices[0].tech_stack.languages_frameworks.length === 0,
    'excel drops tech stack on normalize',
  );
  const excelCandidate = sanitizeProjectChoiceForCandidate(excelCleared.project_choices[0]);
  assert(excelCandidate.must_have_requirements.length === 0, 'excel candidate payload has no must-have');
  assert(excelCandidate.twist_requirement == null, 'excel candidate payload has no twist');
  assert(submissionScorePct([
    { task_id: 'task-1', score: 25, max_marks: 30, feedback: '' },
    { task_id: 'task-2', score: 20, max_marks: 20, feedback: '' },
  ]) === 90, 'submission score is earned divided by possible');
  assert(
    !everyTaskAtPrintedTotal([
      { task_id: 'task-1', score: 100, max_marks: 100, feedback: '' },
    ]),
    'a single-task paper may earn its full printed marks',
  );
  assert(
    everyTaskAtPrintedTotal([
      { task_id: 'task-1', score: 30, max_marks: 30, feedback: '' },
      { task_id: 'task-2', score: 20, max_marks: 20, feedback: '' },
    ]),
    'full printed marks on every task of a multi-task paper is rejected',
  );
  assert(
    !everyTaskAtPrintedTotal([
      { task_id: 'task-1', score: 25, max_marks: 30, feedback: '' },
      { task_id: 'task-2', score: 20, max_marks: 20, feedback: '' },
    ]),
    'a task below its printed total is kept',
  );

  const stockSnapshot: RepoSnapshot = {
    repo_url: 'https://example.com/erp',
    branch: null,
    readme: 'This README claims stock never goes negative and draft restocks.',
    decisions_md: null,
    manifests: {},
    config_files: {},
    key_source_files: {
      'backend/src/challans.controller.ts':
        'export function deductStockForItems() {\n  if (next < 0) throw new Error("stock");\n}\n…[truncated]',
    },
    file_tree: ['backend/src/challans.controller.ts'],
    file_count: 1,
    has_tests: false,
    truncated: true,
  };
  const stockRubric = {
    tasks: [
      {
        id: 'stock',
        name: 'Stock',
        subparts: [
          { name: 'Stock never goes negative', marks: 3 },
          { name: 'Draft restock', marks: 2 },
        ],
      },
    ],
  };
  const stockGrade = applyRubricEvidence(
    stockRubric,
    [
      {
        task_id: 'stock',
        max_marks: 10,
        score: 10,
        subparts: [
          {
            name: 'Stock never goes negative',
            marks: 10,
            awarded: 10,
            status: 'present',
            file: 'backend/src/challans.controller.ts',
            quote: 'if (next < 0) throw new Error("stock");',
            gap: 'Confirmed-to-draft restock was not in the quoted text.',
          },
          {
            name: 'Draft restock',
            marks: 10,
            awarded: 10,
            status: 'present',
            file: 'backend/src/challans.controller.ts',
            quote: 'updateChallanStatus sets draft and restocks',
            gap: 'The transition was not shown.',
          },
        ],
      },
    ],
    stockSnapshot,
  );
  const stockTask = stockGrade[0];
  const stockShown = stockTask?.subparts?.[0];
  const stockMissing = stockTask?.subparts?.[1];
  assert(stockTask?.max_marks === 5, 'task total comes from the rubric, not the model');
  assert(stockShown?.marks === 3, 'model cannot replace rubric marks');
  assert(stockShown?.awarded === 3, 'a verified quote earns its genuine rubric marks');
  assert(stockShown?.status === 'present', 'a verified quote has present status');
  assert(stockMissing?.awarded === 0, 'a quote missing from the file scores 0');
  assert(stockMissing?.status === 'unseen', 'an unmatched quote is unseen');
  assert(stockTask?.score === 3, 'task score is the sum of verified sub-parts');
  assert(
    !quoteAppearsInFile(stockSnapshot.key_source_files['backend/src/challans.controller.ts'], 'deductStock'),
    'a short function name is not evidence',
  );

  const emptyGap = applyRubricEvidence(
    { tasks: [{ id: 'stock', name: 'Stock', subparts: [{ name: 'Stock never goes negative', marks: 3 }] }] },
    [
      {
        task_id: 'stock',
        subparts: [
          {
            name: 'Stock never goes negative',
            marks: 3,
            awarded: 3,
            status: 'present',
            file: 'challans.controller.ts',
            quote: 'if (next < 0) throw new Error("stock");',
            gap: '',
          },
        ],
      },
    ],
    stockSnapshot,
  );
  const gapRow = emptyGap[0]?.subparts?.[0];
  assert(gapRow?.awarded === 3, 'genuine marks awarded when quote is present');
  assert(gapRow?.status === 'present', 'status is present when verified');
  assert((gapRow?.gap.length ?? 0) > 0, 'a gap sentence is always stored');

  const readmeOnly = applyRubricEvidence(
    stockRubric,
    [
      {
        task_id: 'stock',
        subparts: [
          {
            name: 'Stock never goes negative',
            marks: 3,
            awarded: 3,
            status: 'present',
            file: 'README.md',
            quote: 'stock never goes negative and draft restocks.',
            gap: 'Only the README says this.',
          },
        ],
      },
    ],
    stockSnapshot,
  );
  assert(readmeOnly[0]?.subparts?.[0]?.awarded === 0, 'a README quote scores 0');

  const fromChecklist = resolveGradingRubric(PROJECT);
  assert(fromChecklist?.tasks.length === 2, 'a project without a rubric uses its saved requirements');
  assert(fromChecklist?.tasks[0]?.subparts[0]?.marks === 3, 'requirement weight is the sub-part marks');
  const stored = resolveGradingRubric({ ...PROJECT, grading_rubric: stockRubric });
  assert(stored?.tasks.length === 1 && stored.tasks[0].id === 'stock', 'a stored rubric replaces the checklist');
  const savedRubric = normalizeProjectInterviewRoundConfig({
    project_choices: [{ ...PROJECT, grading_rubric: stockRubric }],
  });
  assert(
    savedRubric.project_choices[0]?.grading_rubric?.tasks[0]?.subparts[1]?.marks === 2,
    'rubric is kept on save',
  );
  assert(
    !('grading_rubric' in sanitizeProjectChoiceForCandidate(savedRubric.project_choices[0])),
    'rubric marks stay off the candidate payload',
  );
  const scaled = scaleRubricMarksTo100({
    tasks: [
      {
        id: 'core',
        name: 'Core',
        subparts: [
          { name: 'Stock rule', marks: 3 },
          { name: 'Create challan', marks: 2 },
        ],
      },
      { id: 'deploy', name: 'Deployment', subparts: [{ name: 'Live URL', marks: 1 }] },
    ],
  });
  const scaledMarks = scaled.tasks.flatMap((task) => task.subparts.map((part) => part.marks));
  assert(scaledMarks.reduce((sum, mark) => sum + mark, 0) === 100, 'inferred rubric marks sum to 100');
  assert((scaledMarks[0] ?? 0) > (scaledMarks[2] ?? 0), 'a heavier sub-part keeps a higher mark');
  assert(validateProjectInterviewStages([{ stageType: 'coding' }]) === null, 'no round ok');
  assert(
    validateProjectInterviewStages([{ stageType: 'project_interview', roundConfig: { project_choices: [PROJECT] } }]) === null,
    'valid round ok',
  );
  assert(
    String(
      validateProjectInterviewStages([
        { stageType: 'project_interview', roundConfig: {} },
        { stageType: 'project_interview', roundConfig: {} },
      ]),
    ).includes('Only one'),
    'one per profile',
  );
  assert(
    String(validateProjectInterviewStages([{ stageType: 'project_interview', roundConfig: {} }])).includes('title'),
    'untitled project rejected at publish',
  );
}

function fakeLlm(response: unknown, calls: Array<Array<{ role: string; content: string }>>) {
  return {
    activeModel: () => 'fake-model',
    chatJson: async (messages: Array<{ role: string; content: string }>) => {
      calls.push(messages);
      if (response instanceof Error) throw response;
      return response;
    },
    chatJsonDetailed: async (messages: Array<{ role: string; content: string }>) => {
      calls.push(messages);
      if (response instanceof Error) throw response;
      return {
        data: response,
        usage: { promptTokens: 10, completionTokens: 20 },
        model: 'fake-model',
      };
    },
  };
}

/** Stub for OPENAI_* (Qwen) metadata-question path — unconfigured → deterministic fallback. */
function fakeOpenai() {
  return {
    isConfigured: () => false,
    activeModel: () => 'qwen/qwen3.8-27b',
    chatJsonDetailed: async () => {
      throw new Error('fake openai not configured');
    },
  };
}

function fakeAiLogs() {
  return {
    create: (row: unknown) => row,
    save: async () => undefined,
  };
}

const LLM_PROFILE = {
  task_match: { matches: true, note: '' },
  app_summary: 'An LMS where teachers post assignments and students submit.',
  tech_stack_summary: 'React + Express + MongoDB',
  features: ['Assignment creation', 'Submissions'],
  user_roles: ['Teacher', 'Student'],
  key_libraries: [
    { name: 'react-router-dom', purpose: 'Client-side routing' },
    { name: 'axios', purpose: 'HTTP client with baseURL /api' },
  ],
  config_highlights: ['axios baseURL set in src/api/client.js'],
  data_storage: 'MongoDB via mongoose',
  architecture_summary: 'SPA + REST API',
  evaluation_scores: {
    twist_requirement_met: true,
    twist_evidence: 'Filtered by class id',
    requirements_score_pct: null,
    checklist_results: [
      {
        id: 'auth',
        text: 'Role based login for Teacher and Student',
        weight: 3,
        score_pct: 100,
        status: 'complete',
        passed: true,
        evidence: 'server/models/User.js: teacher and student roles on the User schema',
        reason: 'ok',
      },
      {
        id: 'crud',
        text: 'Teachers can create assignments',
        weight: 1,
        score_pct: 0,
        status: 'missing',
        passed: false,
        evidence: '',
        reason: 'No assignment CRUD found',
      },
    ],
  },
  suggested_questions: [
    {
      question: 'What does react-router-dom do in this project?',
      topic: 'tool',
      expected_answer: 'Client-side routing between pages',
    },
  ],
  overclaims: [],
  cannot_verify: [],
};

async function testEvaluationService(snapshot: RepoSnapshot) {
  const messages = buildProjectEvaluationMessages(PROJECT, snapshot);
  assert(messages[0].role === 'system', 'system prompt first');
  assert(messages[0].content.includes('EVIDENCE RULES'), 'evaluation system prompt present');
  assert(messages[0].content.includes('INTERVIEW PROFILE'), 'interview-oriented profile fields');
  assert(
    messages[0].content.includes('key_libraries') &&
      messages[0].content.includes('suggested_questions'),
    'schema includes interview question seeds',
  );
  assert(
    messages[0].content.includes('requirements_score_pct') &&
      messages[0].content.includes('backend computes'),
    'backend owns requirements_score_pct',
  );
  const userBlob = messages[1].content;
  assert(userBlob.includes(String(PROJECT.twist_requirement)), 'twist sent to LLM');
  assert(userBlob.includes('auth | Role based login'), 'requirements sent to LLM');
  assert(userBlob.includes('package.json'), 'manifests sent to LLM');
  assert(userBlob.includes('Folder tree:'), 'folder structure sent to LLM');

  const fetcher: RepoSnapshotFetcher = { fetch: async () => snapshot };
  const calls: Array<Array<{ role: string; content: string }>> = [];
  const svc = new ProjectEvaluationService(
    fetcher,
    fakeLlm(LLM_PROFILE, calls) as never,
    fakeAiLogs() as never,
    fakeOpenai() as never,
  );
  const { profile } = await svc.evaluate({ project: PROJECT, repoUrl: snapshot.repo_url });
  assert(calls.length === 1, 'LLM called once');
  assert(profile.generated_by === 'llm', 'llm profile');
  assert(profile.tech_stack_summary.includes('React'), 'tech_stack_summary kept');
  assert(profile.evaluation_scores.twist_requirement_met === true, 'twist result kept');
  const auth = profile.evaluation_scores.checklist_results.find((c) => c.id === 'auth');
  const crud = profile.evaluation_scores.checklist_results.find((c) => c.id === 'crud');
  assert(auth?.passed === true && auth.score_pct === 100, 'auth passed with score_pct');
  assert(crud?.passed === false && crud?.score_pct === 0, 'crud failed checklist item');
  assert(profile.evaluation_scores.requirements_score_pct === 75, 'weighted score (3*100+1*0)/4');
  assert(
    messages[0].content.includes('90–100') && userBlob.includes('genuine percent'),
    'evaluator prompt uses a continuous score, not fixed buckets',
  );
  const inflated = normalizeProjectProfile(
    {
      ...LLM_PROFILE,
      evaluation_scores: {
        ...LLM_PROFILE.evaluation_scores,
        checklist_results: LLM_PROFILE.evaluation_scores.checklist_results.map((row) => ({
          ...row,
          score_pct: 100,
          evidence: 'implemented',
          reason: 'complete',
        })),
      },
    },
    PROJECT,
    snapshot,
  );
  assert(
    inflated.evaluation_scores.checklist_results.every((row) => row.score_pct <= 70),
    'vague 100s are capped',
  );
  assert(
    (inflated.evaluation_scores.requirements_score_pct ?? 100) < 100,
    'overall score is not perfect when evidence is generic',
  );
  assert(
    profile.scripts.some(
      (s) => s.command.includes('npm run start') || s.what_it_does.includes('react-scripts start'),
    ),
    'npm scripts extracted',
  );
  assert(
    profile.scripts.some((s) => s.what_it_does.includes('server/package.json')),
    'nested scripts extracted',
  );
  assert(profile.evaluation_scores.deliverables.run_instructions_present, 'run instructions detected');
  assert(profile.evaluation_scores.deliverables.tests_present, 'tests deliverable detected');

  let attempts = 0;
  const retryLlm = {
    activeModel: () => 'fake-model',
    chatJsonDetailed: async () => {
      attempts += 1;
      const data =
        attempts === 1
          ? {
              ...LLM_PROFILE,
              evaluation_scores: {
                ...LLM_PROFILE.evaluation_scores,
                checklist_results: [LLM_PROFILE.evaluation_scores.checklist_results[0]],
              },
            }
          : LLM_PROFILE;
      return {
        data,
        usage: { promptTokens: 10, completionTokens: 20 },
        model: 'fake-model',
      };
    },
  };
  const retrySvc = new ProjectEvaluationService(
    fetcher,
    retryLlm as never,
    fakeAiLogs() as never,
    fakeOpenai() as never,
  );
  const { profile: retried } = await retrySvc.evaluate({ project: PROJECT, repoUrl: snapshot.repo_url });
  assert(attempts === 2, 'retries LLM on checklist validation failure');
  assert(retried.generated_by === 'llm', 'profile accepted after retry');

  const failing = new ProjectEvaluationService(
    fetcher,
    fakeLlm(new Error('quota'), []) as never,
    fakeAiLogs() as never,
    fakeOpenai() as never,
  );
  const fallback = await failing.profile(PROJECT, snapshot);
  assert(fallback.generated_by === 'heuristic', 'heuristic fallback on LLM error');
  assert(fallback.key_libraries.some((l) => l.name === 'react-router-dom'), 'fallback lists deps');
  assert(fallback.evaluation_scores.checklist_results.every((c) => c.passed === null), 'fallback does not guess pass/fail');
}

/** Minimal in-memory stand-in for a TypeORM repository. */
class MemRepo<T extends Record<string, any>> {
  rows: T[] = [];
  constructor(private readonly key: keyof T) {}
  create(x: Partial<T>) {
    return { ...x } as T;
  }
  private matches(row: T, where: Record<string, unknown>) {
    return Object.entries(where).every(([k, v]) => String(row[k]) === String(v));
  }
  async findOne(opts: {
    where: Record<string, unknown>;
    order?: Record<string, 'ASC' | 'DESC'>;
  }) {
    let rows = this.rows.filter((r) => this.matches(r, opts.where));
    if (opts.order?.createdAt === 'DESC') {
      rows = [...rows].sort(
        (a, b) => +new Date(b.createdAt ?? 0).valueOf() - +new Date(a.createdAt ?? 0).valueOf(),
      );
    }
    return rows[0] ?? null;
  }
  async save(x: T) {
    const idx = this.rows.findIndex((r) => r === x || r[this.key] === x[this.key]);
    if (idx >= 0) this.rows[idx] = x;
    else this.rows.push(x);
    return x;
  }
  async update(where: Record<string, unknown>, patch: Partial<T>) {
    for (const r of this.rows) if (this.matches(r, where)) Object.assign(r, patch);
  }
}

async function waitFor(fn: () => Promise<boolean>, msg: string) {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timeout: ${msg}`);
}

async function testStateTransitions(snapshot: RepoSnapshot) {
  const submissions = new MemRepo<any>('id');
  const stages = new MemRepo<any>('id');
  const applications = new MemRepo<any>('id');
  const profiles = new MemRepo<any>('id');
  const candidates = new MemRepo<any>('id');
  const interviews = new MemRepo<any>('candidateToken');
  const interviewRounds = new MemRepo<any>('id');

  stages.rows.push({
    id: '10',
    name: 'Build & Defend',
    stageType: JobStageType.PROJECT_INTERVIEW,
    inactive: 0,
    roundConfig: {
      project_choices: [PROJECT, { ...PROJECT, id: 'shop', title: 'Shop' }],
      max_assessment_hours: 6,
    },
  });
  applications.rows.push({
    id: '1',
    candidateId: '7',
    jobProfileId: '3',
    candidateToken: 'demo_portal',
    currentStageId: '10',
    inactive: 0,
  });
  profiles.rows.push({ id: '3', title: 'Full-stack Engineer', requiredSkills: ['React'] });
  candidates.rows.push({ id: '7', skills: ['React', 'Node'] });

  let failFetch = true;
  const fetcher: RepoSnapshotFetcher = {
    fetch: async () => {
      if (failFetch) {
        throw new RepoFetchError(
          "We couldn't access your code. Please make sure the repository is public and the code is pushed",
        );
      }
      return snapshot;
    },
  };
  const evaluation = new ProjectEvaluationService(
    fetcher,
    fakeLlm(LLM_PROFILE, []) as never,
    fakeAiLogs() as never,
    fakeOpenai() as never,
  );
  const moduleRef = {
    get: () => ({
      stopActive: async () => {
        /* no-op for isolation */
      },
    }),
  };
  const excelGrader = {
    grade: async () => ({
      score_pct: 0,
      total_checks: 0,
      passed_checks: 0,
      hardcoded_cells_detected: [],
      ignored_sheets: [],
      graded_sheets: [],
      answer_cell_count: 0,
      mistakes: [],
      gap_summary: [],
    }),
  };
  const svc = new ProjectInterviewService(
    submissions as never,
    stages as never,
    applications as never,
    profiles as never,
    candidates as never,
    interviews as never,
    interviewRounds as never,
    evaluation,
    excelGrader as never,
    fetcher,
    moduleRef as never,
  );

  // Portal token resolves (and lazily assigns) the current-stage submission.
  const initial = await svc.getCandidateView('demo_portal');
  assert(initial.status === ProjectInterviewStatus.PENDING_SUBMISSION, 'starts PENDING_SUBMISSION');
  assert(initial.selection_started_at, 'selection countdown stamped on first view');
  assert(initial.selection_countdown_seconds === 600, '10m selection countdown');
  assert(initial.max_assessment_hours === 6, 'round-level max_assessment_hours exposed');
  assert(initial.projects.length === 2, 'all project choices listed');
  assert(!('weight' in initial.projects[0].must_have_requirements[0]), 'weights hidden from candidate');
  const token = initial.submission_token;

  await expectThrow(() => svc.submit(token, { github_url: 'https://github.com/acme/lms' }), /Select a project/, 'must select before submit');

  const selected = await svc.selectProject(token, 'lms');
  assert(selected.status === ProjectInterviewStatus.IN_BUILD, 'select → IN_BUILD');
  assert(selected.selected_project_id === 'lms' && selected.due_at, 'selection locks with deadline');
  assert(String(selected.build_session_token).startsWith('ses_'), 'Build session token issued');
  const dueMs = new Date(selected.due_at!).getTime() - Date.now();
  assert(dueMs > 5.5 * 3_600_000 && dueMs < 6.5 * 3_600_000, 'dueAt from max_assessment_hours (6h)');
  const buildSeed = interviews.rows.find((r) => r.candidateToken === selected.build_session_token);
  assert(buildSeed?.currentPhase === AutonomousInterviewPhase.BND_ASSESSMENT, 'Build seed phase');
  assert(buildSeed?.proctorSummary?.bndPhase === 'build', 'Build seed bndPhase=build');
  await expectThrow(() => svc.selectProject(token, 'shop'), /locked/, 'choice cannot change');
  await expectThrow(() => svc.submit(token, { github_url: 'https://gitlab.com/a/b' }), /github\.com/, 'rejects non-GitHub URL');

  // Repo fetch failure → still READY_FOR_INTERVIEW (never-block) with locked fallback questions.
  const evaluating = await svc.submit(token, { github_url: 'https://github.com/acme/lms' });
  assert(evaluating.status === ProjectInterviewStatus.EVALUATING_CODE, 'submit → EVALUATING_CODE');
  await waitFor(
    async () => submissions.rows[0].status === ProjectInterviewStatus.READY_FOR_INTERVIEW,
    'fetch failure still advances to READY_FOR_INTERVIEW',
  );
  const afterFail = await svc.getCandidateView(token);
  assert(afterFail.status === ProjectInterviewStatus.READY_FOR_INTERVIEW, 'never-block → READY');
  assert(String(afterFail.interview_token).startsWith('ses_'), 'Defend token issued even on fetch failure');
  assert(submissions.rows[0].interviewQuestionsLocked === 1, 'questions locked after fallback advance');
  assert(
    Array.isArray(submissions.rows[0].lockedDefenseQuestions) &&
      submissions.rows[0].lockedDefenseQuestions.length >= 3,
    'locked_defense_questions populated',
  );
  assert(
    ['DETERMINISTIC_STATIC', 'LLM_METADATA'].includes(submissions.rows[0].evaluationFallbackLevel),
    'fallback level recorded',
  );
  assert(String(afterFail.build_session_token).startsWith('ses_'), 'Build token retained after failed eval');

  // Successful code re-score merges scores without unlocking defense questions.
  failFetch = false;
  const lockedQs = [...(submissions.rows[0].lockedDefenseQuestions ?? [])];
  await svc.rescoreCode(submissions.rows[0].id, {
    github_url: 'https://github.com/acme/lms',
    github_branch: 'main',
  });
  await waitFor(
    async () => Boolean(submissions.rows[0].projectProfile?.evaluation_scores?.requirements_score_pct),
    'background code re-score wrote requirements_score_pct',
  );
  assert(submissions.rows[0].interviewQuestionsLocked === 1, 're-score keeps questions locked');
  assert(
    JSON.stringify(submissions.rows[0].lockedDefenseQuestions) === JSON.stringify(lockedQs),
    're-score must not mutate locked_defense_questions',
  );

  const ready = await svc.getCandidateView(token);
  assert(ready.status === ProjectInterviewStatus.READY_FOR_INTERVIEW, 'still READY after re-score');
  assert(String(ready.interview_token).startsWith('ses_'), 'Defend interview token issued');
  assert(ready.interview_token !== ready.build_session_token, 'Build and Defend tokens are distinct');
  const defendSeed = interviews.rows.find((r) => r.candidateToken === ready.interview_token);
  assert(defendSeed?.currentPhase === AutonomousInterviewPhase.BND_INTERVIEW, 'Defend seed phase');
  assert(defendSeed?.proctorSummary.stageType === 'project_interview', 'seed pinned to project_interview stage');
  assert(defendSeed?.proctorSummary.bndPhase === 'defend', 'Defend seed bndPhase=defend');
  assert(defendSeed?.proctorSummary.portalToken === 'demo_portal', 'seed linked to portal token (proctoring/recording parity)');
  assert(submissions.rows[0].projectProfile?.tech_stack_summary, 'project_profile persisted');

  const payload = await svc.buildVoicePayload(defendSeed!.candidateToken);
  assert(payload && (payload.project as any).title === 'Classroom LMS', 'voice payload has project');
  assert((payload!.ai_interviewer as any).question_count === 5, 'voice payload has interviewer config');
  assert(payload!.interview_weight_pct === 100, 'voice payload defense scored at 100% weight');
  assert((payload!.scoring_weights as any).code_submission === 40, 'voice payload scoring defaults');
  assert(payload!.code_weight_pct === 40, 'voice payload code_weight_pct from config');
  assert(payload!.bnd_phase === 'defend', 'voice payload marks defend');
  assert(payload!.interview_questions_locked === true, 'voice payload exposes lock flag');
  assert(
    Array.isArray(payload!.locked_defense_questions) &&
      (payload!.locked_defense_questions as unknown[]).length >= 3,
    'voice payload wires locked_defense_questions',
  );

  interviewRounds.rows.push({
    id: 'rnd-1',
    candidateToken: ready.interview_token,
    roundType: AutonomousInterviewRoundType.BND_INTERVIEW,
    chatTranscript: { take_home_verification: { take_home_verification_score_pct: 80 } },
    createdAt: new Date(),
  });
  const summary = await svc.getReportSummary('1', '10');
  assert(summary?.code_build_score_pct === 75, 'report code build score from profile');
  assert(summary?.verbal_defend_score_pct === 80, 'report verbal score from BND round audit');
  assert(
    summary?.final_combined_score_pct === Math.round((75 * 40 + 80 * 60) / 100),
    'report final score uses configured weights',
  );

  const buildPayload = await svc.buildBuildPhasePayload(String(selected.build_session_token));
  assert(buildPayload?.bnd_phase === 'build', 'build payload marks build');
  assert(buildPayload?.max_assessment_hours === 6, 'build payload has hours');
  assert((await svc.getPortalStatus('1', '10')) === 'IN_PROGRESS', 'portal shows in progress');

  // Interview finishes → COMPLETED.
  defendSeed!.currentPhase = AutonomousInterviewPhase.COMPLETED;
  const done = await svc.getCandidateView(token);
  assert(done.status === ProjectInterviewStatus.COMPLETED, 'READY_FOR_INTERVIEW → COMPLETED');
  assert(done.interview_token === null, 'no re-entry after completion');
  assert((await svc.getPortalStatus('1', '10')) === 'COMPLETED', 'portal shows completed');
  await expectThrow(() => svc.submit(token, { github_url: 'https://github.com/acme/lms' }), /status is completed/, 'no resubmit after completion');
}

function storedZip(files: Array<{ name: string; text: string }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const data = Buffer.from(file.text);
    const nameBuf = Buffer.from(file.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    const localPart = Buffer.concat([local, nameBuf, data]);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt32LE(offset, 42);
    locals.push(localPart);
    centrals.push(Buffer.concat([central, nameBuf]));
    offset += localPart.length;
  }
  const centralDir = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralDir, eocd]);
}

async function testZipReader() {
  const zip = storedZip([
    { name: 'answers.sql', text: 'select 1;' },
    { name: 'shot.png', text: 'not-really-png' },
    { name: 'node_modules/leftpad/index.js', text: 'module.exports = 1' },
  ]);
  const names = readZipEntries(zip).map((entry) => entry.name);
  assert(names.includes('answers.sql'), 'zip keeps sql');
  assert(names.includes('shot.png'), 'zip reader still returns png bytes');
  const packed = await bundleZipForGrading(zip);
  assert(packed.bundle.includes('select 1;'), 'grader bundle includes sql');
  assert(!packed.bundle.includes('not-really-png'), 'grader bundle drops png');
  assert(!packed.bundle.includes('leftpad'), 'grader bundle drops node_modules');
}

async function main() {
  testUrlValidation();
  testConfig();
  await testZipReader();
  const root = await createDummyRepo();
  try {
    const snapshot = await testSnapshotFromDummyRepo(root);
    await testEvaluationService(snapshot);
    await testStateTransitions(snapshot);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  console.log('project-interview isolation checks: OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
