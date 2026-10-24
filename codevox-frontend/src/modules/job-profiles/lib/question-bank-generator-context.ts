import { inferTechStackFromText } from '@/modules/job-profiles/lib/tech-stack-inference';

export type CompetencyLibraryEntry = {

  name: string;
  category?: string;
  description?: string | null;
  default_target_score?: number | null;
  default_weight_pct?: number | null;
};

export type ProfileCompetencyRef = {
  name: string;
  category?: string;
  target_score?: number | null;
  weight_pct?: number;
};

export type QuestionGeneratorContext = {
  competencyName: string;
  seniorityLevel: string;
  seniorityLabel: string;
  industryDomain: string;
  techStack: string;
  competencyDescription: string;
  rubricCriteria: string;
};

export function normalizeSeniorityForAi(level: string | null | undefined): string {
  if (!level?.trim()) return 'MID-LEVEL';
  const u = level.trim().toUpperCase();
  if (u.includes('INTERN') || u.includes('FRESHER')) return 'INTERN / FRESHER';
  if (u.includes('JUNIOR') || u.includes('ENTRY')) return 'JUNIOR';
  if (u.includes('LEAD') || u.includes('PRINCIPAL')) return 'LEAD / PRINCIPAL';
  if (u.includes('SENIOR') && !u.includes('MID')) return 'SENIOR';
  if (u.includes('MID')) return 'MID-LEVEL';
  return u;
}

export function formatSeniorityLabel(level: string | null | undefined): string {
  const normalized = normalizeSeniorityForAi(level);
  const labels: Record<string, string> = {
    'INTERN / FRESHER': 'Intern / Fresher',
    JUNIOR: 'Junior (0-2 years)',
    'MID-LEVEL': 'Mid-Level (2-5 years)',
    SENIOR: 'Senior (5-8 years)',
    'LEAD / PRINCIPAL': 'Lead / Principal (8+ years)',
  };
  return labels[normalized] ?? normalized;
}

function inferTechStackFromCompetency(entry: CompetencyLibraryEntry): string {
  const name = entry.name.toLowerCase();
  const desc = (entry.description ?? '').toLowerCase();
  const blob = `${name} ${desc}`;
  if (entry.category === 'soft') return 'N/A - behavioral competency';
  return inferTechStackFromText(blob);
}

export function buildRubricCriteriaFromLibrary(entry: CompetencyLibraryEntry): string {
  const desc = entry.description?.trim();
  const target = entry.default_target_score;
  const weight = entry.default_weight_pct;
  const levels =
    target != null
      ? `1=Below expectations, 2=Developing, 3=Proficient, 4=Strong (target ${target}/5), 5=Exceptional`
      : '1=Emerging, 2=Developing, 3=Proficient, 4=Advanced, 5=Expert';
  const weightNote = weight != null ? `Rubric weight: ${weight}%` : 'Rubric weight: not specified';
  if (desc) return `${levels}. ${desc} ${weightNote}.`;
  return `${levels}. ${weightNote}.`;
}

export function buildRubricCriteriaFromProfileCompetency(
  competency: ProfileCompetencyRef,
  libraryEntry?: CompetencyLibraryEntry | null,
): string {
  const desc = libraryEntry?.description?.trim();
  const target = competency.target_score;
  const weight = competency.weight_pct;
  const levels =
    target != null
      ? `1=Below expectations, 2=Developing, 3=Proficient, 4=Strong (profile target ${target}/5), 5=Exceptional`
      : '1=Emerging, 2=Developing, 3=Proficient, 4=Advanced, 5=Expert';
  const weightNote = weight != null ? `Rubric weight: ${weight}%` : 'Rubric weight: not specified';
  if (desc) return `${levels}. ${desc} ${weightNote}.`;
  return `${levels}. ${weightNote}.`;
}

export function deriveTechStackFromProfile(profile: {
  title?: string | null;
  required_skills?: string[] | null;
  nice_to_have_skills?: string[] | null;
  responsibilities?: string[] | null;
  autonomous_interview_config?: Record<string, unknown> | null;
}): string {
  const config = profile.autonomous_interview_config;
  const fromConfig = typeof config?.tech_stack === 'string' ? config.tech_stack.trim() : '';
  if (fromConfig) return fromConfig;
  const skills = [
    ...(profile.required_skills ?? []),
    ...(profile.nice_to_have_skills ?? []),
    ...(profile.responsibilities ?? []).slice(0, 3),
    profile.title ?? '',
  ]
    .map((s) => s.trim())
    .filter(Boolean);
  const joined = skills.slice(0, 10).join(', ');
  if (joined) return joined;
  return inferTechStackFromText(profile.title ?? '');
}

export function buildCompetencyGeneratorContext(
  entry: CompetencyLibraryEntry | null | undefined,
  options?: {
    seniorityLevel?: string;
    industryDomain?: string;
    techStack?: string;
  },
): QuestionGeneratorContext | null {
  if (!entry?.name?.trim()) return null;
  return {
    competencyName: entry.name,
    seniorityLevel: normalizeSeniorityForAi(options?.seniorityLevel),
    seniorityLabel: formatSeniorityLabel(options?.seniorityLevel),
    industryDomain: options?.industryDomain?.trim() || 'General',
    techStack: options?.techStack?.trim() || inferTechStackFromCompetency(entry),
    competencyDescription: entry.description?.trim() || `${entry.name} competency.`,
    rubricCriteria: buildRubricCriteriaFromLibrary(entry),
  };
}

export function buildJobProfileCompetencyGeneratorContext(input: {
  profile: {
    title: string;
    seniority_level?: string | null;
    department?: string | null;
    required_skills?: string[] | null;
    nice_to_have_skills?: string[] | null;
    autonomous_interview_config?: Record<string, unknown> | null;
  };
  competency: ProfileCompetencyRef | null | undefined;
  libraryEntry?: CompetencyLibraryEntry | null;
}): QuestionGeneratorContext | null {
  const { profile, competency, libraryEntry } = input;
  if (!competency?.name?.trim()) return null;
  const entry: CompetencyLibraryEntry = {
    name: competency.name,
    category: competency.category ?? libraryEntry?.category,
    description: libraryEntry?.description ?? null,
    default_target_score: competency.target_score ?? libraryEntry?.default_target_score ?? null,
    default_weight_pct: competency.weight_pct ?? libraryEntry?.default_weight_pct ?? null,
  };
  const techStack = deriveTechStackFromProfile(profile);
  return {
    competencyName: competency.name,
    seniorityLevel: normalizeSeniorityForAi(profile.seniority_level),
    seniorityLabel: formatSeniorityLabel(profile.seniority_level),
    industryDomain: profile.department?.trim() || 'General',
    techStack: techStack || inferTechStackFromCompetency(entry),
    competencyDescription: libraryEntry?.description?.trim() || `${competency.name} on ${profile.title}.`,
    rubricCriteria: buildRubricCriteriaFromProfileCompetency(competency, libraryEntry),
  };
}

/** @deprecated Use buildCompetencyGeneratorContext - kept for transitional imports */
export function buildQuestionGeneratorContext(
  _detail: unknown,
  competencyName: string | null,
  library: CompetencyLibraryEntry[] | undefined,
): QuestionGeneratorContext | null {
  const entry = library?.find((item) => item.name === competencyName) ?? (competencyName ? { name: competencyName } : null);
  return buildCompetencyGeneratorContext(entry);
}
