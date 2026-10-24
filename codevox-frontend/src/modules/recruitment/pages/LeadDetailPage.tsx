'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { LeadAnswersRenderer } from '@/modules/recruitment/components/LeadAnswersRenderer';
import { RecruitmentOpsShell } from '@/modules/recruitment/components/RecruitmentOpsShell';
import {
  getRecruitmentLead,
  inviteLeadToAssessment,
  qualifyLeadAi,
  rerunLeadResumeScreen,
  scheduleLocalInterview,
  type RecruitmentCommunicationItem,
  type RecruitmentLeadDetail,
  type RecruitmentLeadDetailLead,
  type RecruitmentLeadOverlay,
  type ResumeMatchResult,
} from '@/modules/recruitment/lib/recruitment-api';

type TimelineEntry = {
  id: string;
  title: string;
  detail: string;
  at: string;
  icon: string;
  tone: 'primary' | 'tertiary' | 'secondary' | 'success';
  italic?: boolean;
};

export function LeadDetailPage() {
  const params = useParams();
  const leadId = String(params?.leadId ?? '');
  const queryClient = useQueryClient();
  const [showSchedule, setShowSchedule] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [scheduleForm, setScheduleForm] = useState({
    appointment_date: '',
    appointment_time: '',
    interview_type: 'HR Round',
    interview_mode: 'Video',
    remarks_desc: '',
    meeting_url: '',
  });

  const detailQuery = useQuery({
    queryKey: ['recruitment-lead', leadId],
    queryFn: () => getRecruitmentLead(leadId),
    enabled: Boolean(leadId),
    refetchInterval: (q) => {
      const status =
        q.state.data?.overlay?.resume_match_status ??
        q.state.data?.lead?.resume_match_status;
      return status === 'PENDING' ? 5000 : false;
    },
  });

  const scheduleMutation = useMutation({
    mutationFn: () => scheduleLocalInterview(leadId, scheduleForm),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment-lead', leadId] });
      setShowSchedule(false);
    },
  });

  const aiQualMutation = useMutation({
    mutationFn: () => qualifyLeadAi(leadId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recruitment-lead', leadId] }),
  });

  const inviteMutation = useMutation({
    mutationFn: () => inviteLeadToAssessment(leadId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['recruitment-lead', leadId] });
      void queryClient.invalidateQueries({ queryKey: ['recruitment-interviews-today'] });
    },
    onError: (err: any) => {
      alert(`Failed to send invite: ${err.message}`);
    },
  });

  const resumeScreenMutation = useMutation({
    mutationFn: () => rerunLeadResumeScreen(leadId),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['recruitment-lead', leadId] }),
    onError: (err: any) => {
      alert(`Failed to re-run resume screen: ${err.message}`);
    },
  });

  if (detailQuery.isLoading) {
    return (
      <RecruitmentOpsShell>
        <p className="text-sm">Loading lead...</p>
      </RecruitmentOpsShell>
    );
  }

  if (detailQuery.isError || !detailQuery.data) {
    return (
      <RecruitmentOpsShell>
        <p className="text-sm text-red-600">Lead not found.</p>
      </RecruitmentOpsShell>
    );
  }

  const data = detailQuery.data;
  const lead = data.lead;
  const overlay = data.overlay;
  const score = lead.ai_score ?? overlay?.ai_score ?? lead.lead_score;
  const timeline = buildTimeline(data);
  const courseMatches = buildCourseMatches(lead, overlay, score);
  const skills = extractSkills(lead, overlay);
  const educationLine = formatEducation(lead, overlay);
  const verificationStatus = resolveVerificationStatus(lead, overlay);

  return (
    <RecruitmentOpsShell>
      <div className="flex flex-col gap-8">
        <Link
          href="/assessments/recruitment/leads"
          className="inline-flex w-fit items-center gap-1 text-sm text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-primary)]"
        >
          <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          Lead Inbox
        </Link>

        <LeadDetailHeader
          lead={lead}
          overlay={overlay}
          score={score}
          onSchedule={() => setShowSchedule(true)}
          onQualify={() => aiQualMutation.mutate()}
          qualifyLoading={aiQualMutation.isPending}
          onInvite={() => inviteMutation.mutate()}
          inviteLoading={inviteMutation.isPending}
        />

        <div className="lead-detail-bento">
          <TimelinePanel entries={timeline} />

          <VerificationPanel
            lead={lead}
            overlay={overlay}
            skills={skills}
            educationLine={educationLine}
            verificationStatus={verificationStatus}
            aiBrief={data.ai_brief}
            onQualify={() => aiQualMutation.mutate()}
            qualifyLoading={aiQualMutation.isPending}
          />

          <div className="col-span-12 flex h-auto flex-col gap-4 lg:col-span-3 lg:h-[600px]">
            <ProfileMatchingPanel matches={courseMatches} />
            <CommsPanel communications={data.communications} />
          </div>
        </div>

        <ResumeMatchPanel
          lead={lead}
          overlay={overlay}
          rerunning={resumeScreenMutation.isPending}
          onRerun={() => resumeScreenMutation.mutate()}
        />

        <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] mt-8">
          <button
            type="button"
            onClick={() => setShowMore((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-3 text-left"
          >
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--assessment-outline)]">
              More details
            </span>
            <span className="material-symbols-outlined text-[var(--assessment-on-surface-variant)]">
              {showMore ? 'expand_less' : 'expand_more'}
            </span>
          </button>
          {showMore ? (
            <div className="space-y-4 border-t border-[var(--assessment-outline-variant)] p-4">
              {(data.interviews.length > 0 ||
                data.interviews_local.length > 0 ||
                data.autonomous_sessions.length > 0) && (
                <InterviewHistorySection data={data} embedded />
              )}
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--assessment-outline)]">
                  Form answers
                </h3>
                <LeadAnswersRenderer answers={lead.leads_answers} rawFields={lead.raw_fields} />
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {showSchedule ? (
        <ScheduleModal
          form={scheduleForm}
          onChange={setScheduleForm}
          onClose={() => setShowSchedule(false)}
          onSave={() => scheduleMutation.mutate()}
          saving={scheduleMutation.isPending}
        />
      ) : null}
    </RecruitmentOpsShell>
  );
}

function LeadDetailHeader(props: {
  lead: RecruitmentLeadDetailLead;
  overlay: RecruitmentLeadOverlay | null;
  score: number | null;
  onSchedule: () => void;
  onQualify: () => void;
  qualifyLoading?: boolean;
  onInvite: () => void;
  inviteLoading?: boolean;
}) {
  const { lead, overlay, score } = props;
  const name = [lead.first_name, lead.middlename, lead.last_name].filter(Boolean).join(' ');
  const initials = [lead.first_name?.[0], lead.last_name?.[0]].filter(Boolean).join('').toUpperCase() || '?';
  const location = [lead.corr_city, lead.corr_state, lead.corr_country].filter(Boolean).join(', ');
  const roleLine =
    lead.courses[0]?.course_name ??
    lead.current_company ??
    (lead.experience_years != null ? `${lead.experience_years} yr experience` : null);
  const source = (lead.lead_source ?? lead.lead_sub_source ?? 'UNKNOWN').toUpperCase();
  const stage = (lead.effective_stage ?? lead.lead_stage ?? 'Active').toString();
  const engagement = engagementLabel(score);

  return (
    <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-end">
      <div className="flex items-center gap-6">
        <div className="relative shrink-0">
          <div className="h-20 w-20 rounded-full border-2 border-[var(--assessment-primary)] p-1">
            <div className="flex h-full w-full items-center justify-center rounded-full bg-[var(--assessment-surface-container-low)] text-xl font-bold text-[var(--assessment-primary)]">
              {initials}
            </div>
          </div>
          {lead.verified_lead === 1 ? (
            <div
              className="absolute bottom-0 right-0 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-green-500"
              title="Verified"
            >
              <span
                className="material-symbols-outlined text-[14px] text-white"
                style={{ fontVariationSettings: "'FILL' 1" }}
              >
                check
              </span>
            </div>
          ) : null}
        </div>
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h1 className="font-headline-lg text-[var(--assessment-on-surface)]">{name || 'Lead'}</h1>
            <span className="rounded-full bg-[var(--nexus-tertiary-fixed)] px-2 py-0.5 text-xs font-semibold text-[var(--nexus-on-tertiary-fixed)]">
              {stage}
            </span>
          </div>
          <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--assessment-on-surface-variant)]">
            {location ? (
              <>
                <span className="material-symbols-outlined text-sm">location_on</span>
                {location}
              </>
            ) : null}
            {location && roleLine ? <span>-</span> : null}
            {roleLine ? <span>{roleLine}</span> : null}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Chip label={`ID: ${shortId(lead.lead_id)}`} />
          </div>
        </div>
      </div>

      <div className="flex w-full gap-4 md:w-auto">
        <div className="flex flex-1 items-center gap-4 rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4 md:flex-none">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--nexus-tertiary-container)]/10 text-[var(--nexus-tertiary)]">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
              bolt
            </span>
          </div>
          <div>
            <p className="text-xs leading-[18px] text-[var(--assessment-on-surface-variant)]">
              Engagement Score
            </p>
            <p className="font-headline-sm leading-6 text-[var(--nexus-tertiary)]">
              {engagement.label}
              {score != null ? ` (${Math.round(score)}%)` : ''}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2">
          {overlay?.invite_status === 'INVITED' && overlay?.invite_token ? (
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
              <span className="rounded bg-green-100 px-3 py-1 text-sm font-bold text-green-800">
                Invited ✓
              </span>
              <div className="flex items-center gap-2 rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-2 py-1">
                <input
                  type="text"
                  readOnly
                  value={`${window.location.origin}/candidate/portal/${overlay.invite_token}`}
                  className="w-48 bg-transparent text-xs text-[var(--assessment-on-surface-variant)] outline-none"
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                />
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(`${window.location.origin}/candidate/portal/${overlay.invite_token}`);
                    alert('Magic Link copied!');
                  }}
                  className="flex items-center text-[var(--assessment-primary)] hover:opacity-80"
                >
                  <span className="material-symbols-outlined text-[16px]">content_copy</span>
                </button>
              </div>
              </div>
            </div>
          ) : overlay?.invite_status === 'NO_OPENING' ? (
            <span className="rounded bg-amber-100 px-3 py-1 text-sm font-bold text-amber-800">
              No Opening
            </span>
          ) : null}
          <div className="flex gap-2">
            {!overlay?.invite_status && (
              <button
                type="button"
                disabled={props.inviteLoading}
                onClick={props.onInvite}
                className="flex items-center gap-2 rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-2 text-sm font-semibold text-[var(--assessment-primary)] transition-colors hover:bg-[var(--assessment-surface-container-low)] disabled:opacity-50"
              >
                <span className="material-symbols-outlined text-[18px]">mail</span>
                {props.inviteLoading ? 'Sending...' : 'Send Magic Link'}
              </button>
            )}
          <button
            type="button"
            className="flex items-center gap-1 rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-4 py-2 text-sm font-semibold text-[var(--assessment-on-surface-variant)] transition-colors hover:bg-[var(--assessment-surface-container-low)]"
          >
            Reject
          </button>
          <button
            type="button"
            disabled={props.qualifyLoading}
            onClick={props.onQualify}
            className="flex items-center gap-1 rounded-full bg-[var(--nexus-tertiary)] px-4 py-2 text-sm font-semibold text-white shadow-sm transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {props.qualifyLoading ? 'Running...' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={props.onSchedule}
            className="flex items-center gap-2 rounded-full bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold tracking-wide text-white transition-opacity hover:opacity-90"
          >
            <span className="material-symbols-outlined text-[18px]">schedule</span>
            Schedule
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}

function TimelinePanel(props: { entries: TimelineEntry[] }) {
  return (
    <section className="lead-detail-panel col-span-12 flex flex-col overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] lg:col-span-4 lg:h-[600px]">
      <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4">
        <h2 className="font-headline-sm text-[var(--assessment-on-surface)]">Interaction Timeline</h2>
        <span className="material-symbols-outlined text-[var(--assessment-outline)]">history</span>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {props.entries.length ? (
          <div className="relative pl-2">
            <div className="lead-detail-timeline-line" />
            <div>
              {props.entries.map((entry, index) => (
                <div
                  key={entry.id}
                  className={`relative flex gap-4 ${index < props.entries.length - 1 ? 'mb-6' : ''}`}
                >
                  <div
                    className={`z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-4 border-white shadow-sm ${timelineToneClass(entry.tone)}`}
                  >
                    <span
                      className="material-symbols-outlined text-[10px] text-white"
                      style={{ fontVariationSettings: "'FILL' 1" }}
                    >
                      {entry.icon}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface)]">
                        {entry.title}
                      </p>
                      <span className="shrink-0 text-xs text-[var(--assessment-on-surface-variant)]">
                        {formatTimelineDate(entry.at)}
                      </span>
                    </div>
                    <p
                      className={`text-sm text-[var(--assessment-on-surface-variant)] ${entry.italic ? 'italic' : ''}`}
                    >
                      {entry.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">No interactions recorded yet.</p>
        )}
      </div>
    </section>
  );
}

function VerificationPanel(props: {
  lead: RecruitmentLeadDetailLead;
  overlay: RecruitmentLeadOverlay | null;
  skills: string[];
  educationLine: string | null;
  verificationStatus: { label: string; approved: boolean };
  aiBrief: string;
  onQualify: () => void;
  qualifyLoading?: boolean;
}) {
  const { lead, overlay, skills, educationLine, verificationStatus } = props;
  const hasResume = lead.resume_url || lead.document_uploads?.some((d) => (d.document_name ?? '').toLowerCase().includes('resume'));
  const resumeDoc = lead.document_uploads?.find((d) => (d.document_name ?? '').toLowerCase().includes('resume'));
  
  const qualification = overlay?.ai_qualification;
  const course = lead.courses[0]?.course_name ?? 'open roles';
  const verdictText =
    qualification?.summary ??
    props.aiBrief ??
    `${lead.first_name} is under review for the ${course} role.`;
  const skillBars = Math.min(4, Math.max(1, skills.length ? 3 : 1));

  return (
    <section className="lead-detail-panel lead-detail-ai-glow col-span-12 flex flex-col overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] lg:col-span-5 lg:h-[600px]">
      <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4">
        <div className="flex items-center gap-2">
          <h2 className="font-headline-sm text-[var(--assessment-on-surface)]">Verification Hub</h2>
          <span className="material-symbols-outlined text-sm text-[var(--nexus-tertiary)]">auto_awesome</span>
        </div>
        <div
          className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs ${
            verificationStatus.approved
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}
        >
          <span className="material-symbols-outlined text-[14px]">
            {verificationStatus.approved ? 'verified' : 'pending'}
          </span>
          {verificationStatus.label}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-hidden p-4">
        <div className="relative flex-1 overflow-y-auto rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] p-6">
          {skills.length ? (
            <div className="absolute right-4 top-4 max-w-[150px] rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]/80 p-2 shadow-sm backdrop-blur">
              <p className="mb-1 font-mono-data text-[9px] uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                AI Insights
              </p>
              <div className="flex flex-wrap gap-1">
                {skills.slice(0, 8).map((skill) => (
                  <span
                    key={skill}
                    className="rounded bg-[var(--assessment-primary)]/10 px-1 text-[10px] text-[var(--assessment-primary)]"
                  >
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {hasResume ? (
            <div className="space-y-2 pr-36">
              <p className="text-sm font-semibold">{resumeDoc?.document_name ?? 'Resume'}</p>
              {resumeDoc?.document_status ? (
                <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                  Status: {resumeDoc.document_status}
                </p>
              ) : null}
              <a
                href={resumeDoc?.document_url ?? lead.resume_url ?? '#'}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm text-[var(--assessment-primary)] hover:underline"
              >
                <span className="material-symbols-outlined text-[18px]">open_in_new</span>
                Open document
              </a>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center space-y-4 rounded-xl border border-[var(--nexus-tertiary)]/20 bg-[var(--nexus-tertiary)]/5 p-8 text-center">
              <div className="rounded-full bg-[var(--nexus-tertiary)]/10 p-3 text-[var(--nexus-tertiary)]">
                <span className="material-symbols-outlined text-3xl">auto_fix_high</span>
              </div>
              <div>
                <p className="font-headline-sm text-[var(--nexus-tertiary)]">CodeVox AI Verdict</p>
                <p className="max-w-md text-sm text-[var(--assessment-on-surface-variant)]">{verdictText}</p>
              </div>
              <button
                type="button"
                disabled={props.qualifyLoading}
                onClick={props.onQualify}
                className="mt-2 rounded-full bg-[var(--nexus-tertiary)] px-6 py-2 text-sm font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-50"
              >
                {props.qualifyLoading ? 'Running...' : 'Run AI Verification'}
              </button>
            </div>
          )}

          {overlay?.parsed_resume?.summary ? (
            <p className="mt-6 text-sm text-[var(--assessment-on-surface-variant)]">
              {overlay.parsed_resume.summary}
            </p>
          ) : null}

          {educationLine ? (
            <div className="mt-8 rounded-r border-l-4 border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5 py-2 pl-4">
              <p className="mb-1 text-sm font-semibold text-[var(--assessment-primary)]">Education Verified</p>
              <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">{educationLine}</p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2">
          <VerificationRow
            icon="description"
            label="Resume Originality"
            value={
              (lead.duplicate_match_count ?? 0) > 0
                ? `${lead.duplicate_match_count} duplicate flag(s)`
                : '100% Unique'
            }
            valueClass={(lead.duplicate_match_count ?? 0) > 0 ? 'text-amber-700' : 'text-green-600'}
          />
          <div className="flex items-center justify-between rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-2">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-[var(--assessment-primary)]">history_edu</span>
              <span className="text-sm font-medium">Skill Validation</span>
            </div>
            <div className="flex gap-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className={`h-1 w-8 rounded-full ${
                    i < skillBars
                      ? 'bg-[var(--assessment-primary)]'
                      : 'bg-[var(--assessment-outline-variant)]'
                  }`}
                />
              ))}
            </div>
          </div>
          {overlay?.resume_mismatch ? (
            <p className="text-xs font-semibold text-amber-700">
              Resume vs form mismatch flagged - manual review recommended.
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ProfileMatchingPanel(props: {
  matches: Array<{ id: string; name: string; subtitle: string; match: number | null }>;
}) {
  return (
    <section className="flex flex-1 flex-col overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]">
      <div className="border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--assessment-outline)]">
          Profile Matching
        </h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {props.matches.length ? (
          <table className="w-full text-left">
            <thead>
              <tr className="bg-[var(--assessment-surface-container-high)]/30">
                <th className="p-2 font-mono-data text-[11px] text-[var(--assessment-on-surface-variant)]">
                  Job Profile
                </th>
                <th className="p-2 text-right font-mono-data text-[11px] text-[var(--assessment-on-surface-variant)]">
                  Match
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--assessment-outline-variant)]">
              {props.matches.map((row, i) => (
                <tr
                  key={row.id}
                  className={`transition-colors hover:bg-[var(--assessment-primary)]/5 ${i > 0 && (row.match ?? 0) < 50 ? 'opacity-60' : ''}`}
                >
                  <td className="p-2">
                    <p className="text-sm font-semibold">{row.name}</p>
                    <p className="text-[10px] text-[var(--assessment-on-surface-variant)]">{row.subtitle}</p>
                  </td>
                  <td className="p-2 text-right">
                    <span
                      className={`font-mono-data font-bold ${
                        (row.match ?? 0) >= 70
                          ? 'text-[var(--assessment-primary)]'
                          : 'text-[var(--assessment-outline)]'
                      }`}
                    >
                      {row.match != null ? `${Math.round(row.match)}%` : '-'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="p-4 text-sm text-[var(--assessment-on-surface-variant)]">No course profiles linked.</p>
        )}
      </div>
    </section>
  );
}

function ResumeMatchPanel(props: {
  lead: RecruitmentLeadDetailLead;
  overlay: RecruitmentLeadOverlay | null;
  rerunning: boolean;
  onRerun: () => void;
}) {
  const status =
    props.overlay?.resume_match_status ?? props.lead.resume_match_status ?? null;
  const score =
    props.overlay?.resume_match_score ?? props.lead.resume_match_score ?? null;
  const confidence =
    props.overlay?.resume_match_confidence ??
    props.lead.resume_match_confidence ??
    null;
  const error =
    props.overlay?.resume_match_error ?? props.lead.resume_match_error ?? null;
  const result = (props.overlay?.resume_match ?? null) as ResumeMatchResult | null;

  return (
    <section className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--assessment-outline)]">
            Resume Match
          </h2>
          <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
            CV ↔ JD fit (independent of Engagement Score)
          </p>
        </div>
        <button
          type="button"
          disabled={props.rerunning || status === 'PENDING'}
          onClick={props.onRerun}
          className="rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-1.5 text-xs font-semibold text-[var(--assessment-primary)] hover:bg-[var(--assessment-surface-container-low)] disabled:opacity-50"
        >
          {props.rerunning || status === 'PENDING' ? 'Analyzing…' : 'Re-run analysis'}
        </button>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-end gap-6">
          <div>
            <p className="text-xs text-[var(--assessment-on-surface-variant)]">Score</p>
            <p className="font-headline-sm text-[var(--assessment-primary)]">
              {status === 'PENDING'
                ? 'Analyzing…'
                : status === 'COMPLETED' && score != null
                  ? Math.round(score)
                  : status === 'UNAVAILABLE'
                    ? 'Unavailable'
                    : status === 'FAILED'
                      ? 'Failed'
                      : '—'}
            </p>
          </div>
          {confidence != null ? (
            <div>
              <p className="text-xs text-[var(--assessment-on-surface-variant)]">Confidence</p>
              <p className="text-sm font-semibold">{confidence.toFixed(3)}</p>
            </div>
          ) : null}
          {result?.job?.title ? (
            <div>
              <p className="text-xs text-[var(--assessment-on-surface-variant)]">Job</p>
              <p className="text-sm font-semibold">{result.job.title}</p>
            </div>
          ) : null}
        </div>

        {error ? (
          <p className="text-xs text-amber-700">{error}</p>
        ) : null}

        {result?.summary ? (
          <p className="text-sm text-[var(--assessment-on-surface)]">{result.summary}</p>
        ) : null}

        {result?.criticalGaps?.length ? (
          <div>
            <p className="mb-1 text-xs font-semibold uppercase text-amber-800">Critical gaps</p>
            <div className="flex flex-wrap gap-1">
              {result.criticalGaps.map((g) => (
                <span
                  key={g}
                  className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900"
                >
                  {g}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {(result?.strengths?.length || result?.gaps?.length) ? (
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-[var(--assessment-outline)]">
                Strengths
              </p>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {(result?.strengths ?? []).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase text-[var(--assessment-outline)]">
                Gaps
              </p>
              <ul className="list-disc space-y-1 pl-4 text-sm">
                {(result?.gaps ?? []).map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {result?.evaluation?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--assessment-outline-variant)] text-[11px] uppercase text-[var(--assessment-on-surface-variant)]">
                  <th className="p-2">Factor</th>
                  <th className="p-2 text-right">Importance</th>
                  <th className="p-2 text-right">Strength</th>
                  <th className="p-2">Match</th>
                  <th className="p-2">Critical</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--assessment-outline-variant)]">
                {result.evaluation.map((row) => (
                  <tr key={row.factorId}>
                    <td className="p-2">
                      <p className="font-medium">{row.factor}</p>
                      {row.reasoning ? (
                        <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                          {row.reasoning}
                        </p>
                      ) : null}
                    </td>
                    <td className="p-2 text-right font-mono-data">
                      {row.importanceScore?.toFixed(3)}
                    </td>
                    <td className="p-2 text-right font-mono-data">
                      {row.evidenceAvailable ? row.matchStrength?.toFixed(3) : '—'}
                    </td>
                    <td className="p-2 text-xs font-semibold">{row.match}</td>
                    <td className="p-2 text-xs">{row.critical ? 'Yes' : 'No'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function CommsPanel(props: { communications: RecruitmentCommunicationItem[] }) {
  const items = props.communications.slice(0, 4);
  const channels = new Set(props.communications.map((c) => (c.channel ?? '').toLowerCase()));

  return (
    <section className="flex h-1/2 min-h-[220px] flex-col overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]">
      <div className="flex items-center justify-between border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--assessment-outline)]">
          Last Comms
        </h2>
        <div className="flex gap-1">
          {channels.has('whatsapp') || props.communications.length > 0 ? (
            <span className="material-symbols-outlined text-sm text-green-600">forum</span>
          ) : null}
          {channels.has('call') || channels.has('phone') ? (
            <span className="material-symbols-outlined text-sm text-[var(--assessment-primary)]">call</span>
          ) : null}
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {items.length ? (
          items.map((item, i) => {
            const outbound = (item.direction ?? 'outbound').toLowerCase() === 'outbound';
            const body = item.body ?? item.subject ?? '-';
            const sentAt = item.sent_at ?? item.sentAt;
            return (
              <div
                key={item.id ?? i}
                className={`flex flex-col ${outbound ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] rounded-xl p-2 text-[11px] ${
                    outbound
                      ? 'rounded-tr-none bg-[var(--assessment-primary)] text-white'
                      : 'rounded-tl-none bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface)]'
                  }`}
                >
                  {body}
                </div>
                <span className="mt-1 text-[9px] text-[var(--assessment-on-surface-variant)]">
                  {outbound ? 'Sent' : 'Received'} {sentAt ? formatRelativeTime(sentAt) : ''}
                </span>
              </div>
            );
          })
        ) : (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">No communications logged yet.</p>
        )}
      </div>
      <div className="border-t border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-2">
        <button
          type="button"
          className="w-full py-1 text-center text-[11px] font-semibold text-[var(--assessment-primary)] hover:underline"
        >
          View Full Thread
        </button>
      </div>
    </section>
  );
}


function InterviewHistorySection(props: { data: RecruitmentLeadDetail; embedded?: boolean }) {
  const { data } = props;
  return (
    <div className={props.embedded ? '' : 'rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4'}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--assessment-outline)]">
        Interview history
      </h2>
      <div className="space-y-2 text-sm">
        {data.interviews.map((i) => (
          <Link
            key={String(i.interview_ref_id)}
            href={`/assessments/recruitment/interviews/${i.interview_ref_id}`}
            className="block rounded-lg border border-[var(--assessment-outline-variant)] p-3 hover:bg-[var(--assessment-surface-container-low)]"
          >
            {i.interview_type} | {i.appointment_date} {i.appointment_time} | {i.effective_status}
          </Link>
        ))}
        {data.interviews_local.map((i) => (
          <div
            key={String(i.overlay_id)}
            className="rounded-lg border border-dashed border-[var(--assessment-outline-variant)] p-3"
          >
            Local (pending sync): {i.interview_type} | {i.appointment_date} {i.appointment_time}
          </div>
        ))}
        {data.autonomous_sessions.map((s) => (
          <a
            key={String(s.candidate_token)}
            href={String(s.interview_url)}
            target="_blank"
            rel="noreferrer"
            className="block rounded-lg border border-[var(--assessment-primary)]/30 p-3 text-[var(--assessment-primary)]"
          >
            AI interview session | {s.status}
          </a>
        ))}
      </div>
    </div>
  );
}

type ScheduleForm = {
  appointment_date: string;
  appointment_time: string;
  interview_type: string;
  interview_mode: string;
  remarks_desc: string;
  meeting_url: string;
};

function ScheduleModal(props: {
  form: ScheduleForm;
  onChange: (form: ScheduleForm) => void;
  onClose: () => void;
  onSave: () => void;
  saving?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-xl">
        <h2 className="text-lg font-semibold">Schedule interview</h2>
        <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
          Saved locally
        </p>
        <div className="mt-4 space-y-3">
          {(
            [
              'appointment_date',
              'appointment_time',
              'interview_type',
              'interview_mode',
              'remarks_desc',
              'meeting_url',
            ] as const
          ).map((field) => (
            <label key={field} className="block text-sm">
              <span className="mb-1 block font-medium capitalize">{field.replace(/_/g, ' ')}</span>
              <input
                className="w-full rounded border border-[var(--assessment-outline-variant)] px-3 py-2"
                value={props.form[field]}
                onChange={(e) => props.onChange({ ...props.form, [field]: e.target.value })}
              />
            </label>
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="rounded border px-4 py-2 text-sm" onClick={props.onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-[var(--assessment-primary)] px-4 py-2 text-sm text-white"
            disabled={props.saving}
            onClick={props.onSave}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Chip(props: { label: string }) {
  return (
    <span className="rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-high)] px-2 py-0.5 font-mono-data text-[11px]">
      {props.label}
    </span>
  );
}

function VerificationRow(props: {
  icon: string;
  label: string;
  value: string;
  valueClass?: string;
}) {
  return (
    <div className="flex items-center justify-between rounded border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-2">
      <div className="flex items-center gap-2">
        <span className="material-symbols-outlined text-[var(--assessment-primary)]">{props.icon}</span>
        <span className="text-sm font-medium">{props.label}</span>
      </div>
      <span className={`text-sm font-bold ${props.valueClass ?? ''}`}>{props.value}</span>
    </div>
  );
}

function buildTimeline(data: RecruitmentLeadDetail): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const lead = data.lead;

  if (lead.created_at) {
    entries.push({
      id: 'created',
      title: 'Lead Ingested',
      detail: `Received from ${lead.lead_source ?? lead.lead_sub_source ?? 'source'}. Stage: ${lead.lead_stage ?? 'New'}.`,
      at: lead.created_at,
      icon: 'api',
      tone: 'primary',
    });
  }

  for (const item of data.timeline ?? []) {
    const type = (item.event_type ?? item.eventType ?? '').toLowerCase();
    entries.push({
      id: item.id ?? `${type}-${item.occurred_at ?? item.occurredAt}`,
      title: humanizeEventType(type) || (item.event_summary ?? item.eventSummary ?? 'Activity'),
      detail: item.event_summary ?? item.eventSummary ?? '-',
      at: item.occurred_at ?? item.occurredAt ?? new Date().toISOString(),
      icon: timelineIconForType(type),
      tone: timelineToneForType(type),
    });
  }

  if (data.overlay?.parsed_resume) {
    entries.push({
      id: 'parse',
      title: 'AI Document Parse',
      detail: data.overlay.parsed_resume.summary ?? 'CV scanned and skills extracted.',
      at: data.overlay.last_local_action_at ?? lead.created_at ?? new Date().toISOString(),
      icon: 'psychology',
      tone: 'tertiary',
    });
  }

  for (const interview of data.interviews) {
    entries.push({
      id: `int-${interview.interview_ref_id}`,
      title: interview.interview_type ?? 'Interview',
      detail: `${interview.appointment_date ?? ''} ${interview.appointment_time ?? ''} | ${interview.effective_status ?? interview.interview_status ?? 'Scheduled'}`.trim(),
      at: interview.appointment_date ?? lead.created_at ?? new Date().toISOString(),
      icon: 'phone_callback',
      tone: 'success',
    });
  }

  for (const comm of data.communications ?? []) {
    entries.push({
      id: `comm-${comm.id ?? comm.sent_at ?? comm.sentAt}`,
      title: `${comm.channel ?? 'Message'} ${(comm.direction ?? 'outbound') === 'outbound' ? 'Outreach' : 'Reply'}`,
      detail: comm.body ?? comm.subject ?? '-',
      at: comm.sent_at ?? comm.sentAt ?? new Date().toISOString(),
      icon: 'chat',
      tone: 'secondary',
      italic: Boolean(comm.body),
    });
  }

  return entries
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 20);
}

function buildCourseMatches(
  lead: RecruitmentLeadDetailLead,
  overlay: RecruitmentLeadOverlay | null,
  score: number | null,
) {
  const base = overlay?.ai_qualification?.score ?? score;
  return (lead.courses ?? []).map((course, index) => {
    const match =
      base != null ? Math.max(0, Math.min(100, Math.round(base - index * 8))) : null;
    const exp =
      lead.experience_years != null ? `${lead.experience_years} yr` : 'Experience n/a';
    return {
      id: course.course_id ?? course.course_name ?? String(index),
      name: course.course_name ?? 'Course',
      subtitle: `${exp}${lead.priority ? ` | ${lead.priority} priority` : ''}`,
      match,
    };
  });
}

function extractSkills(lead: RecruitmentLeadDetailLead, overlay: RecruitmentLeadOverlay | null) {
  const fromParse = overlay?.parsed_resume?.skills ?? [];
  if (fromParse.length) return fromParse.map(String);

  const fromAnswers = Object.values(lead.leads_answers ?? {}).filter((v) =>
    /[a-z]/i.test(v) && v.length <= 40,
  );
  const tech = fromAnswers.filter((v) =>
    /php|java|react|node|aws|laravel|sql|python|angular|vue/i.test(v),
  );
  return [...new Set(tech)].slice(0, 8);
}

function formatEducation(lead: RecruitmentLeadDetailLead, overlay: RecruitmentLeadOverlay | null) {
  const edu = overlay?.parsed_resume?.education ?? lead.educational_details;
  if (!edu) return null;
  if (typeof edu === 'string') return edu;
  if (Array.isArray(edu) && edu.length) {
    const first = edu[0];
    if (typeof first === 'string') return first;
    if (first && typeof first === 'object') {
      const row = first as Record<string, unknown>;
      const parts = [
        row.degree ?? row.qualification,
        row.institution ?? row.college ?? row.university,
        row.year ?? row.passing_year,
      ].filter(Boolean);
      if (parts.length) return parts.join(', ');
    }
    return JSON.stringify(first);
  }
  return null;
}

function resolveVerificationStatus(
  lead: RecruitmentLeadDetailLead,
  overlay: RecruitmentLeadOverlay | null,
) {
  if (lead.verified_lead === 1 && !overlay?.resume_mismatch) {
    return { label: 'Approved', approved: true };
  }
  if ((lead.duplicate_match_count ?? 0) > 0 || overlay?.resume_mismatch) {
    return { label: 'Review needed', approved: false };
  }
  if (lead.form_completed === 1) {
    return { label: 'Form complete', approved: true };
  }
  return { label: 'Pending', approved: false };
}

function engagementLabel(score: number | null) {
  if (score == null) return { label: 'Unscored' };
  if (score >= 80) return { label: 'Hot' };
  if (score >= 60) return { label: 'Warm' };
  return { label: 'Cold' };
}

function shortId(id: string) {
  return id.length > 8 ? id.slice(0, 8).toUpperCase() : id.toUpperCase();
}

function humanizeEventType(type: string) {
  if (!type) return '';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function timelineIconForType(type: string) {
  if (type.includes('parse') || type.includes('resume') || type.includes('ai')) return 'psychology';
  if (type.includes('comm') || type.includes('whatsapp') || type.includes('message')) return 'chat';
  if (type.includes('interview') || type.includes('call')) return 'phone_callback';
  return 'api';
}

function timelineToneForType(type: string): TimelineEntry['tone'] {
  if (type.includes('interview') || type.includes('call')) return 'success';
  if (type.includes('parse') || type.includes('ai')) return 'tertiary';
  if (type.includes('comm')) return 'secondary';
  return 'primary';
}

function timelineToneClass(tone: TimelineEntry['tone']) {
  switch (tone) {
    case 'tertiary':
      return 'bg-[var(--nexus-tertiary)]';
    case 'secondary':
      return 'bg-[var(--recruitment-secondary)]';
    case 'success':
      return 'bg-green-600';
    default:
      return 'bg-[var(--assessment-primary)]';
  }
}

function formatTimelineDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatRelativeTime(value: string) {
  let dateStr = value;
  if (!dateStr.includes('Z') && !/\+\d{2}(:\d{2})?/.test(dateStr) && !/-\d{2}(:\d{2})?/.test(dateStr)) {
    dateStr = dateStr.replace(' ', 'T');
    if (!dateStr.endsWith('Z')) {
      dateStr += 'Z';
    }
  }
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  const diff = Date.now() - d.getTime();
  const hours = Math.floor(diff / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'yesterday';
  return `${days}d ago`;
}
