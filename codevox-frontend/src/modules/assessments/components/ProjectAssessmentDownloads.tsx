'use client';

import { useState } from 'react';
import type { CandidateProjectChoice } from '@/modules/assessments/lib/project-interview-api';
import { downloadProjectInterviewFiles } from '@/modules/assessments/lib/project-interview-api';

export function ProjectAssessmentDownloads({
  project,
  submissionToken,
  compact = false,
}: {
  project: CandidateProjectChoice;
  submissionToken: string;
  compact?: boolean;
}) {
  const document = project.assessment_document;
  const datasets = project.supporting_datasets ?? [];
  const files = [
    ...(document ? [document] : []),
    ...datasets,
  ];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (files.length === 0) return null;

  const onDownload = () => {
    setError(null);
    setBusy(true);
    void downloadProjectInterviewFiles(submissionToken, project.id)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Could not download assessment files');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className={compact ? 'space-y-2' : 'rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6 shadow-sm'}>
      <h3 className={compact ? 'text-[10px] font-bold uppercase tracking-widest text-[var(--assessment-outline-variant)]' : 'mb-3 text-lg font-bold text-[var(--assessment-on-surface)]'}>
        Download assessment files
      </h3>
      <p className={compact ? 'text-[11px] text-[var(--assessment-on-surface-variant)]' : 'mb-3 text-sm text-[var(--assessment-on-surface-variant)]'}>
        {project.submission_type === 'excel_or_pdf'
          ? 'Download the problem sheet, complete it in Excel or Google Sheets, then upload your finished .xlsx (or PDF).'
          : project.submission_type === 'zip_upload'
            ? 'Download the assessment and any datasets, complete the work in your own tools, then upload a zip of your text answers.'
            : 'Download the assessment and any datasets, put your SQL and write-ups in a public GitHub repository, then submit the repository URL.'}
      </p>
      <ul className="space-y-1">
        {files.map((file) => (
          <li key={`${file.filename}:${file.file_url}`} className="text-sm text-[var(--assessment-on-surface)]">
            {file.filename}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onDownload}
        disabled={busy || !submissionToken}
        className="mt-2 rounded-lg bg-[var(--assessment-primary)] px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
      >
        {busy ? 'Downloading…' : files.length > 1 ? 'Download all files' : 'Download file'}
      </button>
      {error ? <p className="text-[11px] text-red-600">{error}</p> : null}
    </div>
  );
}
