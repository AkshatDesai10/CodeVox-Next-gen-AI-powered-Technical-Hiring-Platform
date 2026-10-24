export const MASTER_COMPETENCY_FALLBACK = [
  'System Design',
  'Problem Solving',
  'Data Structures & Algorithms',
  'API Design',
  'Database Design',
  'Code Quality & Testing',
  'DevOps & CI/CD',
  'Cloud Architecture',
  'Security',
  'Communication',
  'Leadership',
  'Conflict Resolution',
  'Stakeholder Management',
  'Agile Delivery',
  'Technical Leadership',
  'Analytical Thinking',
  'Decision Making',
  'Culture Fit',
];

export const SENIORITY_LEVELS = [
  { value: 'INTERN / FRESHER', label: 'Intern / Fresher' },
  { value: 'JUNIOR', label: 'Junior (0-2 years)' },
  { value: 'MID-LEVEL', label: 'Mid-Level (2-5 years)' },
  { value: 'SENIOR', label: 'Senior (5-8 years)' },
  { value: 'LEAD / PRINCIPAL', label: 'Lead / Principal (8+ years)' },
];

export const MAGIC_QUESTION_TYPE_OPTIONS = [
  { value: 'intro', label: 'Intro' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'situational', label: 'Situational' },
  { value: 'technical', label: 'Technical' },
  { value: 'culture_fit', label: 'Culture Fit' },
];

export const GENERATOR_DIFFICULTY_OPTIONS = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
] as const;

export type GeneratorDifficulty = (typeof GENERATOR_DIFFICULTY_OPTIONS)[number]['value'];

export const DEFAULT_MAGIC_QUESTION_TYPES = ['behavioral', 'technical'];

export const QUESTION_TYPE_OPTIONS = [
  { value: 'intro', label: 'Intro' },
  { value: 'behavioral', label: 'Behavioral' },
  { value: 'situational', label: 'Situational' },
  { value: 'technical', label: 'Technical' },
  { value: 'competency_based', label: 'Competency Based' },
  { value: 'culture_fit', label: 'Culture Fit' },
];

export const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
];

export const QUESTION_COUNT_OPTIONS = [1, 2, 3, 4, 5];

export const DEFAULT_QUESTION_COUNT = 3;

export const INDUSTRY_DOMAIN_OPTIONS = [
  'Software Development',
  'Sales / EdTech',
  'Finance / Banking',
  'Healthcare',
  'E-commerce',
  'Manufacturing',
  'Consulting',
  'General',
];

export function mergeCompetencyOptions(apiNames: string[] | undefined) {
  const merged = [...new Set([...(apiNames ?? []), ...MASTER_COMPETENCY_FALLBACK])];
  return merged.sort((a, b) => a.localeCompare(b));
}
