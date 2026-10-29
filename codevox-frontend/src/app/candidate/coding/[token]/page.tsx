'use client';

import { use, useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { getCodingProblem, runCodingCode, submitCodingCode, stopCodingLiveKit } from '@/lib/candidate-api';
import { Play, Send, Clock, Settings, Maximize, User, Code2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { InterviewRecBadge } from '@/modules/autonomous-interview/components/InterviewRecBadge';
import { CodingProctorSession } from '@/modules/assessments/components/CodingProctorSession';
import '@/modules/autonomous-interview/styles/conversation-session.css';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type TestCase = { id: string; name: string; input: string; expected_output?: string; is_visible?: boolean };
type TestResult = { id: string; name: string; passed: boolean; stdout: string; stderr: string; time_ms: number; is_visible: boolean };
type Problem = {
  id: string;
  title: string;
  description_md: string;
  difficulty?: string;
  marks?: number;
  time_limit_minutes?: number;
  constraints?: string;
  examples?: { input: string; output: string; explanation?: string }[];
  starter_code?: Record<string, string>;
  visible_test_cases?: TestCase[];
  workspace_type?: string;
};

const LANG_MONACO: Record<string, string> = {
  python: 'python',
  javascript: 'javascript',
  php: 'php',
  sql: 'sql',
};

const LANG_DISPLAY: Record<string, string> = {
  python: 'Python (3.11)',
  javascript: 'JavaScript (Node 20)',
  php: 'PHP (8.2)',
  sql: 'SQL (Sandbox)',
};

export default function CodingRoundPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const router = useRouter();

  const [problems, setProblems] = useState<Problem[]>([]);
  const [activeProblemIdx, setActiveProblemIdx] = useState(0);
  const [languages, setLanguages] = useState<string[]>(['python']);

  const [codes, setCodes] = useState<Record<string, string>>({});
  const [langs, setLangs] = useState<Record<string, string>>({});
  const [allResults, setAllResults] = useState<Record<string, TestResult[]>>({});

  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    pending: boolean;
    score_pct: number;
    passed: number;
    total: number;
    hidden_summary?: string | null;
  } | null>(null);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Tabs state
  const [selectedTestCaseIdx, setSelectedTestCaseIdx] = useState(0);

  // Timer & Proctoring
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [timerWarning, setTimerWarning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionStartRef = useRef(Date.now());
  const [recElapsed, setRecElapsed] = useState('00:00');
  const handleSubmitRef = useRef<(force?: boolean) => Promise<void>>(async () => undefined);

  // LocalStorage key for persisting code
  const LS_KEY = `coding_draft_${token}`;

  useEffect(() => {
    getCodingProblem(token)
      .then((res) => {
        if (!res.success) {
          setError(res.message ?? 'Failed to load problem');
          return;
        }
        const d = res.data;
        const loadedProblems = d.problems || [];
        setProblems(loadedProblems);
        const loadedLangs = d.languages ?? ['python'];
        setLanguages(loadedLangs);
        setThreshold(d.threshold ?? null);

        const initialCodes: Record<string, string> = {};
        const initialLangs: Record<string, string> = {};
        const initialResults: Record<string, TestResult[]> = {};

        loadedProblems.forEach((p: Problem) => {
          const bestLang =
            loadedLangs.find((l: string) => p.starter_code?.[l]) ?? loadedLangs[0] ?? 'python';
          initialLangs[p.id] = bestLang;
          initialCodes[p.id] = p.starter_code?.[bestLang] ?? '';
        });

        // Restore from localStorage if available
        try {
          const saved = localStorage.getItem(LS_KEY);
          if (saved) {
            const { codes: savedCodes, langs: savedLangs } = JSON.parse(saved);
            if (savedCodes) Object.assign(initialCodes, savedCodes);
            if (savedLangs) Object.assign(initialLangs, savedLangs);
          }
        } catch {
          /* ignore */
        }

        // Restore from last_submission
        if (d.last_submission && d.last_submission.problem_submissions) {
          Object.keys(d.last_submission.problem_submissions).forEach((pid) => {
            const pSub = d.last_submission.problem_submissions[pid];
            if (pSub.language) initialLangs[pid] = pSub.language;
            if (pSub.sourceCode) initialCodes[pid] = pSub.sourceCode;
            if (pSub.testResults) initialResults[pid] = pSub.testResults;
          });
        }

        if (
          d.last_submission &&
          ['grading', 'submitted', 'error'].includes(d.last_submission.status)
        ) {
          let totalPassed = 0;
          let totalCases = 0;
          if (d.last_submission.problem_submissions) {
            Object.values(d.last_submission.problem_submissions).forEach((ps: any) => {
              const tr = ps.testResults || [];
              totalCases += tr.length;
              totalPassed += tr.filter((r: any) => r.passed).length;
            });
          }
          setSubmitResult({
            pending: d.last_submission.status === 'grading',
            score_pct: d.last_submission.score_pct ?? 0,
            passed: totalPassed,
            total: totalCases,
            hidden_summary:
              d.last_submission.status === 'error'
                ? 'Evaluation failed. Please contact support.'
                : null,
          });
        }

        setCodes(initialCodes);
        setLangs(initialLangs);
        setAllResults(initialResults);

        // 5 min per question → total = N × 5 (API also returns time_limit_minutes).
        const minutesPerQuestion = 5;
        const totalMinutes =
          typeof d.time_limit_minutes === 'number' && d.time_limit_minutes > 0
            ? d.time_limit_minutes
            : loadedProblems.length * minutesPerQuestion;
        setSecondsLeft(totalMinutes * 60);

        sessionStartRef.current = Date.now();
        timerRef.current = setInterval(() => {
          setSecondsLeft((prev) => {
            if (prev === null) return null;
            if (prev <= 1) {
              clearInterval(timerRef.current!);
              return 0;
            }
            if (prev === 300) setTimerWarning(true);
            return prev - 1;
          });

          // Elapsed timer
          const diff = Math.floor((Date.now() - sessionStartRef.current) / 1000);
          const em = Math.floor(diff / 60);
          const es = diff % 60;
          setRecElapsed(`${String(em).padStart(2, '0')}:${String(es).padStart(2, '0')}`);
        }, 1000);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Network error');
      })
      .finally(() => {
        setLoading(false);
      });

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [token]);

  // Persist code drafts to localStorage
  useEffect(() => {
    if (Object.keys(codes).length > 0) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ codes, langs }));
      } catch {
        /* ignore */
      }
    }
  }, [codes, langs, LS_KEY]);

  // Poll for background grading completion
  useEffect(() => {
    if (submitResult?.pending) {
      const intervalId = setInterval(() => {
        getCodingProblem(token)
          .then((res) => {
            const status = res.data?.last_submission?.status;
            if (res.success && (status === 'submitted' || status === 'error')) {
              const ls = res.data.last_submission;
              let totalPassed = 0;
              let totalCases = 0;
              if (ls.problem_submissions) {
                Object.values(ls.problem_submissions).forEach((ps: any) => {
                  const tr = ps.testResults || [];
                  totalCases += tr.length;
                  totalPassed += tr.filter((r: any) => r.passed).length;
                });
              }
              setSubmitResult({
                pending: false,
                score_pct: ls.score_pct ?? 0,
                passed: totalPassed,
                total: totalCases,
                hidden_summary:
                  status === 'error' ? 'Evaluation failed. Please contact support.' : null,
              });
              clearInterval(intervalId);
            }
          })
          .catch(() => {});
      }, 3000);
      return () => clearInterval(intervalId);
    }
  }, [submitResult?.pending, token]);

  const activeProblem = problems[activeProblemIdx];
  const isSqlProblem = activeProblem
    ? activeProblem.workspace_type?.toLowerCase() === 'sql' ||
      activeProblem.workspace_type?.toLowerCase() === 'database' ||
      !!activeProblem.starter_code?.['sql'] ||
      activeProblem.title.toLowerCase().includes('database') ||
      activeProblem.title.toLowerCase().includes('sql')
    : false;
  const activeCode = activeProblem ? codes[activeProblem.id] ?? '' : '';
  const activeLang = activeProblem ? langs[activeProblem.id] ?? 'python' : 'python';
  const visibleCases = activeProblem?.visible_test_cases ?? [];
  const results = activeProblem ? allResults[activeProblem.id] ?? null : null;

  const setCode = (val: string) => {
    if (!activeProblem) return;
    setCodes((prev) => ({ ...prev, [activeProblem.id]: val }));
  };

  const onLanguageChange = useCallback(
    (lang: string) => {
      if (!activeProblem) return;
      const currentLang = langs[activeProblem.id] || 'python';
      const currentCode = codes[activeProblem.id] || '';
      const oldStarterCode = activeProblem.starter_code?.[currentLang] || '';

      setLangs((prev) => ({ ...prev, [activeProblem.id]: lang }));

      if (!currentCode.trim() || currentCode.trim() === oldStarterCode.trim()) {
        setCodes((prev) => ({
          ...prev,
          [activeProblem.id]: activeProblem.starter_code?.[lang] ?? '',
        }));
      }
    },
    [activeProblem, codes, langs],
  );

  useEffect(() => {
    if (isSqlProblem && activeProblem && langs[activeProblem.id] !== 'sql') {
      onLanguageChange('sql');
    }
  }, [isSqlProblem, activeProblem, langs, onLanguageChange]);

  const handleRun = async () => {
    if (!activeProblem) return;
    setRunning(true);
    setError(null);
    setAllResults((prev) => ({ ...prev, [activeProblem.id]: [] }));

    try {
      const res = await runCodingCode(token, activeProblem.id, activeLang, activeCode);
      if (!res.success) {
        setError(res.message ?? 'Execution failed');
        return;
      }
      setAllResults((prev) => ({ ...prev, [activeProblem.id]: res.data.results }));
      setSelectedTestCaseIdx(0);
    } catch {
      setError('Network communication error');
    } finally {
      setRunning(false);
    }
  };

  const handleSubmit = useCallback(async (force: boolean = false) => {
    if (!force && !confirm('Submit your final solution? You cannot modify code after submission.')) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const submissions: Record<string, { language: string; source_code: string }> = {};
      problems.forEach((p) => {
        submissions[p.id] = {
          language: langs[p.id] || 'python',
          source_code: codes[p.id] || '',
        };
      });

      void stopCodingLiveKit(token);
      const res = await submitCodingCode(token, submissions);
      if (!res.success) {
        setError(res.message ?? 'Submit failed');
        return;
      }
      setSubmitResult(res.data);
      if (timerRef.current) clearInterval(timerRef.current);
      try {
        localStorage.removeItem(LS_KEY);
      } catch {
        /* ignore */
      }
    } catch {
      setError('Network communication error');
    } finally {
      setSubmitting(false);
    }
  }, [problems, langs, codes, token, LS_KEY]);

  handleSubmitRef.current = handleSubmit;

  useEffect(() => {
    if (secondsLeft === 0 && !submitting && !submitResult) {
      void handleSubmit(true);
    }
  }, [secondsLeft, submitting, submitResult, handleSubmit]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[#050B18] text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-[#1685FF] border-t-transparent shadow-lg shadow-sky-500/20" />
          <p className="text-xs font-bold uppercase tracking-widest text-[#BAE6FD]">
            Initializing Coding IDE Sandbox...
          </p>
        </div>
      </div>
    );
  }

  // Completion State
  if (submitResult) {
    if (submitResult.pending) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#050B18] p-6 font-sans text-white">
          <div className="mx-auto max-w-xl rounded-3xl border border-[#1685FF]/40 bg-[#0B1930] p-10 text-center shadow-2xl">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[#1685FF]/20 text-[#BAE6FD] shadow-lg shadow-sky-500/20">
              <div className="h-8 w-8 animate-spin rounded-full border-3 border-[#34D399] border-t-transparent" />
            </div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight">
              Evaluating Code Submission
            </h1>
            <p className="mt-3 text-sm text-[#94A3B8] leading-relaxed">
              Our automated proctoring sandbox is running hidden test suites and complexity benchmarks. This takes approximately 1–2 minutes.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs font-bold text-amber-400">
              <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
              Do not close or refresh this tab.
            </div>
          </div>
        </div>
      );
    }

    if (submitResult.hidden_summary?.startsWith('Evaluation failed')) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-[#050B18] p-6 font-sans text-white">
          <div className="mx-auto max-w-xl rounded-3xl border border-red-500/30 bg-[#0B1930] p-10 text-center shadow-2xl">
            <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/10 text-red-400">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h1 className="text-2xl font-extrabold text-white">Evaluation Encountered an Issue</h1>
            <p className="mt-3 text-sm text-[#94A3B8]">{submitResult.hidden_summary}</p>
            <div className="mt-8">
              <button
                type="button"
                onClick={() => router.push(`/candidate/portal/${token}`)}
                className="rounded-xl bg-[#1685FF] px-6 py-3 text-xs font-extrabold text-white shadow-lg hover:bg-[#0EA5E9] transition-all"
              >
                Return to Candidate Portal
              </button>
            </div>
          </div>
        </div>
      );
    }

    const failed = threshold !== null && submitResult.score_pct < threshold;

    return (
      <div className="assessments-root flex min-h-screen items-center justify-center bg-[var(--assessment-surface)] p-6 font-sans text-[var(--assessment-on-surface)]">
        <div className="mx-auto w-full max-w-4xl space-y-6">
          <div className="rounded-2xl border border-[var(--assessment-outline-variant)] bg-gradient-to-br from-[#1685FF] to-[#22D3EE] p-12 text-center text-white shadow-lg shadow-sky-500/20">
            <h1 className="text-4xl font-semibold mb-4 tracking-tight">
              {failed ? 'Assessment over' : 'Assessment complete'}
            </h1>
            <h2 className="text-2xl font-medium">Thank you!</h2>
          </div>
          <div className="space-y-4 rounded-2xl border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] p-6">
            {failed ? (
              <p className="text-[15px] text-[var(--assessment-on-surface-variant)]">
                Unfortunately, you did not meet the criteria required to continue to the next round. We
                appreciate your time and interest.
              </p>
            ) : (
              <>
                <p className="text-[15px] text-[var(--assessment-on-surface-variant)]">
                  We have received your Assessment form.
                </p>
                <p className="text-[15px] text-[var(--assessment-on-surface-variant)]">
                  Please return to the portal to check your application status or continue to the next
                  round.
                </p>
              </>
            )}
            <div className="mt-6">
              <button
                type="button"
                onClick={() => router.push(`/candidate/portal/${token}`)}
                className="rounded-xl bg-[var(--assessment-primary)] px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:opacity-90 transition-colors"
              >
                Return to portal
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CodingProctorSession
      portalToken={token}
      disabled={Boolean(submitResult)}
      onForceSubmit={() => {
        void handleSubmitRef.current(true);
      }}
    >
      {({ ready, recording, proctorAlert, dismissProctorAlert, mediaStrikeCount, focusStrikeCount }) => (
    <div className={`assessments-root flex h-screen flex-col bg-[var(--assessment-surface)] text-[var(--assessment-on-surface)] font-sans overflow-hidden select-none ${ready ? '' : 'pointer-events-none opacity-40'}`}>
      {/* Timer Warning Banner */}
      {timerWarning && secondsLeft !== null && secondsLeft > 0 && (
        <div className="flex-shrink-0 flex items-center justify-between bg-red-600 px-5 py-2 text-white text-xs font-bold">
          <span>⚠️ Final Warning: Only {formatTime(secondsLeft)} remaining! Please submit your code soon.</span>
          <button
            onClick={() => setTimerWarning(false)}
            className="ml-4 text-white opacity-80 hover:opacity-100 font-bold"
          >
            ✕
          </button>
        </div>
      )}

      {proctorAlert ? (
        <div className="flex-shrink-0 flex items-center justify-between bg-amber-600/90 px-5 py-2 text-white text-xs font-bold">
          <span>{proctorAlert}</span>
          <button
            type="button"
            onClick={dismissProctorAlert}
            className="ml-4 text-white opacity-80 hover:opacity-100 font-bold"
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* Header Bar */}
      <header className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-[#293B57] bg-[#0B1930] px-5">
        {/* Left: Branding & Breadcrumbs */}
        <div className="flex items-center gap-4">
          <InterviewRecBadge elapsed={recElapsed} active={recording} compact />
          <div className="flex items-center gap-2 text-sm font-extrabold text-white">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#1685FF]/20 border border-[#1685FF]/40 text-[#BAE6FD]">
              <Code2 className="h-4 w-4" />
            </div>
            CodeVox Coding Assessment
          </div>

          <div className="h-4 w-px bg-[#293B57] hidden sm:block" />

          <div className="hidden sm:flex items-center gap-2 text-xs font-semibold text-[#94A3B8]">
            <span className="text-[#34D399] font-bold">
              Problem {activeProblemIdx + 1} of {problems.length || 1}
            </span>
          </div>

          {/* Problem Selector Pills */}
          {problems.length > 1 && (
            <div className="hidden md:flex items-center gap-1 rounded-full border border-[#293B57] bg-[#050B18] p-1">
              {problems.map((p, i) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setActiveProblemIdx(i);
                    setSelectedTestCaseIdx(0);
                  }}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold transition-all ${
                    i === activeProblemIdx
                      ? 'bg-[#1685FF] text-white shadow-md'
                      : 'text-[#94A3B8] hover:bg-[#0B1930]'
                  }`}
                >
                  {i + 1}
                </button>
              ))}
              <div className="w-px h-3 bg-[#293B57] mx-1" />
              <button
                disabled={activeProblemIdx === 0}
                onClick={() => {
                  setActiveProblemIdx((prev) => prev - 1);
                  setSelectedTestCaseIdx(0);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[#94A3B8] hover:bg-[#0B1930] disabled:opacity-30"
              >
                &lt;
              </button>
              <button
                disabled={activeProblemIdx === problems.length - 1}
                onClick={() => {
                  setActiveProblemIdx((prev) => prev + 1);
                  setSelectedTestCaseIdx(0);
                }}
                className="flex h-6 w-6 items-center justify-center rounded-full text-[#94A3B8] hover:bg-[#0B1930] disabled:opacity-30"
              >
                &gt;
              </button>
            </div>
          )}
        </div>

        {/* Center: Timer */}
        {secondsLeft !== null && (
          <div
            className={`hidden md:flex items-center gap-2 rounded-full px-4 py-1.5 text-xs font-bold border transition-all ${
              secondsLeft < 300
                ? 'bg-red-500/10 border-red-500/30 text-red-400 animate-pulse'
                : 'bg-[#050B18] border-[#293B57] text-[#BAE6FD]'
            }`}
          >
            <Clock className={`h-3.5 w-3.5 ${secondsLeft < 300 ? 'text-red-400' : 'text-[#1685FF]'}`} />
            <span>{formatTime(secondsLeft)} Remaining</span>
          </div>
        )}

        {/* Right: Actions */}
        <div className="flex items-center gap-3">
          {(mediaStrikeCount > 0 || focusStrikeCount > 0) && (
            <div className="hidden lg:flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[10px] font-bold text-amber-300">
              {focusStrikeCount > 0 ? <span>Focus {focusStrikeCount}</span> : null}
              {mediaStrikeCount > 0 ? <span>Media {mediaStrikeCount}</span> : null}
            </div>
          )}

          <button
            onClick={handleRun}
            disabled={!ready || running || submitting}
            className="flex items-center gap-2 rounded-xl border border-[#293B57] bg-[#050B18] px-4 py-2 text-xs font-extrabold text-white transition-all hover:border-[#34D399] hover:text-[#34D399] disabled:opacity-40"
          >
            {running ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#34D399] border-t-transparent" />
            ) : (
              <Play className="h-3.5 w-3.5 text-[#34D399] fill-[#34D399]" />
            )}
            Run Code
          </button>

          <button
            onClick={() => void handleSubmit(false)}
            disabled={!ready || running || submitting}
            className="flex items-center gap-2 rounded-xl bg-[#1685FF] px-4 py-2 text-xs font-black text-white shadow-lg shadow-sky-500/20 transition-all hover:bg-[#0EA5E9] disabled:opacity-40"
          >
            <Send className="h-3.5 w-3.5" /> Submit Assessment
          </button>

          <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-xl bg-[#050B18] border border-[#293B57] text-[#BAE6FD]">
            <User className="h-4 w-4" />
          </div>
        </div>
      </header>

      {/* Main Split Panels */}
      <div className="flex flex-1 overflow-hidden select-text">
        <PanelGroup direction="horizontal">
          {/* LEFT: Problem Specification Panel */}
          <Panel defaultSize={45} minSize={25} className="flex flex-col bg-[#0B1930] border-r border-[#293B57]">
            {/* Tabs */}
            <div className="flex h-11 border-b border-[#293B57] px-4 pt-2 bg-[#050B18]/50">
              <button className="flex items-center border-b-2 border-[#1685FF] px-4 pb-2 text-xs font-bold text-white">
                Problem Description
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div>
                <h1 className="text-xl font-black text-white tracking-tight">
                  {activeProblemIdx + 1}. {activeProblem?.title || 'Coding Problem'}
                </h1>
              </div>

              {/* Meta Badges */}
              <div className="flex flex-wrap items-center gap-2">
                {activeProblem?.difficulty && (() => {
                  const d = activeProblem.difficulty.toLowerCase();
                  const colors =
                    d === 'easy'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : d === 'hard'
                      ? 'bg-red-500/10 text-red-400 border-red-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20';
                  return (
                    <span className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${colors}`}>
                      {activeProblem.difficulty}
                    </span>
                  );
                })()}

                <span className="rounded-lg border border-[#293B57] bg-[#050B18] px-2.5 py-1 text-[11px] font-semibold text-[#BAE6FD]">
                  Time: {activeProblem?.time_limit_minutes ?? 5} mins
                </span>
                <span className="rounded-lg border border-[#293B57] bg-[#050B18] px-2.5 py-1 text-[11px] font-semibold text-[#BAE6FD]">
                  Points: {activeProblem?.marks ?? 10} pts
                </span>
              </div>

              {/* Markdown Description */}
              <div className="max-w-none space-y-4 text-xs leading-relaxed text-[#E2E8F0]">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={{
                    p: ({ children }) => <p className="mb-3 leading-6 text-[#E2E8F0]">{children}</p>,
                    h2: ({ children }) => (
                      <h2 className="mt-5 mb-2 text-sm font-bold text-white border-b border-[#293B57] pb-1">
                        {children}
                      </h2>
                    ),
                    h3: ({ children }) => <h3 className="mt-3 mb-1 text-xs font-bold text-[#BAE6FD]">{children}</h3>,
                    strong: ({ children }) => <strong className="font-bold text-white">{children}</strong>,
                    code: ({ children }) => (
                      <code className="rounded border border-[#1685FF]/40 bg-[#050B18] px-1.5 py-0.5 font-mono text-[11px] text-[#34D399]">
                        {children}
                      </code>
                    ),
                    pre: ({ children }) => (
                      <pre className="my-3 overflow-x-auto rounded-xl border border-[#293B57] bg-[#050B18] p-4 font-mono text-xs text-[#BAE6FD]">
                        {children}
                      </pre>
                    ),
                    ul: ({ children }) => <ul className="my-2 space-y-1 pl-4 list-disc text-[#BAE6FD]">{children}</ul>,
                    ol: ({ children }) => <ol className="my-2 space-y-1 pl-4 list-decimal text-[#BAE6FD]">{children}</ol>,
                  }}
                >
                  {activeProblem?.description_md || 'No description provided.'}
                </ReactMarkdown>
              </div>

              {/* Examples */}
              {activeProblem?.examples && activeProblem.examples.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#BAE6FD]">Sample Cases</h3>
                  {activeProblem.examples.map((ex, i) => (
                    <div key={i} className="rounded-xl border border-[#293B57] bg-[#050B18]/70 p-4">
                      <p className="mb-2 text-[10px] font-black uppercase tracking-widest text-[#94A3B8]">
                        Example {i + 1}
                      </p>
                      <div className="space-y-1 font-mono text-xs text-[#E2E8F0]">
                        <div>
                          <span className="text-[#94A3B8]">Input:</span> {ex.input}
                        </div>
                        <div>
                          <span className="text-[#94A3B8]">Output:</span> {ex.output}
                        </div>
                        {ex.explanation && (
                          <div className="text-[11px] text-[#BAE6FD] mt-1 italic">
                            Explanation: {ex.explanation}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Constraints */}
              {activeProblem?.constraints && (
                <div className="space-y-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#BAE6FD]">Constraints</h3>
                  <div className="rounded-xl border border-[#293B57] bg-[#050B18]/70 p-4 font-mono text-xs text-[#E2E8F0] whitespace-pre-wrap">
                    {activeProblem.constraints}
                  </div>
                </div>
              )}
            </div>
          </Panel>

          <PanelResizeHandle className="relative flex w-1.5 items-center justify-center bg-[#050B18] hover:bg-[#1685FF] transition-colors cursor-col-resize z-10" />

          {/* RIGHT: Monaco Editor & Test Console */}
          <Panel defaultSize={55} minSize={30} className="flex flex-col bg-[#050B18]">
            <PanelGroup direction="vertical">
              {/* Editor Section */}
              <Panel defaultSize={60} minSize={25} className="flex flex-col bg-[#0B1930]">
                {/* Editor Header Toolbar */}
                <div className="flex h-11 flex-shrink-0 items-center justify-between border-b border-[#293B57] bg-[#050B18]/80 px-4">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 rounded-lg border border-[#293B57] bg-[#0B1930] px-3 py-1">
                      <Code2 className="h-3.5 w-3.5 text-[#1685FF]" />
                      <select
                        value={activeLang}
                        onChange={(e) => onLanguageChange(e.target.value)}
                        disabled={isSqlProblem}
                        className="bg-transparent text-xs font-bold text-white outline-none cursor-pointer"
                      >
                        {isSqlProblem ? (
                          <option value="sql" className="bg-[#0B1930] text-white">SQL</option>
                        ) : (
                          languages.map((l) => (
                            <option key={l} value={l} className="bg-[#0B1930] text-white">
                              {LANG_DISPLAY[l] ?? l.toUpperCase()}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    <span className="text-[11px] font-medium text-[#94A3B8]">
                      • Auto-saved locally
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[#94A3B8]">
                    <Settings className="h-4 w-4 cursor-pointer hover:text-white transition-colors" />
                    <Maximize className="h-4 w-4 cursor-pointer hover:text-white transition-colors" />
                  </div>
                </div>

                {/* Monaco Editor Component */}
                <div className="flex-1 relative border-b border-[#293B57]">
                  <MonacoEditor
                    height="100%"
                    language={LANG_MONACO[activeLang] ?? 'plaintext'}
                    value={activeCode}
                    onChange={(v) => setCode(v ?? '')}
                    theme="vs-dark"
                    options={{
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                      minimap: { enabled: false },
                      lineNumbers: 'on',
                      scrollBeyondLastLine: false,
                      wordWrap: 'on',
                      padding: { top: 12 },
                      renderLineHighlight: 'gutter',
                      scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
                    }}
                  />
                </div>
              </Panel>

              <PanelResizeHandle className="relative flex h-1.5 items-center justify-center bg-[#050B18] hover:bg-[#1685FF] transition-colors cursor-row-resize z-10" />

              {/* Test Cases Console */}
              <Panel defaultSize={40} minSize={20} className="flex flex-col bg-[#0B1930]">
                {/* Console Tabs */}
                <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-[#293B57] bg-[#050B18]/80 px-4">
                  <div className="flex h-full items-end gap-2">
                    <button className="flex h-full items-center border-b-2 border-[#34D399] px-3 text-xs font-bold text-white">
                      {isSqlProblem ? 'Query Output' : 'Visible Test Cases'}
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRun}
                      disabled={running}
                      className="flex items-center gap-1.5 text-xs font-extrabold text-[#34D399] hover:text-[#34D399] transition-colors disabled:opacity-40"
                    >
                      {running ? (
                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-[#34D399] border-t-transparent" />
                      ) : (
                        <Play className="h-3 w-3 fill-[#34D399]" />
                      )}
                      Run Code
                    </button>
                  </div>
                </div>

                {/* Results & Case Inspector */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  {error && (
                    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs font-semibold text-red-400">
                      {error}
                    </div>
                  )}

                  {/* Summary Banner */}
                  {results && results.length > 0 && !isSqlProblem && visibleCases.length > 0 && (
                    <div
                      className={`flex items-center justify-between rounded-xl px-4 py-2.5 border font-bold text-xs ${
                        results.every((r) => r.passed)
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                          : 'border-red-500/30 bg-red-500/10 text-red-400'
                      }`}
                    >
                      <span>
                        {results.filter((r) => r.passed).length} / {results.length} Test Cases Passed
                      </span>
                      <span>{results.every((r) => r.passed) ? '✅ All Passed' : '❌ Needs Revision'}</span>
                    </div>
                  )}

                  {/* Case Buttons */}
                  {!isSqlProblem && visibleCases.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {visibleCases.map((tc, idx) => {
                        const r = results?.find((x) => x.id === tc.id);
                        const isSelected = selectedTestCaseIdx === idx;

                        let pillStyle = isSelected
                          ? 'bg-[#1685FF] text-white border-[#BAE6FD]'
                          : 'bg-[#050B18] text-[#BAE6FD] border-[#293B57] hover:border-[#1685FF]';
                        let icon = null;

                        if (r) {
                          if (r.passed) {
                            pillStyle = isSelected
                              ? 'bg-emerald-600 text-white border-emerald-400'
                              : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
                            icon = <CheckCircle2 className="h-3 w-3" />;
                          } else {
                            pillStyle = isSelected
                              ? 'bg-red-600 text-white border-red-400'
                              : 'bg-red-500/10 text-red-400 border-red-500/30';
                            icon = <XCircle className="h-3 w-3" />;
                          }
                        }

                        return (
                          <button
                            key={`tc-${tc.id || ''}-${idx}`}
                            onClick={() => setSelectedTestCaseIdx(idx)}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-bold transition-all ${pillStyle}`}
                          >
                            {icon} Case {idx + 1}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Selected Case Inspection */}
                  {visibleCases[selectedTestCaseIdx] && (
                    <div className="space-y-3">
                      {!isSqlProblem && (
                        <div>
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">
                            Input
                          </p>
                          <div className="rounded-xl border border-[#293B57] bg-[#050B18] p-3 font-mono text-xs text-[#E2E8F0] whitespace-pre-wrap">
                            {visibleCases[selectedTestCaseIdx].input}
                          </div>
                        </div>
                      )}

                      <div className={`grid ${isSqlProblem ? 'grid-cols-1' : 'grid-cols-2'} gap-3`}>
                        {!isSqlProblem && (
                          <div>
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">
                              Expected Output
                            </p>
                            <div className="rounded-xl border border-[#293B57] bg-[#050B18] p-3 font-mono text-xs text-[#E2E8F0] whitespace-pre-wrap">
                              {visibleCases[selectedTestCaseIdx].expected_output ?? '(none)'}
                            </div>
                          </div>
                        )}

                        {results?.find((x) => x.id === visibleCases[selectedTestCaseIdx].id) && (
                          <div>
                            <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-[#94A3B8]">
                              {isSqlProblem ? 'Query Output' : 'Your Output'}
                            </p>
                            <div
                              className={`rounded-xl border p-3 font-mono text-xs whitespace-pre-wrap ${
                                results.find((x) => x.id === visibleCases[selectedTestCaseIdx].id)
                                  ?.passed
                                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                                  : 'border-red-500/30 bg-red-500/10 text-red-400'
                              }`}
                            >
                              {results.find((x) => x.id === visibleCases[selectedTestCaseIdx].id)
                                ?.stdout || '(empty stdout)'}
                            </div>
                          </div>
                        )}
                      </div>

                      {results?.find((x) => x.id === visibleCases[selectedTestCaseIdx].id)
                        ?.stderr && (
                        <div>
                          <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-red-400">
                            Runtime / Compiler Error
                          </p>
                          <div className="rounded-xl border border-red-500/30 bg-red-950/50 p-3 font-mono text-xs text-red-400 whitespace-pre-wrap">
                            {
                              results.find((x) => x.id === visibleCases[selectedTestCaseIdx].id)
                                ?.stderr
                            }
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
    </div>
      )}
    </CodingProctorSession>
  );
}
