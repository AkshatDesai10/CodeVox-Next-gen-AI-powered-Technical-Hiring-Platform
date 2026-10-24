import { Injectable } from '@nestjs/common';
import { OpenAiClientService, type ChatMessage } from '../assessment-platform/assessment-ai/openai-client.service';
import { JobProfilesRepository } from '../job-profiles/job-profiles.repository';
import { RecruitmentRepository } from './recruitment.repository';
import type { LocalLeadRow } from './recruitment-local.types';

export type AiQualificationResult = {
  verdict: 'Qualified' | 'Borderline' | 'Not Qualified';
  score: number;
  reasoning: Array<{ field: string; note: string }>;
  summary: string;
};

export type AiDraftInterviewResult = {
  interview_result: string;
  interview_remark: string;
  recommendation: 'Shortlist' | 'Hold' | 'Reject';
  competency_notes: Array<{ competency: string; note: string }>;
};

@Injectable()
export class RecruitmentAiService {
  constructor(
    private readonly openai: OpenAiClientService,
    private readonly jobRepo: JobProfilesRepository,
    private readonly repo: RecruitmentRepository,
  ) {}

  private experienceFromLead(lead: LocalLeadRow): number | null {
    return lead.experience_years;
  }

  async scoreLead(lead: LocalLeadRow, courseName?: string) {
    const course =
      courseName ??
      lead.lead_courses[0]?.course_name ??
      'General';
    const [rows] = await this.jobRepo.listProfiles({
      search: course,
      limit: 1,
      offset: 0,
    });
    const jobProfile = rows[0];

    const exp = this.experienceFromLead(lead) ?? 0;
    const notice = lead.notice_period_days ?? 30;
    let score = 50;
    if (exp >= 3) score += 15;
    if (exp >= 1 && exp < 3) score += 8;
    if (notice <= 15) score += 10;
    if (lead.verified_lead === 1) score += 5;
    if (lead.resume_url) score += 5;
    if (lead.leads_answers && Object.keys(lead.leads_answers).length > 5) score += 10;
    score = Math.min(100, Math.max(0, score));

    if (this.openai.isConfigured()) {
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            'Return JSON: { score: number 0-100, summary: string, factors: string[] } for recruitment lead fit.',
        },
        {
          role: 'user',
          content: JSON.stringify({
            course,
            job_profile: jobProfile?.title ?? course,
            experience_years: exp,
            notice_period_days: notice,
            answers: lead.leads_answers,
            priority: lead.priority,
          }),
        },
      ];
      try {
        const ai = await this.openai.chatJson<{
          score: number;
          summary: string;
          factors: string[];
        }>(messages);
        if ((ai as Record<string, unknown> | undefined)?.__isFallback) {
          throw new Error('AI fallback response rejected for lead scoring');
        }
        if (Number.isFinite(ai.score)) score = Math.round(ai.score);
        await this.repo.mergeLeadOverlay(lead.lead_id, {
          aiScore: String(score),
        });
        return { score, summary: ai.summary, factors: ai.factors, ai_powered: true };
      } catch {
        /* fallback below */
      }
    }

    const summary = `${lead.firstname} ${lead.lastname ?? ''}`.trim() +
      ` — ${exp} yr exp, ${notice}-day notice, applying for ${course}.`;
    await this.repo.mergeLeadOverlay(lead.lead_id, { aiScore: String(score) });
    return {
      score,
      summary,
      factors: ['experience', 'notice_period', 'form_completeness'],
      ai_powered: false,
    };
  }

  async qualifyLead(lead: LocalLeadRow, courseName?: string): Promise<AiQualificationResult> {
    const scored = await this.scoreLead(lead, courseName);
    let verdict: AiQualificationResult['verdict'] = 'Borderline';
    if (scored.score >= 75) verdict = 'Qualified';
    else if (scored.score < 50) verdict = 'Not Qualified';

    const reasoning = [
      {
        field: 'experience',
        note: lead.experience_years != null
          ? `${lead.experience_years} years reported`
          : 'Experience not stated',
      },
      {
        field: 'notice_period',
        note: lead.notice_period_days != null
          ? `${lead.notice_period_days} days`
          : 'Notice period unknown',
      },
      {
        field: 'resume',
        note: lead.resume_url ? 'Resume uploaded' : 'No resume on file',
      },
    ];

    const result: AiQualificationResult = {
      verdict,
      score: scored.score,
      reasoning,
      summary: scored.summary,
    };

    await this.repo.mergeLeadOverlay(lead.lead_id, {
      aiQualificationJson: result as unknown as Record<string, unknown>,
    });

    return result;
  }

  async parseResume(lead: LocalLeadRow) {
    const answers = lead.leads_answers ?? {};
    const parsed = {
      skills: Object.values(answers).filter((v) => /php|java|react|node/i.test(v)),
      experience_years: lead.experience_years,
      education: lead.educational_details,
      source: lead.resume_url ? 'resume_url' : 'form_answers',
      resume_url: lead.resume_url,
      inferred_from_answers: answers,
    };

    let mismatch = false;
    const answerExp = lead.experience_years;
    if (answerExp != null && parsed.experience_years != null) {
      /* same source for now */
    }

    if (this.openai.isConfigured() && lead.resume_url) {
      const messages: ChatMessage[] = [
        {
          role: 'system',
          content:
            'Return JSON: { skills: string[], experience_years: number|null, education_summary: string, experience_summary: string, projects_summary: string, summary: string }',
        },
        {
          role: 'user',
          content: `Infer detailed resume structure from candidate form answers and metadata. Extract deep technical projects and detailed past work experience. Resume URL: ${lead.resume_url}. Answers: ${JSON.stringify(answers)}`,
        },
      ];
      try {
        const ai = await this.openai.chatJson<{
          skills: string[];
          experience_years: number | null;
          education_summary: string;
          experience_summary: string;
          projects_summary: string;
          summary: string;
        }>(messages);
        if ((ai as Record<string, unknown> | undefined)?.__isFallback) {
          throw new Error('AI fallback response rejected for resume parsing');
        }
        Object.assign(parsed, ai);
        if (
          ai.experience_years != null &&
          answerExp != null &&
          Math.abs(ai.experience_years - answerExp) >= 2
        ) {
          mismatch = true;
        }
      } catch {
        /* keep heuristic parse */
      }
    }

    await this.repo.mergeLeadOverlay(lead.lead_id, {
      parsedResumeJson: parsed as unknown as Record<string, unknown>,
      resumeMismatchFlag: mismatch ? 1 : 0,
    });

    return { parsed, mismatch };
  }

  async draftInterviewResult(
    lead: LocalLeadRow,
    interviewSummary: string,
  ): Promise<AiDraftInterviewResult> {
    const fallback: AiDraftInterviewResult = {
      interview_result: 'Pending review',
      interview_remark: `AI draft for ${lead.firstname}: ${interviewSummary || 'Interview completed.'}`,
      recommendation: 'Hold',
      competency_notes: [{ competency: 'General', note: 'Manual review recommended' }],
    };

    if (!this.openai.isConfigured()) return fallback;

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content:
          'Return JSON: { interview_result, interview_remark, recommendation: Shortlist|Hold|Reject, competency_notes: [{competency, note}] }',
      },
      {
        role: 'user',
        content: JSON.stringify({
          candidate: `${lead.firstname} ${lead.lastname ?? ''}`,
          course: lead.lead_courses[0]?.course_name,
          experience: lead.experience_years,
          interview_summary: interviewSummary,
          answers: lead.leads_answers,
        }),
      },
    ];

    try {
      return await this.openai.chatJson<AiDraftInterviewResult>(messages);
    } catch {
      return fallback;
    }
  }

  buildLeadBrief(lead: LocalLeadRow): string {
    const name = [lead.firstname, lead.lastname].filter(Boolean).join(' ');
    const course = lead.lead_courses.map((c) => c.course_name).filter(Boolean).join(', ');
    const exp = lead.experience_years != null ? `${lead.experience_years} yr` : 'unknown exp';
    const company = lead.current_company ?? 'unknown company';
    const notice =
      lead.notice_period_days != null ? `${lead.notice_period_days}-day notice` : 'notice unknown';
    return `${name}, ${course || 'candidate'}, ${exp} at ${company}, ${notice}.`;
  }
}
