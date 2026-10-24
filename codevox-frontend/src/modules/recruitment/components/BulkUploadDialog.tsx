'use client';

import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { listJobProfiles } from '@/modules/job-profiles/lib/job-profiles-api';
import { bulkCreateCandidates } from '@/modules/recruitment/lib/recruitment-api';

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

const ACCEPT =
  '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_FILES = 50;

function isResumeFile(file: File) {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.pdf') ||
    name.endsWith('.doc') ||
    name.endsWith('.docx') ||
    file.type.includes('pdf') ||
    file.type.includes('word') ||
    file.type.includes('officedocument')
  );
}

export function BulkUploadDialog({ open, onClose, onCreated }: Props) {
  const [jobProfileId, setJobProfileId] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['job-profiles', 'active-for-bulk-upload'],
    queryFn: () => listJobProfiles({ status: 'active', pageSize: 200 }),
    enabled: open,
  });

  const profiles = profilesQuery.data?.items ?? [];

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming).filter(isResumeFile);
    setFiles((prev) => {
      const merged = [...prev];
      for (const file of list) {
        if (merged.length >= MAX_FILES) break;
        if (merged.some((f) => f.name === file.name && f.size === file.size)) continue;
        merged.push(file);
      }
      return merged.slice(0, MAX_FILES);
    });
    setError('');
    setSummary(null);
  }, []);

  if (!open) return null;

  const reset = () => {
    setJobProfileId('');
    setFiles([]);
    setError('');
    setSummary(null);
    setDragOver(false);
  };

  const submit = async () => {
    setError('');
    setSummary(null);
    if (!jobProfileId) {
      setError('Select a job role.');
      return;
    }
    if (!files.length) {
      setError('Add at least one PDF or DOCX resume.');
      return;
    }
    setSubmitting(true);
    try {
      const result = await bulkCreateCandidates({
        jobProfileId,
        resumes: files,
      });
      setSummary(
        `Created ${result.created} candidate${result.created === 1 ? '' : 's'}` +
          (result.failed ? `, ${result.failed} failed` : '') +
          '. Screening is queued.',
      );
      onCreated();
      if (result.failed === 0) {
        reset();
        onClose();
      } else {
        setFiles([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk upload failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => {
        reset();
        onClose();
      }}
      role="presentation"
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-upload-title"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 id="bulk-upload-title" className="text-lg font-semibold text-[var(--assessment-on-surface)]">
              Bulk upload resumes
            </h2>
            <p className="mt-1 text-sm text-[var(--assessment-on-surface-variant)]">
              Upload up to {MAX_FILES} resumes. Candidates stay pending until you invite them; resume
              match runs automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded p-1 text-[var(--assessment-on-surface-variant)] hover:bg-[var(--assessment-surface-container-low)]"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-semibold text-[var(--assessment-on-surface-variant)]">
            Job role
            <select
              className="w-full rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm font-normal text-[var(--assessment-on-surface)] outline-none focus:ring-2 focus:ring-[var(--assessment-primary)]/30"
              value={jobProfileId}
              onChange={(e) => setJobProfileId(e.target.value)}
            >
              <option value="">Select a role</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.title}
                </option>
              ))}
            </select>
          </label>

          <div
            className={`rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${
              dragOver
                ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5'
                : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)]'
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
            }}
          >
            <span className="material-symbols-outlined text-[32px] text-[var(--assessment-primary)]">
              upload_file
            </span>
            <p className="mt-2 text-sm font-medium text-[var(--assessment-on-surface)]">
              Drag & drop PDF/DOCX resumes
            </p>
            <p className="mt-1 text-xs text-[var(--assessment-on-surface-variant)]">
              or choose files ({files.length}/{MAX_FILES})
            </p>
            <label className="mt-3 inline-flex cursor-pointer rounded-lg bg-[var(--assessment-primary)] px-3 py-1.5 text-xs font-semibold text-white">
              Browse files
              <input
                type="file"
                accept={ACCEPT}
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) addFiles(e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>

          {files.length > 0 ? (
            <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--assessment-outline-variant)] p-2 text-xs">
              {files.map((file) => (
                <li
                  key={`${file.name}-${file.size}`}
                  className="flex items-center justify-between gap-2 text-[var(--assessment-on-surface)]"
                >
                  <span className="truncate">{file.name}</span>
                  <button
                    type="button"
                    className="shrink-0 text-[var(--assessment-on-surface-variant)] hover:text-[var(--assessment-primary)]"
                    onClick={() => setFiles((prev) => prev.filter((f) => f !== file))}
                    aria-label={`Remove ${file.name}`}
                  >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          {summary ? (
            <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
              {summary}
            </div>
          ) : null}
          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              reset();
              onClose();
            }}
            className="rounded-lg border border-[var(--assessment-outline-variant)] px-4 py-2 text-sm font-semibold"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={() => void submit()}
            className="rounded-lg bg-[var(--assessment-primary)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {submitting ? 'Uploading…' : `Upload ${files.length || ''}`.trim()}
          </button>
        </div>
      </div>
    </div>
  );
}
