'use client';

import { jsPDF } from 'jspdf';
import type { InterviewTurn } from '../types/interview-report';
import {
  formatSessionIdAsName,
  interviewInterviewerLabel,
  isTurnSkipped,
  type InterviewReportKind,
} from './interview-report';

export type ExportTranscriptOptions = {
  turns: InterviewTurn[];
  sessionId: string;
  candidateName?: string | null;
  reportKind?: InterviewReportKind;
};

function resolveRoundTitle(reportKind?: InterviewReportKind): string {
  switch (reportKind) {
    case 'screening':
      return 'AI Screening';
    case 'behavioural':
      return 'AI Behavioural / HR';
    case 'technical':
    default:
      return 'AI Technical Interview';
  }
}

function safeText(str?: string | null): string {
  if (!str) return '';
  return str
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[^\x00-\x7F]/g, '');
}

/**
 * Generates and downloads a clean, professional PDF of the interview transcript.
 */
export function exportTranscriptToPdf(options: ExportTranscriptOptions): void {
  const { turns, sessionId, candidateName, reportKind = 'technical' } = options;
  const rawName = (candidateName && candidateName.trim()) || formatSessionIdAsName(sessionId);
  const name = safeText(rawName) || 'Candidate';
  const interviewerLabel = safeText(interviewInterviewerLabel(reportKind));
  const roundTitle = resolveRoundTitle(reportKind);
  const skippedCount = turns.filter(isTurnSkipped).length;

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const marginX = 15;
  const contentWidth = pageWidth - marginX * 2; // 180mm
  const bottomThreshold = pageHeight - 20; // 277mm
  let currentY = 15;

  // 1. First Page Header
  // Top brand bar
  doc.setFillColor(37, 99, 235); // #2563eb
  doc.rect(marginX, currentY, contentWidth, 3, 'F');
  currentY += 8;

  // Main title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42); // #0f172a
  doc.text('CODEVOX RECRUITMENT ASSESSMENT', marginX, currentY);
  currentY += 6;

  // Subtitle
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(37, 99, 235);
  doc.text(`${roundTitle} Transcript Report`, marginX, currentY);
  currentY += 7;

  // Metadata Card
  doc.setFillColor(248, 250, 252); // #f8fafc
  doc.setDrawColor(226, 232, 240); // #e2e8f0
  doc.roundedRect(marginX, currentY, contentWidth, 22, 2, 2, 'FD');

  const metaCol1 = marginX + 4;
  const metaCol2 = marginX + 94;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Candidate:', metaCol1, currentY + 6);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(name, metaCol1 + 22, currentY + 6);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('Session ID:', metaCol1, currentY + 12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(sessionId.length > 34 ? `${sessionId.slice(0, 34)}…` : sessionId, metaCol1 + 22, currentY + 12);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('Total Qs:', metaCol1, currentY + 18);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(
    `${turns.length} questions${skippedCount > 0 ? ` (${skippedCount} skipped)` : ' (All completed)'}`,
    metaCol1 + 22,
    currentY + 18,
  );

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('Date:', metaCol2, currentY + 6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(
    new Date().toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }),
    metaCol2 + 20,
    currentY + 6,
  );

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('Interviewer:', metaCol2, currentY + 12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(interviewerLabel, metaCol2 + 20, currentY + 12);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(100, 116, 139);
  doc.text('Status:', metaCol2, currentY + 18);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(16, 185, 129); // emerald
  doc.text('Verified Transcript', metaCol2 + 20, currentY + 18);

  currentY += 28;

  // 2. Turns List
  turns.forEach((turn, index) => {
    const skipped = isTurnSkipped(turn);
    const qText = safeText(turn.question_asked?.trim()) || '(No question specified)';
    const rText = safeText(turn.candidate_reply?.trim()) || (skipped ? '(Question was skipped by candidate)' : '(No response recorded)');
    const evidence = !skipped && turn.evidence?.trim() ? safeText(turn.evidence.trim()) : null;

    // Calculate question dimensions
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const qLines = doc.splitTextToSize(qText, contentWidth - 10);
    const qBoxHeight = 8 + qLines.length * 4.6;

    // Calculate answer dimensions
    const aBoxWidth = contentWidth - 6;
    const rLines = doc.splitTextToSize(rText, aBoxWidth - 12);
    let evLines: string[] = [];
    if (evidence) {
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      evLines = doc.splitTextToSize(`Evaluation Note: ${evidence}`, aBoxWidth - 12);
    }
    const aBoxHeight = 8 + rLines.length * 4.6 + (evidence ? 6 + evLines.length * 4 : 0);

    // Page break check for Question
    if (currentY + qBoxHeight > bottomThreshold) {
      doc.addPage();
      currentY = 22;
    }

    // Draw Question Box
    doc.setFillColor(241, 245, 249); // slate-100
    doc.setDrawColor(203, 213, 225); // slate-300
    doc.roundedRect(marginX, currentY, contentWidth, qBoxHeight, 2, 2, 'FD');

    // Q badge
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(29, 78, 216); // blue-700
    doc.text(`Q${index + 1}`, marginX + 3.5, currentY + 5.5);

    // Interviewer title
    doc.setTextColor(71, 85, 105);
    doc.text(interviewerLabel, marginX + 13, currentY + 5.5);

    // Tags
    let tagX = marginX + 13 + doc.getTextWidth(interviewerLabel) + 4;
    const tagText = (turn.resume_tech || turn.topic_domain || '').trim();
    if (tagText) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      const tagLabel = tagText.toUpperCase();
      const tw = doc.getTextWidth(tagLabel) + 4;
      doc.setFillColor(226, 232, 240);
      doc.roundedRect(tagX, currentY + 2.2, tw, 4.2, 1, 1, 'F');
      doc.setTextColor(30, 41, 59);
      doc.text(tagLabel, tagX + 2, currentY + 5.2);
      tagX += tw + 2;
    }

    if (turn.level) {
      const lvlLabel = turn.level.toUpperCase();
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      const lw = doc.getTextWidth(lvlLabel) + 4;
      doc.setFillColor(255, 255, 255);
      doc.setDrawColor(203, 213, 225);
      doc.roundedRect(tagX, currentY + 2.2, lw, 4.2, 1, 1, 'FD');
      doc.setTextColor(100, 116, 139);
      doc.text(lvlLabel, tagX + 2, currentY + 5.2);
    }

    // Question body
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text(qLines, marginX + 3.5, currentY + 10.5);

    currentY += qBoxHeight + 2;

    // Page break check for Answer
    if (currentY + aBoxHeight > bottomThreshold) {
      doc.addPage();
      currentY = 22;
    }

    // Draw Answer Box
    const aX = marginX + 6;
    if (skipped) {
      doc.setFillColor(254, 252, 232); // amber-50
      doc.setDrawColor(254, 240, 138); // amber-200
      doc.roundedRect(aX, currentY, aBoxWidth, aBoxHeight, 2, 2, 'FD');
      // Left accent bar
      doc.setFillColor(245, 158, 11); // amber-500
      doc.rect(aX, currentY, 1.5, aBoxHeight, 'F');
    } else {
      doc.setFillColor(255, 255, 255); // white
      doc.setDrawColor(226, 232, 240); // slate-200
      doc.roundedRect(aX, currentY, aBoxWidth, aBoxHeight, 2, 2, 'FD');
      // Left accent bar
      doc.setFillColor(37, 99, 235); // blue-600
      doc.rect(aX, currentY, 1.5, aBoxHeight, 'F');
    }

    // Candidate Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(15, 23, 42);
    doc.text(name, aX + 4.5, currentY + 5.5);

    if (skipped) {
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(180, 83, 9); // amber-700
      doc.text(
        turn.intent_label === 'OFFTOPIC' ? '[Off-topic / Skipped]' : '[Skipped by Candidate]',
        aX + 4.5 + doc.getTextWidth(name) + 3,
        currentY + 5.5,
      );
    }

    // Candidate reply body
    doc.setFont('helvetica', skipped ? 'italic' : 'normal');
    doc.setFontSize(9);
    doc.setTextColor(skipped ? 100 : 30, skipped ? 116 : 41, skipped ? 139 : 59);
    doc.text(rLines, aX + 4.5, currentY + 10.5);

    // Evidence note if any
    if (evidence) {
      const evY = currentY + 11 + rLines.length * 4.6;
      doc.setDrawColor(226, 232, 240);
      doc.line(aX + 4, evY - 2, aX + aBoxWidth - 4, evY - 2);

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(67, 56, 202); // indigo-700
      doc.text(evLines, aX + 4.5, evY + 2);
    }

    currentY += aBoxHeight + 5;
  });

  // 3. Footers and Running Headers on all pages
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);

    // Running Header (pages 2+)
    if (p > 1) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(148, 163, 184);
      doc.text(`CodeVox Assessment · ${name} · ${roundTitle} Transcript`, marginX, 12);
      doc.setDrawColor(226, 232, 240);
      doc.line(marginX, 14, pageWidth - marginX, 14);
    }

    // Running Footer (all pages)
    doc.setDrawColor(226, 232, 240);
    doc.line(marginX, pageHeight - 14, pageWidth - marginX, pageHeight - 14);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(148, 163, 184);
    doc.text('CodeVox · Confidential Candidate Report', marginX, pageHeight - 9);
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - marginX, pageHeight - 9, { align: 'right' });
  }

  // Save the PDF
  const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedRound = roundTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  const shortSession = sessionId.slice(0, 8);
  const filename = `${sanitizedName}_${sanitizedRound}_Transcript_${shortSession}.pdf`;

  doc.save(filename);
}

/**
 * Opens a print-formatted window to allow browser preview & native "Save as PDF" / Printing.
 */
export function printTranscriptHtml(options: ExportTranscriptOptions): void {
  const { turns, sessionId, candidateName, reportKind = 'technical' } = options;
  const name = (candidateName && candidateName.trim()) || formatSessionIdAsName(sessionId);
  const interviewerLabel = interviewInterviewerLabel(reportKind);
  const roundTitle = resolveRoundTitle(reportKind);
  const skippedCount = turns.filter(isTurnSkipped).length;

  const turnsHtml = turns
    .map((turn, i) => {
      const skipped = isTurnSkipped(turn);
      const tag = (turn.resume_tech || turn.topic_domain || '').trim().toUpperCase();
      const level = turn.level ? turn.level.toUpperCase() : '';
      const evidence = !skipped && turn.evidence?.trim() ? turn.evidence.trim() : '';

      return `
      <div class="turn-item">
        <div class="question-bubble">
          <div class="bubble-header">
            <span class="q-badge">Q${i + 1}</span>
            <span class="interviewer-name">${escapeHtml(interviewerLabel)}</span>
            ${tag ? `<span class="pill-tag">${escapeHtml(tag)}</span>` : ''}
            ${level ? `<span class="pill-level">${escapeHtml(level)}</span>` : ''}
          </div>
          <p class="bubble-body">${escapeHtml(turn.question_asked || '')}</p>
        </div>

        <div class="answer-bubble ${skipped ? 'skipped' : ''}">
          <div class="bubble-header">
            <span class="candidate-name">${escapeHtml(name)}</span>
            ${
              skipped
                ? `<span class="skipped-tag">${
                    turn.intent_label === 'OFFTOPIC' ? 'Off-topic' : 'Skipped'
                  }</span>`
                : ''
            }
          </div>
          <p class="bubble-body">${escapeHtml(turn.candidate_reply || (skipped ? 'Skipped by candidate' : 'No response'))}</p>
          ${
            evidence
              ? `<div class="evidence-box"><strong>Evaluation Note:</strong> ${escapeHtml(evidence)}</div>`
              : ''
          }
        </div>
      </div>
    `;
    })
    .join('');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(name)} - ${escapeHtml(roundTitle)} Transcript</title>
  <style>
    @page {
      size: A4;
      margin: 15mm;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 20px;
      line-height: 1.5;
      font-size: 13px;
    }
    .header-bar {
      height: 4px;
      background: #2563eb;
      margin-bottom: 16px;
      border-radius: 2px;
    }
    .title-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 2px solid #e2e8f0;
      padding-bottom: 10px;
      margin-bottom: 16px;
    }
    .main-title {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      margin: 0;
    }
    .round-badge {
      font-size: 13px;
      font-weight: 700;
      color: #2563eb;
      background: #eff6ff;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid #bfdbfe;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 16px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 12px 16px;
      margin-bottom: 24px;
      font-size: 12px;
    }
    .meta-item strong {
      color: #64748b;
      margin-right: 6px;
    }
    .turn-item {
      page-break-inside: avoid;
      break-inside: avoid;
      margin-bottom: 18px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .question-bubble {
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 10px 14px;
      max-width: 92%;
    }
    .answer-bubble {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-left: 4px solid #2563eb;
      border-radius: 8px;
      padding: 10px 14px;
      max-width: 92%;
      margin-left: auto;
    }
    .answer-bubble.skipped {
      background: #fffbeb;
      border-color: #fde68a;
      border-left-color: #f59e0b;
    }
    .bubble-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
      font-size: 11px;
    }
    .q-badge {
      font-weight: 800;
      color: #1d4ed8;
    }
    .interviewer-name, .candidate-name {
      font-weight: 700;
      color: #334155;
    }
    .pill-tag {
      background: #e2e8f0;
      color: #1e293b;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .pill-level {
      border: 1px solid #cbd5e1;
      color: #64748b;
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 4px;
    }
    .skipped-tag {
      background: #fef3c7;
      color: #92400e;
      font-size: 10px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 4px;
      border: 1px solid #fde68a;
    }
    .bubble-body {
      margin: 0;
      font-size: 12.5px;
      color: #0f172a;
      line-height: 1.55;
      white-space: pre-wrap;
    }
    .evidence-box {
      margin-top: 8px;
      padding-top: 6px;
      border-top: 1px dashed #e2e8f0;
      font-size: 11px;
      color: #4338ca;
      font-style: italic;
    }
    .footer {
      margin-top: 30px;
      padding-top: 12px;
      border-top: 1px solid #e2e8f0;
      display: flex;
      justify-content: space-between;
      color: #94a3b8;
      font-size: 11px;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="header-bar"></div>
  <div class="title-row">
    <div>
      <h1 class="main-title">CodeVox Assessment</h1>
      <div style="color: #64748b; font-size: 12px; margin-top: 2px;">Official Interview Transcript</div>
    </div>
    <div class="round-badge">${escapeHtml(roundTitle)}</div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><strong>Candidate:</strong> ${escapeHtml(name)}</div>
    <div class="meta-item"><strong>Date:</strong> ${escapeHtml(
      new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    )}</div>
    <div class="meta-item"><strong>Session ID:</strong> <code>${escapeHtml(sessionId)}</code></div>
    <div class="meta-item"><strong>Questions:</strong> ${turns.length} (${skippedCount} skipped)</div>
  </div>

  <div class="turns-container">
    ${turnsHtml}
  </div>

  <div class="footer">
    <span>CodeVox Assessment Platform · Confidential</span>
    <span>Generated on ${new Date().toLocaleDateString()}</span>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 300);
    };
  </script>
</body>
</html>`;

  const printWindow = window.open('', '_blank');
  if (printWindow) {
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
