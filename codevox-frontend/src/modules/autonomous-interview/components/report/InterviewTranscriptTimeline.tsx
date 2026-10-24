'use client';

import { useMemo, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type { InterviewTurn } from '@/modules/autonomous-interview/types/interview-report';
import {
  formatSessionIdAsName,
  interviewInterviewerLabel,
  isTurnSkipped,
  type InterviewReportKind,
} from '@/modules/autonomous-interview/utils/interview-report';
import {
  exportTranscriptToPdf,
  printTranscriptHtml,
} from '@/modules/autonomous-interview/utils/export-transcript-pdf';
import { exportTranscriptToExcel } from '@/modules/autonomous-interview/utils/export-transcript-excel';

type Props = {
  turns: InterviewTurn[];
  sessionId: string;
  candidateName?: string | null;
  reportKind?: InterviewReportKind;
};

const isSkippedTurn = isTurnSkipped;

export function InterviewTranscriptTimeline({
  turns,
  sessionId,
  candidateName,
  reportKind = 'technical',
}: Props) {
  const name = (candidateName && candidateName.trim()) || formatSessionIdAsName(sessionId);
  const interviewerLabel = interviewInterviewerLabel(reportKind);
  const [query, setQuery] = useState('');
  const [hideSkipped, setHideSkipped] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingExcel, setIsExportingExcel] = useState(false);
  const [showDownloadMenu, setShowDownloadMenu] = useState(false);

  const skippedCount = useMemo(() => turns.filter(isSkippedTurn).length, [turns]);

  const handleDownloadPdf = () => {
    try {
      setIsExportingPdf(true);
      exportTranscriptToPdf({
        turns,
        sessionId,
        candidateName,
        reportKind,
      });
    } catch (err) {
      console.error('Failed to export transcript PDF:', err);
    } finally {
      setIsExportingPdf(false);
    }
  };

  const handleDownloadExcel = () => {
    try {
      setIsExportingExcel(true);
      exportTranscriptToExcel({
        turns,
        sessionId,
        candidateName,
        reportKind,
      });
    } catch (err) {
      console.error('Failed to export transcript Excel:', err);
    } finally {
      setIsExportingExcel(false);
    }
  };

  const handleDownloadBoth = () => {
    handleDownloadPdf();
    handleDownloadExcel();
  };

  const handlePrint = () => {
    printTranscriptHtml({
      turns,
      sessionId,
      candidateName,
      reportKind,
    });
  };

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return turns
      .map((turn, index) => ({ turn, index }))
      .filter(({ turn }) => {
        if (hideSkipped && isSkippedTurn(turn)) return false;
        if (!q) return true;
        return (
          turn.question_asked?.toLowerCase().includes(q) ||
          turn.candidate_reply?.toLowerCase().includes(q) ||
          turn.topic_domain?.toLowerCase().includes(q)
        );
      });
  }, [turns, query, hideSkipped]);

  return (
    <section className="assessment-card overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--assessment-outline-variant)] p-5">
        <div>
          <h2 className="text-base font-bold text-[var(--assessment-on-surface)]">Interview transcript</h2>
          <p className="text-xs text-[var(--assessment-on-surface-variant)]">
            {turns.length} question{turns.length === 1 ? '' : 's'}
            {skippedCount ? ` · ${skippedCount} skipped` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--assessment-on-surface-variant)]">
              <AssessmentMaterialIcon name="search" size={16} />
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transcript"
              className="w-48 sm:w-56 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] py-1.5 pl-8 pr-3 text-sm outline-none focus:border-[var(--assessment-primary)]"
            />
          </label>
          {skippedCount ? (
            <button
              type="button"
              onClick={() => setHideSkipped((v) => !v)}
              aria-pressed={hideSkipped}
              className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                hideSkipped
                  ? 'border-[var(--assessment-primary)] bg-[var(--assessment-primary-container)] text-[var(--assessment-primary)]'
                  : 'border-[var(--assessment-outline-variant)] text-[var(--assessment-on-surface-variant)] hover:border-[var(--assessment-primary)]'
              }`}
            >
              <AssessmentMaterialIcon name="skip_next" size={16} />
              Hide skipped
            </button>
          ) : null}

          {/* Download Buttons: PDF, Excel, and Dropdown */}
          <div className="relative inline-flex items-center rounded-lg shadow-sm">
            <button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isExportingPdf || turns.length === 0}
              className="inline-flex items-center gap-1.5 rounded-l-lg bg-[var(--assessment-primary)] px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
              title="Download Transcript as PDF (.pdf)"
            >
              <AssessmentMaterialIcon name={isExportingPdf ? 'hourglass_top' : 'picture_as_pdf'} size={16} />
              {isExportingPdf ? 'PDF...' : 'Download PDF'}
            </button>
            <button
              type="button"
              onClick={handleDownloadExcel}
              disabled={isExportingExcel || turns.length === 0}
              className="inline-flex items-center gap-1.5 border-l border-white/20 bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              title="Download Transcript as Excel (.xlsx)"
            >
              <AssessmentMaterialIcon name={isExportingExcel ? 'hourglass_top' : 'table_view'} size={16} />
              {isExportingExcel ? 'Excel...' : 'Download Excel'}
            </button>
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowDownloadMenu((v) => !v)}
                disabled={turns.length === 0}
                className="inline-flex items-center rounded-r-lg border-l border-white/20 bg-emerald-700 px-1.5 py-1.5 text-sm font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-50"
                title="More download options (Download Both)"
                aria-expanded={showDownloadMenu}
              >
                <AssessmentMaterialIcon name="arrow_drop_down" size={18} />
              </button>

              {showDownloadMenu && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 w-56 rounded-lg border border-slate-200 bg-[var(--assessment-surface-container)] py-1.5 shadow-lg"
                  onClick={() => setShowDownloadMenu(false)}
                >
                  <button
                    type="button"
                    onClick={handleDownloadPdf}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <AssessmentMaterialIcon name="picture_as_pdf" size={16} className="text-red-500" />
                    <span>Download PDF (.pdf)</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadExcel}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <AssessmentMaterialIcon name="table_view" size={16} className="text-emerald-600" />
                    <span>Download Excel (.xlsx)</span>
                  </button>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    type="button"
                    onClick={handleDownloadBoth}
                    className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-semibold text-blue-600 hover:bg-blue-50"
                  >
                    <AssessmentMaterialIcon name="file_download" size={16} />
                    <span>Download Both (PDF + Excel)</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={handlePrint}
            disabled={turns.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-3 py-1.5 text-sm font-medium text-[var(--assessment-on-surface)] shadow-sm transition hover:border-[var(--assessment-primary)] hover:text-[var(--assessment-primary)] disabled:opacity-50"
            title="Print or Save as PDF"
          >
            <AssessmentMaterialIcon name="print" size={16} />
            Print
          </button>
        </div>
      </div>

      <ol className="interview-report-scroll max-h-[720px] space-y-5 overflow-y-auto p-5">
        {visible.map(({ turn, index }) => {
          const skipped = isSkippedTurn(turn);
          const evidence = turn.evidence;
          return (
            <li key={`${turn.turn_index}-${index}`} className="space-y-2">
              <div className="flex gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--assessment-primary-container)] text-[var(--assessment-primary)]">
                  <AssessmentMaterialIcon name="smart_toy" size={16} />
                </span>
                <div className="min-w-0 max-w-[85%] rounded-xl rounded-tl-sm border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] p-3.5">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="font-bold text-[var(--assessment-primary)]">Q{index + 1}</span>
                    <span className="font-semibold text-[var(--assessment-on-surface-variant)]">{interviewerLabel}</span>
                    {(turn.resume_tech || turn.topic_domain) ? (
                      <span className="rounded bg-[var(--assessment-surface-container-high)] px-1.5 py-0.5 font-semibold text-[var(--assessment-on-surface)]">
                        {turn.resume_tech || turn.topic_domain}
                      </span>
                    ) : null}
                    {turn.level ? (
                      <span className="rounded border border-[var(--assessment-outline-variant)] px-1.5 py-0.5 text-[var(--assessment-on-surface-variant)]">
                        {turn.level}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm font-medium leading-relaxed text-[var(--assessment-on-surface)]">
                    {turn.question_asked}
                  </p>
                </div>
              </div>

              {turn.candidate_reply?.trim() ? (
                <div className="flex flex-row-reverse gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--assessment-surface-container-high)] text-[var(--assessment-on-surface-variant)]">
                    <AssessmentMaterialIcon name="person" size={16} />
                  </span>
                  <div
                    className={`min-w-0 max-w-[85%] rounded-xl rounded-tr-sm border p-3.5 ${
                      skipped
                        ? 'border-dashed border-[var(--assessment-outline-variant)] bg-transparent'
                        : 'border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] shadow-sm'
                    }`}
                  >
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                      <span className="font-bold text-[var(--assessment-on-surface)]">{name}</span>
                      {skipped ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 font-semibold text-slate-700">
                          <AssessmentMaterialIcon name="skip_next" size={12} />
                          {turn.intent_label === 'OFFTOPIC' ? 'Off-topic' : 'Skipped'}
                        </span>
                      ) : null}
                    </div>
                    <p
                      className={`text-sm leading-relaxed ${
                        skipped ? 'italic text-[var(--assessment-on-surface-variant)]' : 'text-[var(--assessment-on-surface)]'
                      }`}
                    >
                      {turn.candidate_reply}
                    </p>
                    {!skipped && evidence ? (
                      <div className="mt-2 flex items-start gap-1.5 border-t border-[var(--assessment-outline-variant)] pt-2 text-xs text-[var(--assessment-primary)]">
                        <AssessmentMaterialIcon name="psychology" size={14} className="mt-0.5" />
                        <span>{evidence}</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
        {!visible.length ? (
          <li className="py-10 text-center text-sm text-[var(--assessment-on-surface-variant)]">
            {turns.length ? 'No questions match your search.' : 'No transcript was recorded for this session.'}
          </li>
        ) : null}
      </ol>
    </section>
  );
}
