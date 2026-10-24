/** @deprecated Import from ./ai instead — thin re-export for backward compatibility */
export type { ProblemBankAiGenerateInput } from './ai/types';
export {
  PROBLEM_BANK_AI_SYSTEM_PROMPT,
  buildProblemBankAiUserPrompt,
  composeProblemStatementMarkdown,
} from './ai';
