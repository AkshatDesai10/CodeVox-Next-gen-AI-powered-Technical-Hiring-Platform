import type { CompetencyLibraryEntry, ProfileCompetencyRef } from '@/modules/job-profiles/lib/question-bank-generator-context';
import {
  buildCompetencyGeneratorContext,
  buildJobProfileCompetencyGeneratorContext,
  formatSeniorityLabel,
  normalizeSeniorityForAi,
} from '@/modules/job-profiles/lib/question-bank-generator-context';

export type ProblemGeneratorContext = {
  competencyName: string;
  competencyDescription: string;
  seniorityLevel: string;
  seniorityLabel: string;
  industryDomain: string;
  techStack: string;
  jobRole: string;
};

export function buildCompetencyProblemContext(
  entry: CompetencyLibraryEntry | null | undefined,
  options?: {
    seniorityLevel?: string;
    industryDomain?: string;
    techStack?: string;
    jobRole?: string;
  },
): ProblemGeneratorContext | null {
  const base = buildCompetencyGeneratorContext(entry, options);
  if (!base) return null;
  return {
    competencyName: base.competencyName,
    competencyDescription: base.competencyDescription,
    seniorityLevel: base.seniorityLevel,
    seniorityLabel: base.seniorityLabel,
    industryDomain: base.industryDomain,
    techStack: base.techStack,
    jobRole: options?.jobRole ?? base.competencyName,
  };
}

export function buildJobProfileProblemContext(input: {
  profile: Parameters<typeof buildJobProfileCompetencyGeneratorContext>[0]['profile'];
  competency: ProfileCompetencyRef | null | undefined;
  libraryEntry?: CompetencyLibraryEntry | null;
}): ProblemGeneratorContext | null {
  const base = buildJobProfileCompetencyGeneratorContext(input);
  if (!base) return null;
  return {
    competencyName: base.competencyName,
    competencyDescription: base.competencyDescription,
    seniorityLevel: base.seniorityLevel,
    seniorityLabel: base.seniorityLabel,
    industryDomain: base.industryDomain,
    techStack: base.techStack,
    jobRole: input.profile.title,
  };
}

/** @deprecated Use buildCompetencyProblemContext */
export function buildProblemGeneratorContext(): ProblemGeneratorContext | null {
  return null;
}

export { formatSeniorityLabel, normalizeSeniorityForAi };
