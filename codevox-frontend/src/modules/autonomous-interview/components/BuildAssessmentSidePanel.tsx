'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { withBasePath } from '@/lib/with-base-path';
import { ProjectAssessmentDownloads } from '@/modules/assessments/components/ProjectAssessmentDownloads';
import { SubmissionEvaluationProgress } from '@/modules/assessments/components/SubmissionEvaluationProgress';
import {
  getProjectInterviewSubmission,
  submitProjectInterviewRepo,
  submitProjectInterviewZip,
  type CandidateProjectChoice,
} from '@/modules/assessments/lib/project-interview-api';
import { useInterviewRoom } from '@/modules/autonomous-interview/context/InterviewRoomContext';
import { releaseInterviewLeaveGuard } from '@/modules/autonomous-interview/lib/interview-leave-guard';

const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?(\.git)?$/;

function DeadlineCountdown({ dueAt }: { dueAt: string }) {
  const [remaining, setRemaining] = useState('');
  useEffect(() => {
    const tick = () => {
      const ms = new Date(dueAt).getTime() - Date.now();
      if (ms <= 0) {
        setRemaining('Expired');
        return;
      }
      const h = Math.floor(ms / 3600000);
      const m = Math.floor((ms % 3600000) / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      setRemaining(`${h}h ${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [dueAt]);
  return <span className="font-mono tabular-nums">{remaining}</span>;
}

type Props = {
  lookupToken: string;
};

export function BuildAssessmentSidePanel({ lookupToken }: Props) {
  const qc = useQueryClient();
  const queryKey = ['project-interview-build-panel', lookupToken];
  const query = useQuery({
    queryKey,
    queryFn: () => getProjectInterviewSubmission(lookupToken),
    refetchInterval: (q) => {
      const status = q.state.data?.status;
      if (status === 'evaluating_code') return 2500;
      if (status === 'ready_for_interview') return 2000;
      return false;
    },
  });

  const [githubUrl, setGithubUrl] = useState('');
  const [githubBranch, setGithubBranch] = useState('');
  const [zipFile, setZipFile] = useState<File | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (query.data?.github_url) setGithubUrl(query.data.github_url);
    if (query.data?.github_branch) setGithubBranch(query.data.github_branch);
  }, [query.data?.github_url, query.data?.github_branch]);

  const { publishJson } = useInterviewRoom();
  const [closingTriggered, setClosingTriggered] = useState(false);

  useEffect(() => {
    const data = query.data;
    if (data?.status !== 'ready_for_interview' || !data.interview_token) return;
    
    if (!closingTriggered) {
      setClosingTriggered(true);
      publishJson({ action: 'end_build_phase' }).catch(() => {});
      
      // Wait for speech to complete before redirecting
      setTimeout(() => {
        const interviewToken = data.interview_token;
        const portalToken = data.portal_token;
        if (portalToken) localStorage.setItem(`portalToken:${interviewToken}`, portalToken);
        const qs = portalToken
          ? `?portalToken=${encodeURIComponent(portalToken)}&bndPhase=defend`
          : '?bndPhase=defend';
        releaseInterviewLeaveGuard();
        window.location.href = withBasePath(`/autonomous-interview/${interviewToken}${qs}`);
      }, 7000);
    }
  }, [query.data?.status, query.data?.interview_token, query.data?.portal_token, closingTriggered, publishJson]);

  const submitMutation = useMutation({
    mutationFn: (input: { github_url?: string; github_branch?: string; file?: File }) =>
      input.file
        ? submitProjectInterviewZip(lookupToken, input.file)
        : submitProjectInterviewRepo(lookupToken, {
            github_url: input.github_url ?? '',
            github_branch: input.github_branch,
          }),
    onSuccess: (data) => qc.setQueryData(queryKey, data),
  });

  const data = query.data;
  const project = data?.selected_project as CandidateProjectChoice | null | undefined;
  const urlValid = GITHUB_URL_RE.test(githubUrl.trim());
  const documentPack = project?.submission_type === 'zip_upload';
  const excelMode = project?.submission_type === 'excel_or_pdf';
  const fileUpload = documentPack || excelMode;

  if (query.isLoading) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-[var(--assessment-on-surface-variant)]">
        Loading assessment…
      </div>
    );
  }

  if (query.error || !data) {
    return (
      <div className="p-6 text-sm text-red-600">
        {query.error instanceof Error ? query.error.message : 'Could not load assessment details.'}
      </div>
    );
  }

  if (data.status === 'evaluating_code') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-[var(--assessment-primary)] border-t-transparent" />
        <h3 className="text-lg font-bold text-[var(--assessment-on-surface)]">
          {excelMode ? 'Grading your workbook…' : documentPack ? 'Evaluating your zip…' : 'Evaluating your repo…'}
        </h3>
        <SubmissionEvaluationProgress target={data.github_url || 'your uploaded files'} />
      </div>
    );
  }

  if (data.status === 'ready_for_interview') {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
        <h3 className="text-lg font-bold text-emerald-800">Starting Defend interview…</h3>
        <p className="text-sm text-emerald-700">Connecting you to the AI interviewer.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--assessment-outline-variant)]">
              Build assessment
            </p>
            <h2 className="text-sm font-bold text-[var(--assessment-on-surface)]">
              {project?.title ?? 'Project'}
            </h2>
          </div>
          {data.due_at ? (
            <div className="rounded-lg border border-[var(--assessment-primary)]/25 bg-[var(--assessment-surface-container)] px-2.5 py-1 text-xs font-bold text-[var(--assessment-primary)]">
              <DeadlineCountdown dueAt={data.due_at} />
            </div>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-[var(--assessment-on-surface-variant)]">
          You have {data.max_assessment_hours}h. Keep screen share on; mic stays off during Build.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {project ? (
          <div className="prose prose-sm max-w-none text-[var(--assessment-on-surface)]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{project.description_md}</ReactMarkdown>
          </div>
        ) : null}

        {project ? (
          <ProjectAssessmentDownloads
            project={project}
            submissionToken={data.submission_token}
            compact
          />
        ) : null}

        {!excelMode && project?.must_have_requirements?.length ? (
          <div>
            <p className="mb-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--assessment-outline-variant)]">
              Must-have requirements
            </p>
            <ul className="space-y-1.5">
              {project.must_have_requirements.map((r) => (
                <li key={r.id} className="flex items-start gap-1.5 text-xs text-[var(--assessment-on-surface-variant)]">
                  <AssessmentMaterialIcon name="check_circle" size={14} className="mt-0.5 text-emerald-600" />
                  <span>{r.text}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {!excelMode && project?.twist_requirement ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            <strong>Twist:</strong> {project.twist_requirement}
          </div>
        ) : null}

        <div className="rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-4 shadow-sm">
          <h3 className="mb-1 text-sm font-bold text-[var(--assessment-on-surface)]">
            {excelMode
              ? 'Submit your workbook'
              : documentPack
                ? 'Submit your zip'
                : 'Submit GitHub repo'}
          </h3>
          <p className="mb-3 text-[11px] leading-relaxed text-[var(--assessment-on-surface-variant)]">
            {excelMode
              ? 'Upload the completed Excel file. We grade it against the answer key, then start your Defend interview.'
              : documentPack
                ? 'Upload a .zip of your SQL and write-ups. Evaluation starts immediately; Defend follows when ready.'
                : 'Push to a public repository, then submit. Evaluation starts immediately; Defend follows when ready.'}
          </p>

          {data.last_error ? (
            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2 text-[11px] text-red-800">
              <strong>{excelMode ? 'Upload / grading issue.' : "We couldn't access your code."}</strong>{' '}
              {data.last_error.replace(/^We couldn't access your code\.\s*/i, '')}
            </div>
          ) : null}

          {fileUpload ? (
            <div className="mb-3 space-y-2">
              <span className="text-[11px] font-bold text-[var(--assessment-on-surface-variant)]">
                {excelMode ? 'Your completed file' : 'Your zip file'}
              </span>
              <label
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-5 text-center transition ${
                  zipFile
                    ? 'border-[var(--assessment-primary)]/40 bg-[var(--assessment-primary)]/5'
                    : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]/50 hover:border-[var(--assessment-primary)]/50'
                }`}
              >
                <input
                  type="file"
                  accept={
                    excelMode
                      ? '.xlsx,.xls,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf'
                      : '.zip,application/zip'
                  }
                  onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
                  className="sr-only"
                />
                <AssessmentMaterialIcon
                  name={zipFile ? 'draft' : 'upload_file'}
                  size={28}
                  className="text-[var(--assessment-primary)]"
                />
                {zipFile ? (
                  <>
                    <p className="max-w-full truncate text-sm font-semibold text-[var(--assessment-on-surface)]">
                      {zipFile.name}
                    </p>
                    <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                      {(zipFile.size / 1024).toFixed(0)} KB · click to replace
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-[var(--assessment-on-surface)]">
                      {excelMode ? 'Drop workbook here or browse' : 'Drop zip here or browse'}
                    </p>
                    <p className="text-[11px] text-[var(--assessment-on-surface-variant)]">
                      {excelMode ? '.xlsx preferred · .pdf for soft scoring' : '.zip only'}
                    </p>
                  </>
                )}
              </label>
              {zipFile ? (
                <button
                  type="button"
                  onClick={() => setZipFile(null)}
                  className="text-[11px] font-semibold text-red-600 hover:underline"
                >
                  Remove file
                </button>
              ) : null}
            </div>
          ) : (
          <>
          <label className="mb-3 block space-y-1">
            <span className="text-[11px] font-bold text-[var(--assessment-on-surface-variant)]">Repository URL</span>
            <input
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="https://github.com/owner/repo"
              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm outline-none focus:border-[var(--assessment-primary)]"
            />
            {githubUrl.trim() && !urlValid ? (
              <span className="text-[11px] text-red-600">Use https://github.com/owner/repo</span>
            ) : null}
          </label>
          <label className="mb-3 block space-y-1">
            <span className="text-[11px] font-bold text-[var(--assessment-on-surface-variant)]">Branch (optional)</span>
            <input
              value={githubBranch}
              onChange={(e) => setGithubBranch(e.target.value)}
              placeholder="main"
              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] px-3 py-2 text-sm outline-none focus:border-[var(--assessment-primary)]"
            />
          </label>
          </>
          )}
          {submitMutation.error ? (
            <p className="mb-2 text-[11px] font-semibold text-red-600">
              {submitMutation.error instanceof Error ? submitMutation.error.message : 'Submit failed'}
            </p>
          ) : null}
          <button
            type="button"
            disabled={(fileUpload ? !zipFile : !urlValid) || submitMutation.isPending}
            onClick={() => setConfirmOpen(true)}
            className="w-full rounded-xl bg-[var(--assessment-primary)] py-2.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {submitMutation.isPending ? 'Submitting…' : 'Submit & evaluate'}
          </button>
        </div>
      </div>

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[var(--assessment-surface-container)] p-6 shadow-xl">
            <h3 className="text-lg font-bold text-[var(--assessment-on-surface)]">
              {excelMode ? 'Submit workbook?' : documentPack ? 'Submit zip?' : 'Submit repository?'}
            </h3>
            <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
              We will analyse{' '}
              <span className="font-mono text-xs">
                {fileUpload
                  ? zipFile?.name
                  : `${githubUrl.trim()}${githubBranch.trim() ? ` @ ${githubBranch.trim()}` : ''}`}
              </span>{' '}
              and then start your Defend interview.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className="rounded-lg px-4 py-2 text-sm font-semibold text-[var(--assessment-on-surface-variant)] hover:bg-slate-100"
              >
                Not yet
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmOpen(false);
                  submitMutation.mutate(
                    fileUpload && zipFile
                      ? { file: zipFile }
                      : { github_url: githubUrl.trim(), github_branch: githubBranch.trim() },
                  );
                }}
                className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-bold text-white"
              >
                Submit now
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
