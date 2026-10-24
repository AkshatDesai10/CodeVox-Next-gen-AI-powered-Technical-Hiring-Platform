export type QuestionBankAiGenerateInput = {
  question_count: number;
  job_role: string;
  competency_name: string;
  competency_description?: string;
  competency_rubric_criteria?: string;
  seniority_level: string;
  question_type?: string;
  question_types?: string[];
  industry_domain?: string;
  tech_stack?: string;
  additional_context?: string;
  difficulty?: string;
  job_profile_id?: string;
};

export const QUESTION_BANK_AI_SYSTEM_PROMPT = `You are an expert interview question designer for a recruitment platform. Your job is to generate high-quality, bias-free interview questions that are specifically calibrated to a candidate's seniority level, the competency being assessed, and the question type requested.

You follow these rules strictly:
- Never ask questions about age, gender, family status, religion, caste, marital status, or any other legally protected characteristic.
- Never ask questions that can be answered with a simple yes or no unless the type is explicitly INTRO.
- Questions must be open-ended and invite the candidate to demonstrate knowledge or experience.
- Follow-up questions must probe depth, not repeat the main question.
- Expected answer notes are for internal recruiter/AI use only — they are never shown to the candidate.
- Ideal answer keywords must be specific concepts, not vague descriptors like "good communication".
- Always return valid JSON matching the exact schema provided. No extra text, no markdown fences, no explanation outside the JSON.

Integration rules:
- question_count is capped at 5; prefer 3 questions unless more coverage is explicitly needed.
- If competency_rubric_criteria is empty, infer reasonable 1–5 rubric levels from competency and job role.
- All generated questions are drafts for recruiter review — never imply they are auto-published.
- bias_check_passed must be false when any legally protected characteristic or leading demographic question appears.
- follow_up_trigger must be specific and detectable in a candidate answer, not vague.
- ideal_answer_keywords feed live AI scoring; red_flag_signals feed post-session evaluation.`;

const SENIORITY_DEFINITIONS = `SENIORITY LEVEL DEFINITIONS — calibrate question depth to this:

INTERN / FRESHER:
- No prior work experience expected
- Ask about academic projects, coursework, self-learning
- Questions should test foundational knowledge and learning attitude
- Avoid expecting production-level experience

JUNIOR (0–2 years):
- Basic hands-on experience expected
- Ask about tasks they have personally done, not team-level decisions
- Test understanding of fundamentals with some practical application
- Avoid expecting architectural or system-design thinking

MID-LEVEL (2–5 years):
- Independent contributor expected
- Ask about ownership of features, handling edge cases, debugging
- Test ability to make reasoned technical or situational decisions
- Some mentoring of juniors may be expected

SENIOR (5–8 years):
- Deep expertise expected
- Ask about designing systems, leading decisions, handling scale
- Test ability to evaluate tradeoffs and defend choices
- Mentoring and cross-team collaboration expected

LEAD / PRINCIPAL (8+ years):
- Strategic and architectural thinking expected
- Ask about setting technical direction, managing complexity across teams
- Test ability to balance technical depth with business impact
- People leadership and stakeholder management expected`;

const TYPE_DEFINITIONS = `QUESTION TYPE DEFINITIONS — format and intent must match this:

INTRO:
- Light, conversational opener
- Purpose: warm up the candidate, get a broad self-overview
- Should not be used for competency scoring
- Example pattern: "Tell me about your background in X" or "Walk me through your experience with Y"

BEHAVIORAL:
- Must follow STAR structure invitation (Situation, Task, Action, Result)
- Asks about a specific past experience
- Pattern: "Tell me about a time when..." or "Describe a situation where..."
- Tests what the candidate has actually done, not what they would do
- Expected answer must mention a real scenario with measurable outcome

SITUATIONAL:
- Presents a hypothetical scenario
- Pattern: "Imagine you are..." or "If you were faced with..."
- Tests what the candidate would do, how they think
- Used when behavioral evidence may not exist (fresher/junior) or to test judgment
- Expected answer must show reasoning process, not just a conclusion

TECHNICAL:
- Tests specific technical knowledge or skill
- Can be conceptual ("Explain how X works") or applied ("How would you implement Y?")
- For senior levels, must go beyond definitions to tradeoffs, limitations, real-world usage
- Expected answer must include specific technical concepts, not just general descriptions

COMPETENCY-BASED:
- Directly tied to a specific rubric criterion
- Blends behavioral and situational styles
- Must reference the competency rubric criteria provided
- Scoring mapped directly to rubric levels

CULTURE FIT:
- Tests alignment with values, work style, collaboration preferences
- Must not fish for demographic information
- Pattern: "How do you prefer to..." or "What kind of environment brings out your best work?"
- Expected answer should reveal work style signals, not personal life details`;

export function buildQuestionBankAiUserPrompt(input: QuestionBankAiGenerateInput): string {
  const types = (input.question_types?.length ? input.question_types : [input.question_type || 'behavioral'])
    .map((t) => t.toUpperCase().replace(/-/g, '_').replace(/\s+/g, '_'))
    .filter(Boolean);
  const typeLine =
    types.length > 1
      ? `Question Types (distribute ${input.question_count} questions across these): ${types.join(', ')}`
      : `Question Type: ${types[0] ?? 'BEHAVIORAL'}`;
  const difficultyLine =
    !input.difficulty || input.difficulty.toLowerCase() === 'mixed'
      ? 'Difficulty: MIXED — calibrate Easy, Medium, or Hard per question based on seniority level; do not use one fixed difficulty for all.'
      : `Difficulty: ${input.difficulty.toUpperCase()} for all questions unless seniority calibration clearly warrants otherwise.`;
  const primaryType = types[0] ?? 'BEHAVIORAL';
  return `Generate ${input.question_count} interview questions for the following specification:

Primary Competency: ${input.competency_name}
Competency Description: ${input.competency_description?.trim() || 'Not provided — infer from competency name.'}
Competency Rubric Criteria: ${input.competency_rubric_criteria?.trim() || 'Not provided — infer reasonable rubric levels 1–5.'}
Seniority Level: ${input.seniority_level}
${typeLine}
${difficultyLine}
Industry/Domain (optional context): ${input.industry_domain?.trim() || 'General'}
Tech Stack (only if competency is technical): ${input.tech_stack?.trim() || 'Infer from competency — omit stack depth for soft competencies'}
Additional Context: ${input.additional_context?.trim() || 'None'}

${SENIORITY_DEFINITIONS}

${TYPE_DEFINITIONS}

When multiple question types are requested, distribute questions across those types and set each item's question_type to the type used for that question.

RETURN FORMAT — strict JSON, no deviation:
{
  "generated_questions": [
    {
      "question_text": "Full question text exactly as the AI interviewer will speak it",
      "question_type": "${primaryType}",
      "competency": "${input.competency_name}",
      "seniority_level": "${input.seniority_level}",
      "difficulty": "Easy | Medium | Hard",
      "time_guidance_minutes": 3,
      "follow_up_question": "The probe question to ask if the candidate's answer is vague or incomplete",
      "follow_up_trigger": "What specifically in the main answer (or lack of) should trigger this follow-up",
      "expected_answer_notes": "Internal guidance: what a strong answer to this question looks like. Specific concepts, experiences, or reasoning patterns to listen for.",
      "ideal_answer_keywords": ["keyword1", "keyword2", "keyword3"],
      "red_flag_signals": ["What a weak or concerning answer sounds like", "Specific patterns that suggest the candidate lacks this competency"],
      "topic_tags": ["tag1", "tag2"],
      "bias_check_passed": true,
      "bias_check_notes": "Empty string if clean. If a concern exists, describe it here even if the question is still usable."
    }
  ],
  "competency_coverage_notes": "Brief note on whether these questions collectively give good signal on the full competency rubric criteria provided",
  "seniority_calibration_notes": "Brief note on how the question depth was adjusted for the specified seniority level"
}

Example calibration (Technical, Senior, PHP):
Input: job_role=Senior PHP Developer, competency=Database Design & Optimization, seniority=SENIOR, question_type=TECHNICAL
Output question should probe EXPLAIN plans, N+1 detection, indexing tradeoffs — not basic CRUD syntax.`;
}
