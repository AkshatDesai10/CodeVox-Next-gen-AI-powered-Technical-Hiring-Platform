import type {
  HiringRecommendation,
  InterviewReportEnrichment,
  InterviewSessionReport,
  InterviewTurn,
  ScorecardRow,
} from '@/modules/autonomous-interview/types/interview-report';

export function isTurnSkipped(turn: InterviewTurn): boolean {
  if (turn.internal_score_10 !== null && turn.internal_score_10 !== undefined) {
    return false;
  }
  if (
    turn.understanding_level &&
    ['STRONG', 'MODERATE', 'WEAK', 'BORDERLINE'].includes(turn.understanding_level)
  ) {
    return false;
  }
  const reply = (turn.candidate_reply ?? '').toLowerCase().trim();
  return turn.intent_label === 'SKIP' || turn.intent_label === 'OFFTOPIC' || reply === 'skip';
}

const DEPTH_MAX = 10;

export function formatSessionIdAsName(sessionId: string): string {
  if (sessionId.length > 25 || /^[a-f0-9\-_]{20,}$/i.test(sessionId)) {
    return 'Anonymous Candidate';
  }
  return sessionId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export type InterviewReportKind = 'screening' | 'behavioural' | 'technical';

export function resolveInterviewReportKind(
  report: InterviewSessionReport,
  enrichment?: InterviewReportEnrichment | null,
): InterviewReportKind {
  const stack = String(report.tech_stack ?? '').toLowerCase();
  const asAny = report as InterviewSessionReport & {
    screening_voice_audit?: unknown;
    hr_voice_audit?: unknown;
  };
  if (enrichment?.screeningVoiceAudit || asAny.screening_voice_audit || stack.includes('screening')) {
    return 'screening';
  }
  if (
    enrichment?.hrVoiceAudit ||
    asAny.hr_voice_audit ||
    stack.includes('behavioural') ||
    stack.includes('behavioral') ||
    /\bhr\b/.test(stack)
  ) {
    return 'behavioural';
  }
  return 'technical';
}

/** Banner subtitle: which interview report this is (not "… Engineer"). */
export function interviewReportKindLabel(
  kind: InterviewReportKind,
  techStack?: string | null,
): string {
  switch (kind) {
    case 'screening':
      return 'AI Screening Report';
    case 'behavioural':
      return 'Behavioural Interview Report';
    default: {
      const tech = String(techStack ?? '').trim();
      if (tech && !/ai\s|interview|screening|behavioural|behavioral|\bhr\b/i.test(tech)) {
        return `Technical Interview Report · ${tech}`;
      }
      return 'Technical Interview Report';
    }
  }
}

export function interviewInterviewerLabel(kind: InterviewReportKind): string {
  switch (kind) {
    case 'screening':
      return 'AI Screening Interviewer';
    case 'behavioural':
      return 'AI Behavioural Interviewer';
    default:
      return 'AI Technical Interviewer';
  }
}

export function candidateInitials(sessionId: string): string {
  const parts = sessionId.split(/[-_]+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? 'CA').toUpperCase();
}

export function formatFinalizedAt(iso: string | null | undefined): string {
  if (!iso) return 'Session time unavailable';
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

export function depthScorePercent(depthScore: number): number {
  return Math.round((Math.max(0, Math.min(DEPTH_MAX, depthScore)) / DEPTH_MAX) * 100);
}

export type MediaTerminationEvent = {
  event_type: string;
  payload?: Record<string, unknown>;
  created_at?: string;
};

export function findCandidateEnded(
  enrichment?: InterviewReportEnrichment | null,
): MediaTerminationEvent | null {
  const events = enrichment?.integrity?.proctor_events ?? [];
  const fromEvents = events.find((event) => event.event_type === 'candidate_ended_interview');
  if (fromEvents) return fromEvents;
  const summary = enrichment?.integrity?.proctor_summary as
    | { terminated_by?: string; bndPhase?: string; candidate_ended_at?: string }
    | undefined;
  if (summary?.bndPhase === 'build') return null;
  if (summary?.terminated_by === 'candidate') {
    return {
      event_type: 'candidate_ended_interview',
      created_at: summary.candidate_ended_at,
      payload: { reason: 'candidate_ended_interview' },
    };
  }
  return null;
}

export function findMediaTermination(
  enrichment?: InterviewReportEnrichment | null,
): MediaTerminationEvent | null {
  const events = enrichment?.integrity?.proctor_events ?? [];
  const fromEvents = events.find((event) => event.event_type === 'media_permission_terminated');
  if (fromEvents) return fromEvents;
  const summaryByTypes = (
    enrichment?.integrity?.proctor_summary as
      | { by_type?: Record<string, number> }
      | undefined
  )?.by_type;
  if (summaryByTypes && (summaryByTypes['media_permission_terminated'] ?? 0) > 0) {
    return {
      event_type: 'media_permission_terminated',
      payload: {
        reason: 'max_strikes_exceeded',
        details: 'The session was closed after excessive camera or microphone interruptions.',
      },
    };
  }
  return null;
}

export type ProctorTerminationEvent = {
  event_type: 'media_permission_terminated' | 'focus_strike_terminated' | string;
  payload?: {
    reason?: string;
    details?: string;
    focus_strikes?: number;
    max_focus_strikes?: number;
    message?: string;
    strikes?: number;
    phase?: string;
    [key: string]: unknown;
  };
  created_at?: string;
};

export function findProctorTermination(
  enrichment?: InterviewReportEnrichment | null,
): ProctorTerminationEvent | null {
  const events = enrichment?.integrity?.proctor_events ?? [];
  const focusTerm = events.find((e) => e.event_type === 'focus_strike_terminated');
  if (focusTerm) {
    return {
      event_type: 'focus_strike_terminated',
      payload: {
        reason: 'max_focus_strikes_exceeded',
        details: 'The session was terminated after exceeding maximum allowed tab/window departures.',
        message: String((focusTerm.payload as Record<string, unknown> | undefined)?.message ?? 'Focus limit reached'),
        focus_strikes: Number((focusTerm.payload as Record<string, unknown> | undefined)?.focus_strikes ?? 3),
      },
      created_at: focusTerm.created_at,
    };
  }

  const mediaTerm = findMediaTermination(enrichment);
  if (mediaTerm) {
    return {
      event_type: mediaTerm.event_type,
      payload: mediaTerm.payload as ProctorTerminationEvent['payload'],
      created_at: mediaTerm.created_at,
    };
  }

  const proctorSummary = enrichment?.integrity?.proctor_summary as
    | {
        terminated_by?: string;
        termination_reason?: string;
        by_type?: Record<string, number>;
        focus_strike_count?: number;
        media_strike_count?: number;
      }
    | undefined;

  if (
    proctorSummary?.terminated_by === 'proctor' ||
    (proctorSummary?.focus_strike_count && proctorSummary.focus_strike_count >= 3) ||
    (proctorSummary?.media_strike_count && proctorSummary.media_strike_count >= 3)
  ) {
    const isFocus =
      proctorSummary.termination_reason?.includes('focus') ||
      (proctorSummary.focus_strike_count && proctorSummary.focus_strike_count >= 3);
    return {
      event_type: isFocus ? 'focus_strike_terminated' : 'media_permission_terminated',
      payload: {
        reason: proctorSummary.termination_reason ?? (isFocus ? 'max_focus_strikes_exceeded' : 'max_media_strikes_exceeded'),
        details: isFocus
          ? 'The session was closed after exceeding allowed tab or fullscreen switches.'
          : 'The session was closed after excessive camera or microphone interruptions.',
      },
    };
  }

  return null;
}

/** Recruiter-facing reason. Uses stored `details` when present, otherwise `reason`. */
export function mediaTerminationDetail(event: MediaTerminationEvent | ProctorTerminationEvent): string {
  const payload = event.payload as Record<string, unknown> | undefined;
  const details = payload?.details;
  if (typeof details === 'string' && details.trim()) return details.trim();
  const reason = String(payload?.reason ?? '');
  if (reason === 'max_focus_strikes_exceeded') {
    return 'The session was closed after exceeding allowed tab or fullscreen switches.';
  }
  if (reason === 'max_strikes_exceeded' || reason === 'max_media_strikes_exceeded') {
    return 'The session was closed after repeated camera or microphone interruptions.';
  }
  return 'The recovery window expired without restoring camera or microphone access.';
}

export function mediaTerminationMeta(event: MediaTerminationEvent | ProctorTerminationEvent): string {
  const payload = event.payload as Record<string, unknown> | undefined;
  const reasonStr = String(payload?.reason ?? '');
  const isFocus = event.event_type === 'focus_strike_terminated' || reasonStr.includes('focus');
  const reason = isFocus
    ? 'Focus strike limit reached'
    : reasonStr === 'max_strikes_exceeded'
      ? 'Strike limit reached'
      : 'Recovery window expired';
  const strikes = payload?.strikes ?? payload?.focus_strikes;
  const strikeLabel = typeof strikes === 'number' ? `Strike ${strikes}` : null;
  const phase = typeof payload?.phase === 'string' ? payload.phase.trim() : '';
  const phaseLabel = phase ? `Round: ${phase.replace(/_/g, ' ')}` : null;
  return [reason, strikeLabel, phaseLabel].filter(Boolean).join(' · ');
}

export function formatProctorEventTime(createdAt?: string): string {
  if (!createdAt) return 'Time unavailable';
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return 'Time unavailable';
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function deriveRecommendation(
  report: InterviewSessionReport,
  enrichment?: InterviewReportEnrichment | null,
): HiringRecommendation {
  if (findProctorTermination(enrichment)) return 'DISQUALIFIED';

  const skipped = report.resume_alignment?.skipped_due_to_struggles?.length ?? 0;
  const verified = report.resume_alignment?.verified?.length ?? 0;
  const depth = report.depth_score ?? 0;

  if (skipped >= 3 || depth <= 3) return 'NO_HIRE';
  if (depth >= 8 && skipped === 0) return 'STRONG_HIRE';
  if (depth >= 6 && verified >= 2 && skipped === 0) return 'HIRE';
  if (skipped >= 1 || depth <= 5) return 'BORDERLINE';
  return 'HIRE';
}

export function recommendationLabel(rec: HiringRecommendation): string {
  switch (rec) {
    case 'STRONG_HIRE':
      return 'Strong Hire';
    case 'HIRE':
      return 'Hire';
    case 'BORDERLINE':
      return 'Borderline';
    case 'NO_HIRE':
      return 'No Hire';
    case 'DISQUALIFIED':
      return 'Disqualified';
  }
}

export function recommendationStyles(rec: HiringRecommendation): string {
  switch (rec) {
    case 'STRONG_HIRE':
      return 'bg-emerald-50 text-emerald-800 border-emerald-300';
    case 'HIRE':
      return 'bg-green-50 text-green-800 border-green-300';
    case 'BORDERLINE':
      return 'bg-amber-50 text-amber-900 border-amber-300';
    case 'NO_HIRE':
      return 'bg-rose-50 text-rose-800 border-rose-300';
    case 'DISQUALIFIED':
      return 'bg-red-100 text-red-900 border-red-400 font-bold ring-2 ring-red-500/20';
  }
}

export function buildExecutiveSummary(
  report: InterviewSessionReport,
  recommendation: HiringRecommendation,
  enrichment?: InterviewReportEnrichment | null,
  candidateName?: string | null,
): string {
  const name =
    (candidateName && candidateName.trim()) ||
    (report.candidate_name && String(report.candidate_name).trim()) ||
    formatSessionIdAsName(report.session_id);

  if (report.executive_summary) {
    return report.executive_summary
      .replace(/\bAnonymous Candidate\b/g, name)
      .replace(/\bAutonomous Candidate\b/g, name);
  }

  const verified = report.resume_alignment?.verified ?? [];
  const skipped = report.resume_alignment?.skipped_due_to_struggles ?? [];
  const scored =
    recommendation === 'DISQUALIFIED' ? deriveRecommendation(report) : recommendation;
  const kind = resolveInterviewReportKind(report, enrichment);
  const roundLabel =
    kind === 'screening'
      ? 'AI screening'
      : kind === 'behavioural'
        ? 'behavioural interview'
        : `${report.tech_stack} technical interview`;
  const sandbox = enrichment?.sandbox;
  const codeQuality =
    sandbox?.codeQualityScore ?? enrichment?.codeQualityScore ?? null;
  const sandboxNote =
    codeQuality != null
      ? codeQuality >= 70
        ? ' Coding submission demonstrated strong implementation quality.'
        : codeQuality >= 45
          ? ' Coding submission showed functional implementation with room for improvement.'
          : ' Coding submission revealed notable gaps in implementation quality.'
      : sandbox?.hasSubmission
        ? ' A coding sandbox submission was recorded.'
        : '';

  if (report.depth_score == null) {
    return `AI evaluation is pending or no formal summary was generated for this ${roundLabel}. ${sandboxNote}`.trim();
  }

  if (scored === 'STRONG_HIRE' || scored === 'HIRE') {
    return `${name} demonstrated solid technical depth in this ${roundLabel}. Verified competencies include ${verified.join(', ') || 'core stack areas'}.${sandboxNote} Communication was clear and structured under follow-up questioning.`;
  }
  if (scored === 'BORDERLINE') {
    return `${name} showed partial alignment with the role requirements in this ${roundLabel}. Some areas were verified (${verified.join(', ') || 'limited'}), but gaps remain in ${skipped.join(', ') || 'several resume skills'}.${sandboxNote} Additional probing or a focused coding review is recommended before advancing.`;
  }
  return `${name} struggled to demonstrate sufficient depth in this ${roundLabel}. Multiple resume skills could not be adequately verified after follow-up questioning (${skipped.join(', ') || 'see skill grid'}).${sandboxNote} Verbal responses were often shallow or off-topic; proceed with caution for roles requiring hands-on depth.`;
}

function sandboxCodeDesignScore(enrichment?: InterviewReportEnrichment | null): {
  score: number;
  justification: string;
} {
  const sandbox = enrichment?.sandbox;
  const codeQuality =
    sandbox?.codeQualityScore ?? enrichment?.codeQualityScore ?? null;
  const code = sandbox?.sourceCode ?? enrichment?.submittedCode ?? '';
  const passed = sandbox?.passedTestCases ?? 0;
  const total = sandbox?.totalTestCases ?? 0;
  const flaws =
    sandbox?.architecturalFlaws ?? enrichment?.architecturalFlaws ?? [];

  if (!code.trim() && codeQuality == null) {
    return {
      score: 1,
      justification: 'No sandbox submission in this report; score reflects verbal technical signals only.',
    };
  }

  let score = 2;
  if (codeQuality != null) {
    if (codeQuality >= 75) score = 4;
    else if (codeQuality >= 55) score = 3;
    else if (codeQuality < 35) score = 1;
  }

  if (total > 0) {
    const passRate = passed / total;
    if (passRate >= 0.8) score = Math.min(5, score + 1);
    else if (passRate < 0.4) score = Math.max(1, score - 1);
  }

  if (flaws.length >= 2) {
    score = Math.max(1, score - 1);
  }

  const flawNote =
    flaws.length > 0
      ? ` Areas noted: ${flaws.slice(0, 2).join(', ').replace(/_/g, ' ')}.`
      : '';

  let justification: string;
  if (score >= 4) {
    justification = `Code submission demonstrates clean structure and strong implementation quality.${flawNote}`;
  } else if (score >= 3) {
    justification = `Code submission shows functional implementation with room for architectural improvement.${flawNote}`;
  } else if (score >= 2) {
    justification = `Code submission has notable gaps in structure or test coverage.${flawNote}`;
  } else {
    justification = `Code submission shows limited implementation quality or was not provided.${flawNote}`;
  }

  return { score, justification: justification.trim() };
}

export function computeScorecard(
  report: InterviewSessionReport,
  enrichment?: InterviewReportEnrichment | null,
): ScorecardRow[] {
  const hrAudit =
    enrichment?.hrVoiceAudit ??
    (report as InterviewSessionReport & { hr_voice_audit?: NonNullable<InterviewReportEnrichment['hrVoiceAudit']> })
      .hr_voice_audit ??
    null;
  const hrComps = hrAudit?.competencies ?? hrAudit?.competency_evaluations;
  if (Array.isArray(hrComps) && hrComps.length > 0) {
    const mapped: ScorecardRow[] = hrComps.map((c) => ({
      competency: String(c.name ?? c.competency_id ?? 'Competency'),
      score: Math.max(1, Math.min(5, Math.round(Number(c.score) || 1))),
      justification:
        String(c.reasoning ?? c.level ?? '').trim() ||
        `Score ${c.score ?? '—'}/5`,
    }));
    if (typeof hrAudit?.weighted_competency_score === 'number') {
      const fitScore = Math.max(1, Math.min(5, Math.round(hrAudit.weighted_competency_score) || 1));
      const fitJustification = fitScore >= 4
        ? `${hrAudit.final_outcome ?? 'Strong alignment'} — candidate shows strong overall suitability for the role.`
        : fitScore >= 3
          ? `${hrAudit.final_outcome ?? 'Moderate alignment'} — candidate meets several key requirements with some areas to develop.`
          : `${hrAudit.final_outcome ?? 'Limited alignment'} — notable gaps in role suitability were identified.`;
      mapped.push({
        competency: 'Overall Fit',
        score: fitScore,
        justification: fitJustification,
      });
    }
    return mapped;
  }

  const rubricRows = report.rubric_scorecard;
  if (Array.isArray(rubricRows) && rubricRows.length > 0) {
    const mapped: ScorecardRow[] = rubricRows.map((row) => {
      const score10 = typeof row.score_10 === 'number' ? row.score_10 : 0;
      // Evaluation matrix uses 1–5 stars; map diagnostic 1–10 → 1–5.
      const stars = Math.max(1, Math.min(5, Math.round(score10 / 2) || 1));
      return {
        competency: row.competency,
        score: row.score_10 == null ? 1 : stars,
        justification: row.justification,
      };
    });
    const overall10 =
      typeof report.weighted_overall_10 === 'number'
        ? report.weighted_overall_10
        : typeof report.weighted_overall_rounded === 'number'
          ? report.weighted_overall_rounded
          : null;
    if (overall10 != null) {
      const overallStars = Math.max(1, Math.min(5, Math.round(overall10 / 2) || 1));
      const overallJustification = overall10 >= 8.0
        ? 'Exceptional overall performance — consistently strong across all evaluated competencies.'
        : overall10 >= 6.5
          ? 'Solid overall performance with good depth across most competencies.'
          : overall10 >= 5.0
            ? 'Developing proficiency — adequate in some areas but gaps remain in others.'
            : overall10 >= 3.0
              ? 'Limited overall performance — struggled in multiple competency areas.'
              : 'Minimal overall readiness — significant development needed across core areas.';
      mapped.push({
        competency: 'Overall Fit',
        score: overallStars,
        justification: overallJustification,
      });
    }
    return mapped;
  }

  const skipped = report.resume_alignment?.skipped_due_to_struggles?.length ?? 0;
  const depth = report.depth_score ?? 0;
  const skipTurns = report.turns?.filter(isTurnSkipped).length ?? 0;
  const offTopic = report.turns?.filter((t) => t.intent_label === 'OFFTOPIC').length ?? 0;

  let communication = 3;
  if (skipTurns >= 2 || offTopic >= 1) communication = 2;
  if (depth <= 3) communication = Math.min(communication, 2);
  if (depth >= 7 && skipped === 0) communication = 4;

  let algorithmic = 2;
  if (depth >= 6) algorithmic = 3;
  if (depth <= 3) algorithmic = 1;
  if (skipped >= 3) algorithmic = 1;

  const { score: codeDesign, justification: codeDesignJustification } =
    sandboxCodeDesignScore(enrichment);

  const overall = Math.round(((communication + algorithmic + codeDesign) / 3) * 10) / 10;
  const overallRounded = Math.max(1, Math.min(5, Math.round(overall)));

  return [
    {
      competency: 'Technical Communication',
      score: communication,
      justification:
        skipTurns >= 2
          ? 'Multiple skips and limited structured explanations during follow-ups.'
          : 'Mixed articulation; some answers stayed at buzzword level.',
    },
    {
      competency: 'Algorithmic Thinking',
      score: algorithmic,
      justification:
        skipped >= 2
          ? 'Could not sustain depth on Laravel, REST, or MySQL tooling probes.'
          : 'Partial problem decomposition; limited complexity discussion.',
    },
    {
      competency: 'Code Execution / Design',
      score: codeDesign,
      justification: codeDesignJustification,
    },
    {
      competency: 'Overall Fit',
      score: overallRounded,
      justification: overallRounded >= 4
        ? 'Strong overall technical depth with consistent performance across evaluated skill areas.'
        : overallRounded >= 3
          ? 'Adequate overall performance with partial coverage of required skill areas.'
          : overallRounded >= 2
            ? 'Below-average depth — multiple skill areas were not sufficiently demonstrated.'
            : 'Significant gaps across most evaluated skill areas.',
    },
  ];
}

export const DEPTH_SCORE_MAX = DEPTH_MAX;
