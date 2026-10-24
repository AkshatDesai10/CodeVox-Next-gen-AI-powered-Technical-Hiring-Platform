import { Inject, Injectable, forwardRef } from '@nestjs/common';
import { AssessmentExecutionRepository } from '../assessment-execution/assessment-execution.repository';
import { JobProfilesRepository } from '../job-profiles/job-profiles.repository';
import { CandidateAutonomousInterviewMysql } from './entities/candidate-autonomous-interview.mysql.entity';
import { buildResumeSkillsForTech, dedupeSkills } from './resume-skills.util';

@Injectable()
export class ResumeSkillsResolver {
  constructor(
    private readonly executionRepo: AssessmentExecutionRepository,
    @Inject(forwardRef(() => JobProfilesRepository))
    private readonly jobProfilesRepo: JobProfilesRepository,
  ) { }

  private async hydrateCandidateByApplicationToken(
    candidateToken: string | null,
  ): Promise<{
    candidateName?: string;
    projectsSummary?: string;
    experienceSummary?: string;
    candidateSkills?: string[];
    resumeUrl?: string | null;
    source: 'assessment' | 'application-token' | 'none';
  }> {
    if (!candidateToken) {
      return { source: 'none' };
    }

    const application = await this.jobProfilesRepo.findApplicationByToken(candidateToken);
    if (!application?.candidateId) {
      return { source: 'none' };
    }

    const candidate = await this.executionRepo.findCandidateById(application.candidateId);
    if (!candidate) {
      return { source: 'none' };
    }

    const candidateSkills = dedupeSkills(candidate.skills);
    const name = [candidate.firstName, candidate.lastName].filter(Boolean).join(' ').trim();

    return {
      candidateName: name || undefined,
      projectsSummary: candidate.projectsSummary || undefined,
      experienceSummary: candidate.experienceSummary || undefined,
      candidateSkills,
      resumeUrl: candidate.resumeUrl?.trim() || null,
      source: 'application-token',
    };
  }

  async resolveForInterview(row: CandidateAutonomousInterviewMysql): Promise<{
    skills: string[];
    candidateName?: string;
    projectsSummary?: string;
    experienceSummary?: string;
    resumeUrl?: string | null;
  }> {
    const techStack = row.techStack?.trim() || '';
    let candidateSkills: string[] | undefined;
    let candidateName: string | undefined;
    let projectsSummary: string | undefined;
    let experienceSummary: string | undefined;
    let resumeUrl: string | null | undefined;
    let candidateSource: 'assessment' | 'application-token' | 'none' = 'none';

    const snapshot = row.resumeSkills;
    if (Array.isArray(snapshot) && snapshot.length > 0) {
      candidateSkills = dedupeSkills(
        snapshot.filter((skill): skill is string => typeof skill === 'string'),
      );
    }

    if (row.candidateAssessmentId) {
      const assessment = await this.executionRepo.findCandidateAssessmentById(
        row.candidateAssessmentId,
      );
      if (assessment) {
        const candidate = await this.executionRepo.findCandidateById(
          assessment.candidateId,
        );
        if (candidate) {
          candidateSource = 'assessment';
          const name = [candidate.firstName, candidate.lastName]
            .filter(Boolean)
            .join(' ')
            .trim();
          candidateName = name || undefined;
          projectsSummary = candidate.projectsSummary || undefined;
          experienceSummary = candidate.experienceSummary || undefined;
          resumeUrl = candidate.resumeUrl?.trim() || null;
          if (candidate.skills?.length) {
            candidateSkills = dedupeSkills([
              ...(candidateSkills ?? []),
              ...candidate.skills,
            ]);
          }
        }
      }
    }

    if (candidateSource === 'none' && row.candidateToken) {
      const fallback = await this.hydrateCandidateByApplicationToken(row.candidateToken);
      if (fallback.source !== 'none') {
        candidateSource = fallback.source;
        candidateName = fallback.candidateName ?? candidateName;
        projectsSummary = fallback.projectsSummary ?? projectsSummary;
        experienceSummary = fallback.experienceSummary ?? experienceSummary;
        resumeUrl = fallback.resumeUrl ?? resumeUrl;
        if (fallback.candidateSkills?.length) {
          candidateSkills = dedupeSkills([
            ...(candidateSkills ?? []),
            ...fallback.candidateSkills,
          ]);
        }
      }
    }

    // LiveKit sessions use ses_… tokens; the application invite lives on proctor_summary.portalToken.
    if (candidateSource === 'none') {
      const portalToken =
        row.proctorSummary &&
        typeof (row.proctorSummary as Record<string, unknown>).portalToken === 'string'
          ? String((row.proctorSummary as Record<string, unknown>).portalToken).trim()
          : '';
      if (portalToken && portalToken !== row.candidateToken) {
        const fallback = await this.hydrateCandidateByApplicationToken(portalToken);
        if (fallback.source !== 'none') {
          candidateSource = fallback.source;
          candidateName = fallback.candidateName ?? candidateName;
          projectsSummary = fallback.projectsSummary ?? projectsSummary;
          experienceSummary = fallback.experienceSummary ?? experienceSummary;
          resumeUrl = fallback.resumeUrl ?? resumeUrl;
          if (fallback.candidateSkills?.length) {
            candidateSkills = dedupeSkills([
              ...(candidateSkills ?? []),
              ...fallback.candidateSkills,
            ]);
          }
        }
      }
    }

    const entryLevel = row.candidateToken?.trim().toLowerCase().endsWith('-entry') ?? false;
    candidateSkills = dedupeSkills(candidateSkills);
    const resolvedSkills = buildResumeSkillsForTech(techStack, candidateSkills, 8, entryLevel);

    return {
      skills: resolvedSkills,
      candidateName,
      projectsSummary,
      experienceSummary,
      resumeUrl: resumeUrl ?? null,
    };
  }
}
