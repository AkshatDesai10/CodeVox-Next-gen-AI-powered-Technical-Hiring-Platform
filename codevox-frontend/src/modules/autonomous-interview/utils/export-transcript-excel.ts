'use client';

import * as XLSX from 'xlsx';
import type { InterviewTurn } from '../types/interview-report';
import {
  formatSessionIdAsName,
  interviewInterviewerLabel,
  isTurnSkipped,
  type InterviewReportKind,
} from './interview-report';
import type { ExportTranscriptOptions } from './export-transcript-pdf';

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

/**
 * Generates and downloads a formatted Microsoft Excel (.xlsx) spreadsheet of the interview transcript.
 */
export function exportTranscriptToExcel(options: ExportTranscriptOptions): void {
  const { turns, sessionId, candidateName, reportKind = 'technical' } = options;
  const rawName = (candidateName && candidateName.trim()) || formatSessionIdAsName(sessionId);
  const name = rawName || 'Candidate';
  const interviewerLabel = interviewInterviewerLabel(reportKind);
  const roundTitle = resolveRoundTitle(reportKind);
  const skippedCount = turns.filter(isTurnSkipped).length;
  const answeredCount = turns.length - skippedCount;

  const wb = XLSX.utils.book_new();

  // 1. Build Transcript Sheet Data
  const sheetRows: (string | number)[][] = [
    ['CODEVOX RECRUITMENT ASSESSMENT - INTERVIEW TRANSCRIPT REPORT'],
    [],
    ['Candidate Name:', name, '', 'Interview Round:', roundTitle],
    ['Session ID:', sessionId, '', 'Date Exported:', new Date().toLocaleString()],
    ['Interviewer:', interviewerLabel, '', 'Total Questions:', turns.length],
    ['Answered Questions:', answeredCount, '', 'Skipped Questions:', skippedCount],
    [],
    [
      'Q#',
      'Topic / Domain',
      'Seniority Level',
      'Interviewer Question',
      'Candidate Response',
      'Status',
      'Score (/10)',
      'Understanding',
      'Evaluation Note / Evidence',
    ],
  ];

  turns.forEach((turn, idx) => {
    const skipped = isTurnSkipped(turn);
    const qNum = idx + 1;
    const topic = (turn.resume_tech || turn.topic_domain || '').trim() || 'General';
    const level = turn.level ? turn.level.toUpperCase() : 'STANDARD';
    const question = turn.question_asked?.trim() || '';
    const answer =
      turn.candidate_reply?.trim() ||
      (skipped ? '(Question was skipped by candidate)' : '(No response recorded)');
    const status = skipped
      ? turn.intent_label === 'OFFTOPIC'
        ? 'Off-topic'
        : 'Skipped by Candidate'
      : 'Answered';
    const score = turn.internal_score_10 != null ? Number(turn.internal_score_10) : '';
    const understanding = turn.understanding_level || (skipped ? 'N/A' : '');
    const evidence = turn.evidence?.trim() || '';

    sheetRows.push([
      qNum,
      topic,
      level,
      question,
      answer,
      status,
      score,
      understanding,
      evidence,
    ]);
  });

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);

  // Set column widths for comfortable reading
  ws['!cols'] = [
    { wch: 6 },  // Q#
    { wch: 18 }, // Topic
    { wch: 15 }, // Level
    { wch: 55 }, // Question
    { wch: 65 }, // Answer
    { wch: 22 }, // Status
    { wch: 12 }, // Score
    { wch: 16 }, // Understanding
    { wch: 50 }, // Evaluation Note
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Transcript');

  // 2. Build Summary Sheet Data
  const summaryRows: (string | number)[][] = [
    ['METRIC', 'VALUE'],
    ['Candidate Name', name],
    ['Session ID', sessionId],
    ['Round Type', roundTitle],
    ['Interviewer', interviewerLabel],
    ['Total Questions Asked', turns.length],
    ['Questions Answered', answeredCount],
    ['Questions Skipped', skippedCount],
    ['Exported At', new Date().toISOString()],
  ];

  const wsSummary = XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols'] = [{ wch: 26 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

  // 3. Write Excel file to browser download
  const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedRound = roundTitle.replace(/[^a-zA-Z0-9_-]/g, '_');
  const shortSession = sessionId.slice(0, 8);
  const filename = `${sanitizedName}_${sanitizedRound}_Transcript_${shortSession}.xlsx`;

  const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([excelBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
