/**
 * Isolation smoke checks for Resume Screening (no Jest).
 * Run: npx ts-node -r tsconfig-paths/register src/modules/recruitment/resume-screening/resume-screening.isolation.spec.ts
 */
import * as fs from 'fs';
import * as path from 'path';

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(rel: string) {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

function main() {
  const service = read('resume-screening.service.ts');
  const engine = read('resume-screening.engine.ts');
  const moduleSrc = read('resume-screening.module.ts');

  assert(!/screening_voice_audit|ai_screening|VoiceEngine|threshold_config|progression_config/.test(service), 'service must not touch voice/threshold/progression');
  assert(!/RecruitmentAiService\.scoreLead|scoreLead\(/.test(service), 'must not call engagement scoreLead');
  assert(!/JobStageType|ai_score\s*=/.test(engine), 'engine must not write ai_score or stages');
  assert(/RESUME_SCREENING_QUEUE|ResumeScreeningProcessor/.test(moduleSrc + service), 'queue wiring present');
  assert(/ensureSeenAndEnqueue/.test(service), 'ensureSeenAndEnqueue present');
  assert(/force/.test(service), 'manual force re-run path present');

  // eslint-disable-next-line no-console
  console.log('resume-screening.isolation.spec.ts: all passed');
}

main();
