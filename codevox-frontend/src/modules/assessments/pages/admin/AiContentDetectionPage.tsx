'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { formatTimestampDateTimeDisplay } from '@/lib/date-format';
import {
  analyzeProjectReport,
  listAiDetectionReports,
  type AiDetectionReport,
} from '@/modules/assessments/lib/ai-detection-api';

const ACCEPT = '.pdf,.docx,.doc,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain';
const MAX_BYTES = 15 * 1024 * 1024;

function pct(value: number | null): string {
  return value === null ? '-' : `${(value * 100).toFixed(1)}%`;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function verdictMeta(verdict: string | null): {
  label: string;
  icon: string;
  className: string;
} {
  switch (verdict) {
    case 'ai_generated':
      return {
        label: 'Likely AI-generated',
        icon: 'smart_toy',
        className: 'bg-rose-50 text-rose-700 ring-rose-200',
      };
    case 'human':
      return {
        label: 'Likely human-written',
        icon: 'verified_user',
        className: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
      };
    default:
      return {
        label: 'Uncertain',
        icon: 'help',
        className: 'bg-amber-50 text-amber-700 ring-amber-200',
      };
  }
}

function ProbabilityBar({ report }: { report: AiDetectionReport }) {
  const ai = Math.round((report.ai_probability ?? 0) * 100);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs font-semibold">
        <span className="text-rose-600">AI {pct(report.ai_probability)}</span>
        <span className="text-emerald-600">
          Human {pct(report.human_probability)}
        </span>
      </div>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-emerald-100">
        <div
          className="h-full rounded-l-full bg-rose-500 transition-all"
          style={{ width: `${ai}%` }}
        />
      </div>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--assessment-outline-variant)]/40 bg-[var(--assessment-surface-container)]/40 px-3 py-2">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
        {label}
      </div>
      <div className="mt-0.5 text-lg font-bold text-[var(--assessment-on-surface)]">
        {value}
      </div>
    </div>
  );
}

function ResultPanel({ report }: { report: AiDetectionReport }) {
  const meta = verdictMeta(report.verdict);
  const confidence = pct(report.confidence);
  return (
    <div className="assessment-card space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold ring-1 ${meta.className}`}
        >
          <AssessmentMaterialIcon name={meta.icon} size={18} />
          {meta.label}
        </div>
        <div className="text-right">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            Confidence
          </div>
          <div className="text-2xl font-bold text-[var(--assessment-on-surface)]">
            {confidence}
          </div>
        </div>
      </div>

      <ProbabilityBar report={report} />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricCard
          label="Perplexity"
          value={report.analysis.perplexity?.toFixed(2) ?? '-'}
        />
        <MetricCard
          label="Burstiness"
          value={report.analysis.burstiness?.toFixed(2) ?? '-'}
        />
        <MetricCard
          label="Entropy"
          value={report.analysis.entropy?.toFixed(2) ?? '-'}
        />
        <MetricCard
          label="Classifier"
          value={pct(report.analysis.classifier_score)}
        />
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-[var(--assessment-on-surface-variant)]">
        {report.document_title && (
          <span>
            <b className="font-semibold">Document:</b> {report.document_title}
          </span>
        )}
        <span>
          <b className="font-semibold">Analyzed text:</b>{' '}
          {report.char_count.toLocaleString()} chars
        </span>
        {report.chunk_count > 1 && (
          <span>
            <b className="font-semibold">Passages:</b> {report.chunk_count}
          </span>
        )}
      </div>

      {report.flagged_segments.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
            <AssessmentMaterialIcon name="flag" size={16} />
            {report.flagged_segments.length} flagged segment
            {report.flagged_segments.length === 1 ? '' : 's'}
          </div>
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-[var(--assessment-on-surface-variant)]">
        No AI detector is 100% reliable. Use this signal alongside a viva and
        your own review before drawing conclusions.
      </p>
    </div>
  );
}

export function AiContentDetectionPage() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiDetectionReport | null>(null);

  const historyQuery = useQuery({
    queryKey: ['ai-detection', 'history'],
    queryFn: listAiDetectionReports,
  });

  const mutation = useMutation({
    mutationFn: () => analyzeProjectReport({ file, text, title }),
    onSuccess: (report) => {
      setResult(report);
      setError(null);
      void qc.invalidateQueries({ queryKey: ['ai-detection', 'history'] });
    },
    onError: (err) =>
      setError(err instanceof Error ? err.message : 'Analysis failed.'),
  });

  const canSubmit = useMemo(
    () => (!!file || text.trim().length >= 40) && !mutation.isPending,
    [file, text, mutation.isPending],
  );

  function pickFile(f: File | null) {
    setError(null);
    if (f && f.size > MAX_BYTES) {
      setError('File is too large (max 15 MB).');
      return;
    }
    setFile(f);
    if (f && !title.trim()) setTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-1 text-sm text-[var(--assessment-outline)]">
          <span>Assessments</span>
          <AssessmentMaterialIcon name="chevron_right" size={16} />
          <span className="font-bold text-[var(--assessment-primary)]">
            AI Content Detection
          </span>
        </div>
        <h1 className="text-3xl font-bold text-[var(--assessment-on-surface)]">
          Project Report AI Detection
        </h1>
        <p className="mt-2 text-sm text-[var(--assessment-on-surface-variant)]">
          Upload a student project report (PDF, Word, or text) and check how
          likely the content was AI-generated.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="assessment-card space-y-4 p-5">
          <label className="block space-y-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
              Report title (optional)
            </span>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Final Year Project - Group 7"
              className="w-full rounded-md border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)]"
            />
          </label>

          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              pickFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={`flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-8 text-sm transition-colors ${
              dragOver
                ? 'border-[var(--assessment-primary)] bg-[var(--assessment-surface-container)]'
                : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]/30 hover:border-[var(--assessment-primary)]/50'
            }`}
          >
            <AssessmentMaterialIcon
              name={file ? 'description' : 'upload_file'}
              size={32}
            />
            {file ? (
              <span className="font-semibold text-[var(--assessment-on-surface)]">
                {file.name}{' '}
                <span className="font-normal text-[var(--assessment-on-surface-variant)]">
                  ({formatBytes(file.size)})
                </span>
              </span>
            ) : (
              <>
                <span className="font-semibold text-[var(--assessment-on-surface)]">
                  Click to upload or drag &amp; drop
                </span>
                <span className="text-xs text-[var(--assessment-on-surface-variant)]">
                  PDF, Word (.docx), or text - up to 15 MB
                </span>
              </>
            )}
          </button>
          {file && (
            <button
              type="button"
              onClick={() => pickFile(null)}
              className="text-xs font-semibold text-rose-600 hover:underline"
            >
              Remove file
            </button>
          )}

          <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
            <span className="h-px flex-1 bg-[var(--assessment-outline-variant)]/50" />
            or paste text
            <span className="h-px flex-1 bg-[var(--assessment-outline-variant)]/50" />
          </div>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Paste report text here (min 40 characters)..."
            disabled={!!file}
            className="w-full resize-y rounded-md border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-2 text-sm text-[var(--assessment-on-surface)] outline-none focus:border-[var(--assessment-primary)] disabled:bg-[var(--assessment-surface-container)]/40"
          />

          {error && (
            <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700 ring-1 ring-rose-200">
              {error}
            </div>
          )}

          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => mutation.mutate()}
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[var(--assessment-primary)] px-4 py-2.5 text-sm font-bold text-[var(--assessment-on-primary)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <AssessmentMaterialIcon
              name={mutation.isPending ? 'hourglass_top' : 'plagiarism'}
              size={18}
            />
            {mutation.isPending ? 'Analyzing...' : 'Detect AI content'}
          </button>
        </div>

        <div className="space-y-4">
          {result ? (
            <ResultPanel report={result} />
          ) : (
            <div className="assessment-card flex h-full min-h-[220px] flex-col items-center justify-center gap-2 p-8 text-center">
              <AssessmentMaterialIcon name="analytics" size={40} />
              <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                Upload a report to see the AI-detection verdict, confidence, and
                linguistic analysis here.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="assessment-card p-5">
        <h2 className="mb-3 text-lg font-bold text-[var(--assessment-on-surface)]">
          Recent detections
        </h2>
        {historyQuery.isLoading ? (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            Loading history...
          </p>
        ) : (historyQuery.data ?? []).length === 0 ? (
          <p className="text-sm text-[var(--assessment-on-surface-variant)]">
            No reports analyzed yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-[var(--assessment-outline-variant)]/50 text-xs uppercase tracking-wide text-[var(--assessment-on-surface-variant)]">
                  <th className="py-2 pr-4 font-semibold">Document</th>
                  <th className="py-2 pr-4 font-semibold">Verdict</th>
                  <th className="py-2 pr-4 font-semibold">AI %</th>
                  <th className="py-2 pr-4 font-semibold">Confidence</th>
                  <th className="py-2 pr-4 font-semibold">When</th>
                </tr>
              </thead>
              <tbody>
                {(historyQuery.data ?? []).map((row) => {
                  const meta = verdictMeta(row.verdict);
                  return (
                    <tr
                      key={row.id}
                      className="cursor-pointer border-b border-[var(--assessment-outline-variant)]/30 hover:bg-[var(--assessment-surface-container)]/40"
                      onClick={() => setResult(row)}
                    >
                      <td className="py-2 pr-4 font-medium text-[var(--assessment-on-surface)]">
                        {row.document_title ?? row.file_name ?? 'Pasted text'}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ${meta.className}`}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-[var(--assessment-on-surface)]">
                        {pct(row.ai_probability)}
                      </td>
                      <td className="py-2 pr-4 text-[var(--assessment-on-surface)]">
                        {pct(row.confidence)}
                      </td>
                      <td className="py-2 pr-4 text-[var(--assessment-on-surface-variant)]">
                        {formatTimestampDateTimeDisplay(row.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
