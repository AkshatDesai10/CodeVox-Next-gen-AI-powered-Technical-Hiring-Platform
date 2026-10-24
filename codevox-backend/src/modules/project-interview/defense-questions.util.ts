import type { ProjectChoice } from '../job-profiles/project-interview-round.types';

export type DefenseQuestion = {
  question: string;
  topic: string;
  expected_answer: string;
};

/** Last-resort questions from project metadata — no network, always available. */
export function buildDeterministicDefenseQuestions(project: ProjectChoice): DefenseQuestion[] {
  const title = project.title?.trim() || 'your project';
  const stack =
    project.tech_stack?.languages_frameworks?.filter(Boolean).slice(0, 3).join(', ') ||
    'your stack';
  const req0 = project.must_have_requirements?.[0]?.text?.trim();
  const req1 = project.must_have_requirements?.[1]?.text?.trim();
  const twist = project.twist_requirement?.trim();

  const q2 = req0
    ? `How did you implement the core requirement: "${req0}"? What specific data structures or logic did you use?`
    : `Walk through the most important feature you built in ${title} and how the main logic works.`;

  const q3 = req1
    ? `In your ${stack} setup, how did you handle data validation, persistence, and state for "${req1}"?`
    : `In your ${stack} setup, how did you structure data validation, persistence, and state management?`;

  const q4 = twist
    ? `How did your architecture adapt to the twist requirement: "${twist}"?`
    : `How did you handle error boundaries, edge cases, and unexpected user inputs in this implementation?`;

  return [
    {
      question: `Can you walk me through the high-level architecture and folder structure of your ${title} project?`,
      topic: 'architecture',
      expected_answer: 'Clear layers/modules, separation of concerns, main entry points.',
    },
    {
      question: q2,
      topic: 'logic',
      expected_answer: 'Concrete implementation details tied to the requirement.',
    },
    {
      question: q3,
      topic: 'data',
      expected_answer: 'Schema/validation/persistence choices with tradeoffs.',
    },
    {
      question: q4,
      topic: twist ? 'twist' : 'resilience',
      expected_answer: twist
        ? 'How the twist changed design and edge cases considered.'
        : 'Specific edge cases, failures, and defensive checks.',
    },
    {
      question: `If this service had to handle 10x concurrent traffic in production, where do you anticipate the first major bottleneck, and how would you optimize it?`,
      topic: 'scale',
      expected_answer: 'Bottleneck identification plus concrete caching/query/infra steps.',
    },
  ];
}

export function questionsFromProfileSuggested(
  suggested: Array<{ question?: string; topic?: string; expected_answer?: string }> | undefined | null,
  maxCount?: number,
): DefenseQuestion[] {
  if (!Array.isArray(suggested)) return [];
  const limit = Math.max(1, maxCount ?? Number.MAX_SAFE_INTEGER);
  return suggested
    .map((q) => ({
      question: String(q?.question ?? '').trim(),
      topic: String(q?.topic ?? 'logic'),
      expected_answer: String(q?.expected_answer ?? '').trim(),
    }))
    .filter((q) => q.question.length > 8)
    .slice(0, limit);
}

/** Prefer profile suggestions; pad with deterministic templates to reach `questionCount`. */
export function resolveDefenseQuestions(
  project: ProjectChoice,
  suggested?: Array<{ question?: string; topic?: string; expected_answer?: string }> | null,
  questionCount?: number,
): DefenseQuestion[] {
  const want = Math.max(1, questionCount ?? 5);
  const fromProfile = questionsFromProfileSuggested(suggested, want);
  const fallback =
    project.submission_type === 'excel_or_pdf'
      ? buildDeterministicExcelDefenseQuestions(project)
      : buildDeterministicDefenseQuestions(project);

  if (fromProfile.length >= want) return fromProfile.slice(0, want);

  const out = [...fromProfile];
  for (const q of fallback) {
    if (out.length >= want) break;
    if (!out.some((x) => x.question === q.question)) out.push(q);
  }
  // If HR asked for more than the template pool, repeat scaled probes rather than truncate.
  let i = 0;
  while (out.length < want && fallback.length > 0) {
    const base = fallback[i % fallback.length]!;
    out.push({
      ...base,
      question: `${base.question} (follow-up ${out.length + 1})`,
      topic: base.topic,
    });
    i += 1;
  }
  return out.slice(0, want);
}

export type EvaluationFallbackLevel =
  | 'NONE'
  | 'AST_PRIMARY'
  | 'LLM_METADATA'
  | 'DETERMINISTIC_STATIC'
  | 'EXCEL_KEY'
  | 'PDF_SOFT';

/** Deterministic Excel viva when LLM synth is unavailable. */
export function buildDeterministicExcelDefenseQuestions(
  project: ProjectChoice,
  gaps: string[] = [],
): DefenseQuestion[] {
  const title = project.title?.trim() || 'your Excel practical';
  const gap0 = gaps[0];
  const gap1 = gaps[1];
  return [
    {
      question: `Walk me through how you structured the workbook for "${title}". Which sheets did you treat as inputs vs calculations?`,
      topic: 'structure',
      expected_answer: 'Clear split between given data and formula outputs.',
    },
    {
      question: gap0
        ? `On this flagged area — ${gap0} — what formula or approach did you intend to use?`
        : `Which lookup or conditional formula did you rely on most, and why that choice over alternatives?`,
      topic: 'formulas',
      expected_answer: 'Named formula with rationale (VLOOKUP/XLOOKUP/IF/SUMIF etc.).',
    },
    {
      question: gap1
        ? `Another flagged cell: ${gap1}. How would you verify the result without looking at an answer key?`
        : `How do you check for hardcoded numbers that should have been formulas in a marksheet or sales sheet?`,
      topic: 'validation',
      expected_answer: 'Cross-check with sample rows, absolute refs, audit formulas.',
    },
    {
      question: `If the raw data rows doubled next month, which parts of your solution would break first and how would you make it scale?`,
      topic: 'scale',
      expected_answer: 'Tables/named ranges, dynamic ranges, pivot refresh.',
    },
    {
      question: `Explain absolute vs relative references with one example from this assessment.`,
      topic: 'viva_concepts',
      expected_answer: 'A1 vs $A$1 vs mixed refs with a concrete cell story.',
    },
  ];
}
