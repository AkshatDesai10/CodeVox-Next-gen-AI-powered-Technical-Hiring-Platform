'use client';

import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { rescoreProjectInterviewCode } from '@/modules/recruitment/lib/recruitment-api';
import type {
  AssessmentStageReport,
  TakeHomeStageReport,
  VerbalStageReport,
  AiScreeningStageReport,
  ProjectInterviewReportSummary,
} from '../../types/assessment-report';
import { formatDuration, formatPct, scoreBarColor } from '../../utils/format';
import { AiEvaluationSynthesisCard, RawAiPayloadPanel } from '../AiEvaluationCard';
import { AiScreeningSummaryPanel } from '@/modules/autonomous-interview/components/report/AiScreeningSummaryPanel';
import { BehaviouralHrReport } from '@/modules/autonomous-interview/components/report/BehaviouralHrReport';
import { CandidateSessionRecordingPanel } from '@/modules/autonomous-interview/components/report/CandidateSessionRecordingPanel';
import type { HrVoiceAudit } from '@/modules/autonomous-interview/types/interview-report';

const RESCORE_POLL_MS = 3000;
const RESCORE_POLL_MAX_MS = 3 * 60 * 1000;

function isTakeHome(stage: AssessmentStageReport): stage is TakeHomeStageReport {
  return stage.stageType === 'take_home';
}

function isVerbal(stage: AssessmentStageReport): stage is VerbalStageReport {
  return (
    stage.stageType === 'screening' ||
    stage.stageType === 'ai_verbal' ||
    stage.stageType === 'hr_verbal' ||
    stage.stageType === 'project_interview'
  );
}

function subpartStatusClass(status: string): string {
  const base = 'rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide';
  if (status === 'present') return `${base} border-emerald-200 bg-emerald-50 text-emerald-800`;
  if (status === 'partial') return `${base} border-amber-200 bg-amber-50 text-amber-800`;
  if (status === 'missing' || status === 'unseen') return `${base} border-red-200 bg-red-50 text-red-700`;
  return `${base} border-slate-200 bg-slate-50 text-slate-600`;
}

function ProjectSubmissionCard({
  project,
  applicationId,
}: {
  project: ProjectInterviewReportSummary;
  applicationId?: string;
}) {
  const queryClient = useQueryClient();
  const scores = project.project_profile?.evaluation_scores;
  const checklist = scores?.checklist_results ?? [];
  const codeScore = project.code_build_score_pct ?? scores?.requirements_score_pct ?? null;
  const verbalScore = project.verbal_defend_score_pct ?? null;
  const finalScore = project.final_combined_score_pct ?? null;
  const twistNote = scores?.twist_evidence || scores?.twist_reason;
  const [rescoreOpen, setRescoreOpen] = useState(false);
  const [rescoreUrl, setRescoreUrl] = useState(project.github_url ?? '');
  const [rescoreBranch, setRescoreBranch] = useState(project.github_branch ?? '');
  const [rescoreBusy, setRescoreBusy] = useState(false);
  const [rescoring, setRescoring] = useState(false);
  const [rescoreMsg, setRescoreMsg] = useState<string | null>(null);
  const [rescoreErr, setRescoreErr] = useState<string | null>(null);
  const baselineRef = useRef<{
    evaluatedAt: string | null;
    codeScore: number | null;
    githubUrl: string | null;
  } | null>(null);

  useEffect(() => {
    if (!rescoreOpen) {
      setRescoreUrl(project.github_url ?? '');
      setRescoreBranch(project.github_branch ?? '');
    }
  }, [project.github_url, project.github_branch, rescoreOpen]);

  // After re-score starts, poll the report until evaluated_at / code score updates.
  useEffect(() => {
    if (!rescoring || !applicationId) return;
    const startedAt = Date.now();
    const tick = () => {
      void queryClient.invalidateQueries({ queryKey: ['assessment-report', applicationId] });
    };
    tick();
    const id = window.setInterval(() => {
      if (Date.now() - startedAt > RESCORE_POLL_MAX_MS) {
        setRescoring(false);
        setRescoreMsg('Re-score is taking longer than usual â€” refresh if scores look stale.');
        window.clearInterval(id);
        return;
      }
      tick();
    }, RESCORE_POLL_MS);
    return () => window.clearInterval(id);
  }, [rescoring, applicationId, queryClient]);

  useEffect(() => {
    if (!rescoring || !baselineRef.current) return;
    const base = baselineRef.current;
    const evaluatedChanged =
      Boolean(project.evaluated_at) && project.evaluated_at !== base.evaluatedAt;
    const scoreChanged =
      codeScore != null && base.codeScore != null
        ? codeScore !== base.codeScore
        : codeScore != null && base.codeScore == null;
    const urlChanged =
      Boolean(project.github_url) &&
      project.github_url !== base.githubUrl &&
      Boolean(project.evaluated_at) &&
      project.evaluated_at !== base.evaluatedAt;
    if (evaluatedChanged || scoreChanged || urlChanged) {
      setRescoring(false);
      baselineRef.current = null;
      setRescoreMsg('Code re-score complete. Scores updated.');
    }
  }, [
    rescoring,
    project.evaluated_at,
    project.github_url,
    codeScore,
  ]);

  const onRescore = async () => {
    if (!project.submission_id || rescoreBusy || rescoring) return;
    setRescoreBusy(true);
    setRescoreErr(null);
    setRescoreMsg(null);
    try {
      const result = await rescoreProjectInterviewCode(project.submission_id, {
        github_url: rescoreUrl.trim() || undefined,
        github_branch: rescoreBranch.trim() || undefined,
      });
      baselineRef.current = {
        evaluatedAt: project.evaluated_at ?? null,
        codeScore,
        githubUrl: project.github_url ?? null,
      };
      setRescoreOpen(false);
      setRescoring(true);
      setRescoreMsg(result.message || 'Re-scoring codeâ€¦ scores will update automatically.');
    } catch (err) {
      setRescoreErr(err instanceof Error ? err.message : 'Re-score failed');
    } finally {
      setRescoreBusy(false);
    }
  };

  return (
    <div className="assessment-card space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Project Submission</h2>
        <div className="flex flex-wrap items-center gap-2">
          {rescoring ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-sky-500/15 px-2.5 py-1 text-[11px] font-bold text-sky-900 ring-1 ring-sky-500/25">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-500" />
              Re-scoring codeâ€¦
            </span>
          ) : null}
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-semibold uppercase text-slate-600">
            {project.status.replace(/_/g, ' ')}
          </span>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Code build</div>
          <div className="text-xl font-bold text-[var(--assessment-primary)]">{formatPct(codeScore)}</div>
          {project.scoring_weights ? (
            <div className="text-[11px] text-slate-500">{project.scoring_weights.code_submission}% weight</div>
          ) : null}
        </div>
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Verbal defend</div>
          <div className="text-xl font-bold text-[var(--nexus-secondary)]">{formatPct(verbalScore)}</div>
          {project.scoring_weights ? (
            <div className="text-[11px] text-slate-500">
              {project.scoring_weights.interview_performance}% weight
            </div>
          ) : null}
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-800">Final combined</div>
          <div className="text-xl font-bold text-emerald-900">{formatPct(finalScore)}</div>
        </div>
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          Project: <b>{project.project_title ?? 'Not selected'}</b>
        </div>
        <div>
          Requirements met: <b>{formatPct(scores?.requirements_score_pct ?? null)}</b>
        </div>
        {project.duration_minutes != null ? (
          <div>
            Time taken: <b>{formatDuration(project.duration_minutes)}</b>
            {project.build_duration_minutes != null || project.defend_duration_minutes != null ? (
              <span className="text-xs text-slate-500 font-normal">
                {' '}(Build: {formatDuration(project.build_duration_minutes)} Â· Defend: {formatDuration(project.defend_duration_minutes)})
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="sm:col-span-2 space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 text-sm">
              {project.submission_type === 'excel_or_pdf' ||
              project.submission_type === 'zip_upload' ||
              project.submission_file_url ? (
                <>
                  <span className="text-[var(--assessment-on-surface-variant)]">
                    {project.submission_type === 'excel_or_pdf'
                      ? 'Submitted workbook: '
                      : project.submission_type === 'zip_upload'
                        ? 'Submitted zip: '
                        : 'Submitted file: '}
                  </span>
                  {project.submission_file_url ? (
                    <a
                      href={project.submission_file_url}
                      target="_blank"
                      rel="noreferrer"
                      download={project.submission_file_name ?? undefined}
                      className="inline-flex items-center gap-1.5 break-all font-semibold text-[var(--assessment-primary)] hover:underline"
                    >
                      <AssessmentMaterialIcon name="download" size={16} />
                      {project.submission_file_name ?? 'Download submission'}
                      {project.submission_file_format
                        ? ` (.${project.submission_file_format})`
                        : ''}
                    </a>
                  ) : (
                    <b>Not submitted</b>
                  )}
                </>
              ) : (
                <>
                  <span className="text-[var(--assessment-on-surface-variant)]">Repository: </span>
                  {project.github_url ? (
                    <a
                      href={project.github_url}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all font-semibold text-[var(--assessment-primary)] hover:underline"
                    >
                      {project.github_url}
                      {project.github_branch ? ` @ ${project.github_branch}` : ''}
                    </a>
                  ) : (
                    <b>Not submitted</b>
                  )}
                </>
              )}
            </div>
            {project.submission_id &&
            (project.submission_type === 'github_url' ||
              (!project.submission_type && !project.submission_file_url)) ? (
              <button
                type="button"
                disabled={rescoring}
                onClick={() => {
                  setRescoreOpen((v) => !v);
                  setRescoreErr(null);
                  setRescoreMsg(null);
                }}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[var(--assessment-primary)] px-3 py-2 text-xs font-bold text-white shadow-sm transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <AssessmentMaterialIcon name="sync" size={14} />
                {rescoreOpen ? 'Close' : 'Update Repo & Re-Score'}
              </button>
            ) : null}
          </div>
          {rescoreOpen ? (
            <div className="space-y-3 rounded-xl border border-[var(--assessment-primary)]/20 bg-[var(--assessment-primary)]/[0.04] p-3.5">
              <p className="text-xs leading-5 text-[var(--assessment-on-surface-variant)]">
                Re-runs code grading only. Locked defense questions and verbal score stay unchanged.
                Scores refresh automatically when grading finishes.
              </p>
              <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                <input
                  type="url"
                  value={rescoreUrl}
                  onChange={(e) => setRescoreUrl(e.target.value)}
                  placeholder="https://github.com/owner/repo"
                  className="w-full rounded-lg border border-slate-200 bg-[var(--assessment-surface-container)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/25"
                />
                <input
                  type="text"
                  value={rescoreBranch}
                  onChange={(e) => setRescoreBranch(e.target.value)}
                  placeholder="Branch"
                  className="w-full rounded-lg border border-slate-200 bg-[var(--assessment-surface-container)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/25 sm:w-36"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={rescoreBusy || rescoring || !rescoreUrl.trim()}
                  onClick={() => void onRescore()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--assessment-primary)] px-3.5 py-2 text-xs font-bold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
                >
                  <AssessmentMaterialIcon name={rescoreBusy ? 'hourglass_top' : 'play_arrow'} size={14} />
                  {rescoreBusy ? 'Startingâ€¦' : 'Start Re-Score'}
                </button>
                <button
                  type="button"
                  onClick={() => setRescoreOpen(false)}
                  className="rounded-lg border border-slate-200 bg-[var(--assessment-surface-container)] px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
              {rescoreErr ? <p className="text-xs text-red-600">{rescoreErr}</p> : null}
            </div>
          ) : null}
          {rescoreMsg ? (
            <p
              className={`text-xs font-medium ${
                rescoring ? 'text-sky-800' : 'text-emerald-700'
              }`}
            >
              {rescoreMsg}
            </p>
          ) : null}
        </div>
      </div>
      {project.project_profile?.tech_stack_summary ? (
        <p className="text-sm text-[var(--assessment-on-surface-variant)]">
          <span className="font-semibold text-[var(--assessment-on-surface)]">Tech stack: </span>
          {project.project_profile.tech_stack_summary}
        </p>
      ) : null}
      {scores?.task_evaluations?.length ? (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            Task scores
          </div>
          <div className="space-y-3">
            {scores.task_evaluations.map((task) => (
              <div key={task.task_id} className="overflow-hidden rounded-lg border border-slate-200">
                <div className="flex items-center justify-between gap-3 bg-slate-50 px-3 py-2">
                  <span className="text-sm font-semibold text-[var(--assessment-on-surface)]">{task.task_id}</span>
                  <span className="font-mono text-sm font-bold text-[var(--assessment-on-surface)]">
                    {task.score}/{task.max_marks}
                  </span>
                </div>
                {task.subparts?.length ? (
                  <ul className="divide-y divide-slate-100">
                    {task.subparts.map((part) => (
                      <li key={part.name} className="px-3 py-2.5">
                        <div className="flex items-start justify-between gap-3">
                          <p className="text-sm font-medium text-[var(--assessment-on-surface)]">{part.name}</p>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-mono text-xs text-slate-600">
                              {part.awarded}/{part.marks}
                            </span>
                            <span className={subpartStatusClass(part.status)}>{part.status}</span>
                          </div>
                        </div>
                        {part.gap ? <p className="mt-1 text-xs leading-5 text-slate-500">{part.gap}</p> : null}
                      </li>
                    ))}
                  </ul>
                ) : task.feedback ? (
                  <p className="px-3 py-2.5 text-xs leading-5 text-slate-500">{task.feedback}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {project.project_profile?.app_summary ? (
        <p className="text-sm text-[var(--assessment-on-surface-variant)]">{project.project_profile.app_summary}</p>
      ) : null}
      {scores?.twist_requirement_met != null ? (
        <div
          className={`rounded-lg border px-3 py-2 text-sm ${scores.twist_requirement_met
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
              : 'border-red-200 bg-red-50 text-red-900'
            }`}
        >
          <b>Twist {scores.twist_requirement_met ? 'met' : 'not met'}.</b> {twistNote}
        </div>
      ) : null}
      {checklist.length ? (
        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            Must-have checklist
          </div>
          <ul className="space-y-1 text-sm">
            {checklist.map((r) => (
              <li key={r.id} className="flex gap-3 border-b border-slate-100 py-1.5">
                <span
                  className={
                    r.passed === true ? 'text-emerald-600' : r.passed === false ? 'text-red-600' : 'text-slate-400'
                  }
                >
                  {r.passed === true ? 'âœ“' : r.passed === false ? 'âœ—' : 'â€¢'}
                </span>
                <span className="flex-1">
                  <span className="font-medium">
                    {r.text || r.id}
                    {r.score_pct != null ? (
                      <span className="ml-2 font-mono text-xs text-[var(--assessment-on-surface-variant)]">
                        ({Math.round(r.score_pct)}%)
                      </span>
                    ) : null}
                  </span>
                  {r.evidence ? (
                    <span className="block text-xs text-[var(--assessment-on-surface-variant)]">
                      Evidence: {r.evidence}
                    </span>
                  ) : null}
                  {r.reason ? (
                    <span className="block text-xs text-[var(--assessment-on-surface-variant)]">{r.reason}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {project.project_profile?.generated_by === 'heuristic' &&
      project.submission_type !== 'excel_or_pdf' ? (
        <p className="text-xs text-amber-700">
          Code analysis ran in fallback mode (LLM unavailable); checklist items were not auto-graded.
        </p>
      ) : null}
    </div>
  );
}

function isAiScreening(stage: AssessmentStageReport): stage is AiScreeningStageReport {
  return stage.stageType === 'ai_screening';
}

function CandidateEndedBanner() {
  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-4">
      <h4 className="text-sm font-bold text-amber-950">Interview ended early by candidate</h4>
      <p className="mt-1 text-xs text-amber-900">
        The candidate chose to end the interview before all questions were completed.
      </p>
    </div>
  );
}

export function AiScreeningStagePanel(props: { stage: AiScreeningStageReport }) {
  const s = props.stage;
  return (
    <div className="space-y-4">
      {s.endedByCandidate ? <CandidateEndedBanner /> : null}
      <AiScreeningSummaryPanel
        analyzerStatus={s.analyzerStatus}
        checks={s.checks}
        conversationState={s.conversationState}
        title={s.label || 'AI Screening'}
      />
      {s.recordingUrl || s.interviewReportPath || (s.recordings && s.recordings.length > 0) ? (
        <div className="space-y-2">
          {s.recordingUrl || (s.recordings && s.recordings.length > 0) ? (
            <CandidateSessionRecordingPanel
              recordingUrl={s.recordingUrl}
              recordings={s.recordings}
              sessionId={s.stageId}
            />
          ) : null}
          {s.interviewReportPath ? (
            <Link
              href={s.interviewReportPath}
              className="inline-block text-sm font-semibold text-[var(--assessment-primary)] hover:underline"
            >
              View full interview report
            </Link>
          ) : null}
        </div>
      ) : null}
      <RawAiPayloadPanel payload={s.rawAiPayload} />
    </div>
  );
}

export function TakeHomeStagePanel(props: { stage: TakeHomeStageReport }) {
  const s = props.stage;
  return (
    <div className="space-y-4">
      <div className="assessment-card space-y-3 p-5">
        <h3 className="text-base font-bold text-[var(--assessment-on-surface)]">Submission</h3>
        {s.artifacts.githubUrl ? (
          <a
            href={s.artifacts.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-semibold text-[var(--assessment-primary)] hover:underline"
          >
            {s.artifacts.githubUrl}
          </a>
        ) : (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            Artifact: {s.artifacts.type ?? 'Not submitted'}
          </p>
        )}
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            Plagiarism:{' '}
            <b>
              {s.plagiarismScore != null ? `${Math.round(s.plagiarismScore * 100) / 100}` : 'â€”'}
            </b>
          </div>
          <div>
            AI probability:{' '}
            <b>{s.aiProbability != null ? `${Math.round(s.aiProbability * 100) / 100}` : 'â€”'}</b>
          </div>
          <div>
            Score: <b>{formatPct(s.scorePct)}</b>
          </div>
        </div>
        {s.rubric.length ? (
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
              Rubric breakdown
            </div>
            <ul className="space-y-1 text-sm">
              {s.rubric.map((r) => (
                <li key={r.id} className="flex justify-between gap-4 border-b border-slate-100 py-1.5">
                  <span>
                    {r.passed === true ? 'âœ“' : r.passed === false ? 'âœ—' : 'â€¢'} {r.label}
                  </span>
                  <span className="text-[var(--assessment-on-surface-variant)]">
                    {r.score != null
                      ? `${r.score}${r.max != null ? `/${r.max}` : ''}`
                      : r.passed != null
                        ? r.passed
                          ? 'Pass'
                          : 'Fail'
                        : 'â€”'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <AiEvaluationSynthesisCard evaluation={s.aiEvaluation} title="AI Evaluation Synthesis â€” Take-home" />
      <RawAiPayloadPanel payload={s.rawAiPayload} />
    </div>
  );
}

export function VerbalStagePanel(props: { stage: VerbalStageReport; applicationId?: string }) {
  const s = props.stage;
  const isHr = s.stageType === 'hr_verbal';
  const isProjectInterview = s.stageType === 'project_interview';
  const disq = s.integrityDisqualification;

  return (
    <div className="space-y-4">
      {s.endedByCandidate ? <CandidateEndedBanner /> : null}
      {disq?.disqualified ? (
        <div className="rounded-xl border-2 border-red-500 bg-red-50 p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-red-600 text-white">
              <AssessmentMaterialIcon name="gavel" size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-bold text-red-950">
                  {isProjectInterview
                    ? 'Defend Interview Disqualified â€” Proctoring Violation'
                    : 'Interview Disqualified â€” Proctoring Violation'}
                </h4>
                <span className="rounded-full bg-red-200 px-2 py-0.5 text-[10px] font-bold uppercase text-red-900">
                  Disqualified
                </span>
              </div>
              <p className="mt-1 text-xs text-red-800">
                {disq.details ||
                  'The interview session was closed after excessive camera or microphone interruptions.'}
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold text-red-700">
                {disq.fraudRiskScore != null ? (
                  <span>Fraud risk: {disq.fraudRiskScore}/100</span>
                ) : null}
                {disq.criticalCount != null && disq.criticalCount > 0 ? (
                  <>
                    <span>Â·</span>
                    <span>{disq.criticalCount} critical violation(s)</span>
                  </>
                ) : null}
                {disq.eventTime ? (
                  <>
                    <span>Â·</span>
                    <span>
                      Violation time:{' '}
                      {new Date(disq.eventTime).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </>
                ) : null}
              </div>
              {s.interviewReportPath ? (
                <div className="mt-3">
                  <Link
                    href={s.interviewReportPath}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700"
                  >
                    Open {isProjectInterview ? 'defend interview' : 'interview'} report & audit log
                    <AssessmentMaterialIcon name="arrow_forward" size={14} />
                  </Link>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {s.project ? (
        <ProjectSubmissionCard project={s.project} applicationId={props.applicationId} />
      ) : null}

      <div className="assessment-card space-y-4 p-5">
        <h3 className="text-base font-bold text-[var(--assessment-on-surface)]">Competency breakdown</h3>
        {s.scorePct == null && isHr ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Behavioural score is missing because the HR audit was not saved for this session.
            Re-run the behaviour round so the final report posts <code>hr_voice_audit</code>.
          </p>
        ) : null}
        <div className="space-y-3">
          {s.competencies.map((c) => (
            <div key={c.key}>
              <div className="mb-1 flex justify-between text-sm">
                <span className="font-medium">{c.label}</span>
                <span className="font-semibold tabular-nums">{formatPct(c.scorePct)}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full ${scoreBarColor(c.scorePct)}`}
                  style={{ width: `${Math.min(100, Math.max(0, c.scorePct ?? 0))}%` }}
                />
              </div>
              {c.note && (
                <p className="mt-1.5 text-xs text-[var(--assessment-on-surface-variant)] leading-relaxed">
                  {c.note}
                </p>
              )}
              {(c.timeSpent != null || c.turnCount != null) && (
                <div className="mt-1 flex gap-3 text-[11px] text-[var(--assessment-on-surface-variant)] font-medium">
                  {c.timeSpent != null && <span>â±ï¸ {Math.round(c.timeSpent / 60)} min spent</span>}
                  {c.turnCount != null && <span>ðŸ—£ï¸ {c.turnCount} interactions</span>}
                </div>
              )}
            </div>
          ))}
        </div>
        {s.interviewReportPath ? (
          <Link
            href={s.interviewReportPath}
            className="inline-block text-sm font-semibold text-[var(--assessment-primary)] hover:underline"
          >
            View full interview report
          </Link>
        ) : null}
      </div>

      {s.recordingUrl || (s.recordings && s.recordings.length > 0) ? (
        <CandidateSessionRecordingPanel
          recordingUrl={s.recordingUrl}
          recordings={s.recordings}
          sessionId={s.stageId}
        />
      ) : null}

      {isHr && s.hrVoiceAudit ? (
        <BehaviouralHrReport audit={s.hrVoiceAudit as HrVoiceAudit} variant="assessment" />
      ) : null}

      <AiEvaluationSynthesisCard evaluation={s.aiEvaluation} title="AI Evaluation Synthesis â€” Verbal" />
      <RawAiPayloadPanel payload={s.rawAiPayload} />
    </div>
  );
}
