import { JobStageType } from './entities/job-profile-stage.mysql.entity';
import type { QuestionPromptProfile } from '../assessment-platform/assessment-engine/utils/assessment-generation-prompt.util';

export type RoundQuestionContext = {
  name: string;
  stageType: string;
  stageKey?: string | null;
  description?: string | null;
  mode?: string;
};

export type RoundQuestionPromptHints = {
  questionType: string;
  promptLines: string[];
  effectiveStageType: string;
  promptProfile: QuestionPromptProfile;
  focusThemes: string[];
  difficulty: 'EASY' | 'MEDIUM' | 'HARD';
};

const SCREENING_THEMES = [
  'motivation and interest in this role',
  'communication and clarity',
  'relevant background summary',
  'teamwork and collaboration style',
  'career goals and growth',
  'work preferences and logistics',
];

const BEHAVIORAL_THEMES = [
  'handling conflict or pushback',
  'cross-functional collaboration',
  'learning from failure',
  'prioritization under pressure',
  'giving and receiving feedback',
  'values and culture fit',
];

const HR_PANEL_THEMES = [
  'culture and values alignment with the organization',
  'long-term career goals and motivation to join',
  'compensation expectations and notice period logistics',
  'collaboration style and working with managers/peers',
  'handling workplace conflict or ambiguity',
  'reason for change and role expectations',
];

const PANEL_THEMES = [
  'leadership judgment and decision-making',
  'stakeholder management and executive communication',
  'prioritization across competing business goals',
  'handling disagreement with leadership',
  'scaling teams or processes',
  'strategic thinking under uncertainty',
];

const ROUND_TYPE_HINTS: Record<
  string,
  {
    questionType: string;
    promptProfile: QuestionPromptProfile;
    difficulty: 'EASY' | 'MEDIUM' | 'HARD';
    focus: string;
    themes: string[];
  }
> = {
  [JobStageType.SCREENING]: {
    questionType: 'INTERVIEW',
    promptProfile: 'screening',
    difficulty: 'EASY',
    focus:
      'Initial phone screen only: motivation, communication, background summary, teamwork, and role fit. No coding, algorithms, or stack depth.',
    themes: SCREENING_THEMES,
  },
  [JobStageType.CODING]: {
    questionType: 'SYSTEM_DESIGN',
    promptProfile: 'technical',
    difficulty: 'MEDIUM',
    focus:
      'Technical round: algorithms, architecture, debugging mindset, or system design trade-offs.',
    themes: [],
  },
  [JobStageType.AI_VERBAL]: {
    questionType: 'INTERVIEW',
    promptProfile: 'behavioral',
    difficulty: 'MEDIUM',
    focus:
      'AI-led verbal interview: conversational open-ended questions suitable for voice follow-ups.',
    themes: BEHAVIORAL_THEMES,
  },
  [JobStageType.HR_VERBAL]: {
    questionType: 'INTERVIEW',
    promptProfile: 'hr_panel',
    difficulty: 'EASY',
    focus:
      'Final HR / culture round: values fit, collaboration, career goals, compensation readiness, and logistics. No technical depth.',
    themes: HR_PANEL_THEMES,
  },
  [JobStageType.PANEL]: {
    questionType: 'INTERVIEW',
    promptProfile: 'behavioral',
    difficulty: 'MEDIUM',
    focus: 'Panel round: leadership judgment, stakeholder management, and decision-making scenarios.',
    themes: PANEL_THEMES,
  },
  [JobStageType.CUSTOM]: {
    questionType: 'INTERVIEW',
    promptProfile: 'behavioral',
    difficulty: 'MEDIUM',
    focus: 'Match the round name and description.',
    themes: BEHAVIORAL_THEMES,
  },
  [JobStageType.TAKE_HOME]: {
    questionType: 'SYSTEM_DESIGN',
    promptProfile: 'technical',
    difficulty: 'MEDIUM',
    focus:
      'Take-home assessment: practical project brief with clear deliverables, constraints, and evaluation criteria. No spoken interview questions.',
    themes: [],
  },
  [JobStageType.PROJECT_INTERVIEW]: {
    questionType: 'INTERVIEW',
    promptProfile: 'technical',
    difficulty: 'MEDIUM',
    focus:
      'Build & Defend: conceptual voice questions about the candidate\'s own submitted project — libraries, scripts, configuration, and business logic. No line-by-line code questions.',
    themes: [],
  },
};

export function resolveEffectiveStageType(
  name: string,
  stageType: string,
  stageKey?: string | null,
): string {
  if (stageKey === 'hr_panel') return JobStageType.HR_VERBAL;
  if (stageKey === 'initial_screen') return JobStageType.SCREENING;
  if (stageKey === 'technical_assessment') return JobStageType.CODING;

  if (stageType && stageType !== JobStageType.CUSTOM) {
    return stageType;
  }

  const lower = name.toLowerCase();
  if (/screen|phone|initial/.test(lower)) return JobStageType.SCREENING;
  if (/cod|tech|engineer|system design|coding/.test(lower)) return JobStageType.CODING;
  if (/culture|fit|hr|people|salary|offer/.test(lower)) return JobStageType.HR_VERBAL;
  if (/panel|leadership|exec/.test(lower)) return JobStageType.PANEL;
  if (/verbal|voice|ai.?led/.test(lower)) return JobStageType.AI_VERBAL;
  return stageType || JobStageType.CUSTOM;
}

export function buildRoundQuestionPromptHints(round: RoundQuestionContext): RoundQuestionPromptHints {
  const effectiveStageType = resolveEffectiveStageType(round.name, round.stageType, round.stageKey);
  const base = ROUND_TYPE_HINTS[effectiveStageType] ?? ROUND_TYPE_HINTS[JobStageType.CUSTOM]!;
  const isNonTechnical = base.promptProfile !== 'technical';
  const isHrPanel = base.promptProfile === 'hr_panel';

  const promptLines = [
    `Assessment round: "${round.name}" (type: ${effectiveStageType.replace(/_/g, ' ')}).`,
    `Round focus: ${base.focus}`,
    round.description?.trim() ? `Round description: ${round.description.trim()}` : null,
    round.mode === 'ai_led'
      ? 'Delivery mode: AI-led — questions should work well with adaptive follow-ups.'
      : round.mode === 'human_led'
        ? 'Delivery mode: human interviewer — allow nuance and follow-up probes.'
        : null,
    isHrPanel
      ? 'FINAL HR ROUND: Ask culture-fit, values, motivation, compensation readiness, and logistics questions. Forbidden: coding, algorithms, debugging, system design, and deep stack trivia.'
      : isNonTechnical
        ? 'NON-TECHNICAL ROUND: Generate only spoken screening/behavioral questions. Forbidden: code, algorithms, debugging, system design, framework trivia, and whiteboard problems.'
        : 'Generate spoken interview questions (problemStatement = the question text candidates hear).',
    isNonTechnical
      ? 'Each problemStatement must be one natural question a recruiter or HR partner asks in this specific round.'
      : 'Do not generate MCQ options or coding starter code unless the round is explicitly technical.',
  ].filter((line): line is string => Boolean(line));

  return {
    questionType: base.questionType,
    promptLines,
    effectiveStageType,
    promptProfile: base.promptProfile,
    focusThemes: base.themes,
    difficulty: base.difficulty,
  };
}
