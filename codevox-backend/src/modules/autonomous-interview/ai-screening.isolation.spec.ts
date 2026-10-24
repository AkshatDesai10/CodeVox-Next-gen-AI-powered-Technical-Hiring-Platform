/**
 * Lightweight acceptance checks for AI Screening isolation (no Jest runner required).
 * Run: npx ts-node -r tsconfig-paths/register src/modules/autonomous-interview/ai-screening.isolation.spec.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  configuredAiScreeningRequirements,
  normalizeAiScreeningRoundConfig,
  validateAiScreeningStages,
} from '../job-profiles/ai-screening-round.types';
import { ScreeningAnalyzerService } from './screening-analyzer.service';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function testValidateStages() {
  assert(validateAiScreeningStages([]) === null, 'empty pipeline ok');
  assert(
    validateAiScreeningStages([
      { stageType: 'coding', sortOrder: 0 },
      { stageType: 'ai_verbal', sortOrder: 1 },
    ]) === null,
    'jobs without AI Screening ok',
  );
  assert(
    validateAiScreeningStages([
      { stageType: 'ai_screening', sortOrder: 0, roundConfig: {} },
      { stageType: 'coding', sortOrder: 1 },
    ]) === null,
    'AI Screening first ok',
  );
  assert(
    String(
      validateAiScreeningStages([
        { stageType: 'coding', sortOrder: 0 },
        { stageType: 'ai_screening', sortOrder: 1, roundConfig: {} },
      ]),
    ).includes('first'),
    'AI Screening must be first',
  );
  assert(
    String(
      validateAiScreeningStages([
        { stageType: 'ai_screening', sortOrder: 0, roundConfig: {} },
        { stageType: 'ai_screening', sortOrder: 1, roundConfig: {} },
      ]),
    ).includes('Only one'),
    'only one AI Screening',
  );
}

function testEmptyRequirementsSkipped() {
  const cfg = normalizeAiScreeningRoundConfig({
    screeningRequirements: [
      { id: 'a', question: 'Q?', expectedAnswer: '', predefined: true },
      { id: 'b', question: 'Q2?', expectedAnswer: '  ', predefined: true },
      { id: 'c', question: 'Q3?', expectedAnswer: 'Bangalore', predefined: true },
    ],
  });
  const configured = configuredAiScreeningRequirements(cfg);
  assert(configured.length === 1 && configured[0]!.id === 'c', 'empty expectedAnswer skipped');
}

async function testAnalyzerEmptyCompletesNoFlags() {
  const svc = new ScreeningAnalyzerService(
    {
      chatJson: async () => {
        throw new Error('LLM must not be called when requirements empty');
      },
      chatJsonDetailed: async () => {
        throw new Error('LLM must not be called when requirements empty');
      },
    } as never,
    { create: (row: unknown) => row, save: async () => undefined } as never,
  );
  const pending = svc.buildPendingAudit({
    transcript: [{ role: 'user', content: 'hi' }],
    conversationState: {},
    roundConfig: {
      screeningRequirements: [
        { id: 'a', question: 'Q?', expectedAnswer: '', predefined: true },
      ],
    },
  });
  assert(pending.analyzerStatus === 'PENDING', 'pending audit');
  const done = await svc.analyze(pending);
  assert(done.analyzerStatus === 'COMPLETED', 'empty reqs complete');
  assert(done.screeningResult?.checks?.length === 0, 'no fabricated flags');
  assert(done.error === null, 'no error');
}

function testAnalyzerPromptEnforcesSatisfyVsFlag() {
  const promptPath = path.join(__dirname, 'screening-analyzer.prompt.ts');
  const promptSrc = fs.readFileSync(promptPath, 'utf8');
  assert(promptSrc.includes('AI_SCREENING_ANALYZER_SYSTEM_PROMPT'), 'prompt export present');
  assert(promptSrc.includes('NOT automatic PASS'), 'must reject answer-only PASS');
  assert(promptSrc.includes('less than ₹10,000'), 'compensation FLAG example');
  assert(promptSrc.includes('30 days notice'), 'notice FLAG example');
  assert(promptSrc.includes('currently pursuing B.Tech'), 'education FLAG example');
  assert(promptSrc.includes('INSUFFICIENT_EVIDENCE'), 'insufficient status documented');

  const svcSrc = fs.readFileSync(path.join(__dirname, 'screening-analyzer.service.ts'), 'utf8');
  assert(
    svcSrc.includes('AI_SCREENING_ANALYZER_SYSTEM_PROMPT'),
    'analyzer service must use shared prompt',
  );
  assert(svcSrc.includes('Post-interview only'), 'documents post-interview timing');
}

function testLiveOrchestratorDoesNotFlag() {
  const orch = path.join(
    __dirname,
    '..',
    '..',
    '..',
    'services',
    'voice-engine',
    'ai_screening',
    'orchestrator.py',
  );
  const src = fs.readFileSync(orch, 'utf8');
  assert(
    src.includes('never as live pass/fail rules'),
    'live screening must not pass/fail on answers',
  );
  assert(
    src.includes('Do NOT score, judge, pass, fail, flag'),
    'live screening forbids live flags',
  );
}

function testCompleteAiScreeningDoesNotWriteFinalDecision() {
  const src = fs.readFileSync(
    path.join(__dirname, 'session-coordinator.service.ts'),
    'utf8',
  );
  const fnStart = src.indexOf('async completeAiScreening');
  assert(fnStart >= 0, 'completeAiScreening present');
  const fnEnd = src.indexOf('async retryScreeningAnalyzer', fnStart);
  const body = src.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 2500);
  assert(!/finalDecision\s*:/.test(body), 'completeAiScreening must not patch finalDecision');
  assert(body.includes('screeningVoiceAudit'), 'still writes screeningVoiceAudit');
  assert(body.includes('advanceApplicationStage'), 'still advances pipeline');
  assert(
    !body.includes('!row.isPreview && row.jobProfileId'),
    'must not skip pipeline advance for demo/preview when portalToken exists',
  );
  assert(body.includes('upsertFromInterviewToken'), 'persists round snapshot on complete');
  assert(
    body.includes('AutonomousInterviewPhase.COMPLETED') || body.includes('COMPLETED'),
    'marks interview session completed for FE redirect',
  );
  assert(body.includes('emitViewportShift'), 'emits viewport shift for portal redirect');
}

async function main() {
  testValidateStages();
  testEmptyRequirementsSkipped();
  await testAnalyzerEmptyCompletesNoFlags();
  testAnalyzerPromptEnforcesSatisfyVsFlag();
  testLiveOrchestratorDoesNotFlag();
  testCompleteAiScreeningDoesNotWriteFinalDecision();
  // eslint-disable-next-line no-console
  console.log('ai-screening isolation checks passed');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
