'use client';

import { use, useState, useCallback, useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { getCodingProblem, runCodingCode, submitCodingCode } from '@/lib/candidate-api';
import { Play, Send, Clock, ShieldCheck, Settings, Maximize, User, Code2, Menu, CheckCircle2, XCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

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
  python: 'python', javascript: 'javascript', php: 'php', sql: 'sql'
};

const LANG_DISPLAY: Record<string, string> = {
  python: 'Python (3.11)', javascript: 'JavaScript (Node 20)', php: 'PHP (8.2)', sql: 'SQL'
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

  // Timer
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [timerWarning, setTimerWarning] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // LocalStorage key for persisting code
  const LS_KEY = `coding_draft_${token}`;

  useEffect(() => {
    getCodingProblem(token)
      .then((res) => {
        if (!res.success) { setError(res.message ?? 'Failed to load problem'); return; }
        const d = res.data;
        const loadedProblems = d.problems || [];
        setProblems(loadedProblems);
        const loadedLangs = d.languages ?? ['python'];
        setLanguages(loadedLangs);
        setThreshold(d.threshold ?? null);
        
        const initialCodes: Record<string, string> = {};
        const initialLangs: Record<string, string> = {};
        const initialResults: Record<string, TestResult[]> = {};

        const initLang = loadedLangs[0] ?? 'python';

        loadedProblems.forEach((p: Problem) => {
           // Pick first language that has starter code, fallback to first available language
           const bestLang = loadedLangs.find((l: string) => p.starter_code?.[l]) ?? loadedLangs[0] ?? 'python';
           initialLangs[p.id] = bestLang;
           initialCodes[p.id] = p.starter_code?.[bestLang] ?? '';
        });

        // Restore from localStorage if available (overrides starter code)
        try {
          const saved = localStorage.getItem(`coding_draft_${token}`);
          if (saved) {
            const { codes: savedCodes, langs: savedLangs } = JSON.parse(saved);
            if (savedCodes) Object.assign(initialCodes, savedCodes);
            if (savedLangs) Object.assign(initialLangs, savedLangs);
          }
        } catch { /* ignore */ }

        // Restore from last_submission
        if (d.last_submission && d.last_submission.problem_submissions) {
           Object.keys(d.last_submission.problem_submissions).forEach(pid => {
              const pSub = d.last_submission.problem_submissions[pid];
              if (pSub.language) initialLangs[pid] = pSub.language;
              if (pSub.sourceCode) initialCodes[pid] = pSub.sourceCode;
              if (pSub.testResults) initialResults[pid] = pSub.testResults;
           });
        }

        if (d.last_submission && ['grading', 'submitted', 'error'].includes(d.last_submission.status)) {
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
              hidden_summary: d.last_submission.status === 'error' ? 'Evaluation failed. Please contact support.' : null
           });
        }
        
        setCodes(initialCodes);
        setLangs(initialLangs);
        setAllResults(initialResults);
        setSecondsLeft((d.time_limit_minutes ?? 60) * 60);
      })
      .catch(() => setError('Failed to load problem'))
      .finally(() => setLoading(false));
  }, [token]);

  // Start timer
  useEffect(() => {
    if (secondsLeft === null) return;
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s === null || s <= 1) return 0;
        const next = s - 1;
        if (next <= 300 && !timerWarning) setTimerWarning(true);
        return next;
      });
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [secondsLeft !== null]);

  // Auto-save codes to localStorage whenever codes or langs change
  useEffect(() => {
    if (Object.keys(codes).length === 0) return;
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ codes, langs }));
    } catch { /* ignore */ }
  }, [codes, langs]);

  // Poll for background grading completion
  useEffect(() => {
    if (submitResult?.pending) {
      const intervalId = setInterval(() => {
        getCodingProblem(token).then((res) => {
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
              hidden_summary: status === 'error' ? 'Evaluation failed. Please contact support.' : null
            });
            clearInterval(intervalId);
          }
        }).catch(() => {});
      }, 3000);
      return () => clearInterval(intervalId);
    }
  }, [submitResult?.pending, token]);

  const activeProblem = problems[activeProblemIdx];
  const isSqlProblem = activeProblem ? (activeProblem.workspace_type?.toLowerCase() === 'sql' || activeProblem.workspace_type?.toLowerCase() === 'database' || !!activeProblem.starter_code?.['sql'] || activeProblem.title.toLowerCase().includes('database') || activeProblem.title.toLowerCase().includes('sql')) : false;
  const activeCode = activeProblem ? (codes[activeProblem.id] ?? '') : '';
  const activeLang = activeProblem ? (langs[activeProblem.id] ?? 'python') : 'python';
  const visibleCases = activeProblem?.visible_test_cases ?? [];
  const results = activeProblem ? (allResults[activeProblem.id] ?? null) : null;

  const setCode = (val: string) => {
     if (!activeProblem) return;
     setCodes(prev => ({ ...prev, [activeProblem.id]: val }));
  };

  const onLanguageChange = useCallback((lang: string) => {
    if (!activeProblem) return;
    const currentLang = langs[activeProblem.id] || 'python';
    const currentCode = codes[activeProblem.id] || '';
    const oldStarterCode = activeProblem.starter_code?.[currentLang] || '';

    setLangs(prev => ({ ...prev, [activeProblem.id]: lang }));
    
    // Only overwrite if the user hasn't written any custom code (it's empty or equals the old starter code)
    if (!currentCode.trim() || currentCode.trim() === oldStarterCode.trim()) {
       setCodes(prev => ({ ...prev, [activeProblem.id]: (activeProblem.starter_code?.[lang] ?? '') }));
    }
  }, [activeProblem, codes, langs]);

  // Effect to force SQL language if it's a SQL problem
  useEffect(() => {
    if (isSqlProblem && activeProblem && langs[activeProblem.id] !== 'sql') {
       onLanguageChange('sql');
    }
  }, [isSqlProblem, activeProblem, langs, onLanguageChange]);

  const handleRun = async () => {
    if (!activeProblem) return;
    setRunning(true);
    setError(null);
    
    // clear current problem results
    setAllResults(prev => ({ ...prev, [activeProblem.id]: [] }));

    try {
      const res = await runCodingCode(token, activeProblem.id, activeLang, activeCode);
      if (!res.success) { setError(res.message ?? 'Run failed'); return; }
      setAllResults(prev => ({ ...prev, [activeProblem.id]: res.data.results }));
      setSelectedTestCaseIdx(0);
    } catch { setError('Network error'); }
    finally { setRunning(false); }
  };

  const handleSubmit = async (force: boolean = false) => {
    if (!force && !confirm('Submit your final solution? You cannot change it after submitting.')) return;
    setSubmitting(true);
    setError(null);
    try {
      // transform state for backend
      const submissions: Record<string, { language: string; source_code: string }> = {};
      problems.forEach(p => {
         submissions[p.id] = { language: langs[p.id] || 'python', source_code: codes[p.id] || '' };
      });

      const res = await submitCodingCode(token, submissions);
      if (!res.success) { setError(res.message ?? 'Submit failed'); return; }
      setSubmitResult(res.data);
      if (timerRef.current) clearInterval(timerRef.current);
      try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
    } catch { setError('Network error'); }
    finally { setSubmitting(false); }
  };

  // Auto-submit when time completes
  useEffect(() => {
    if (secondsLeft === 0 && !submitting && !submitResult) {
      handleSubmit(true);
    }
  }, [secondsLeft]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60); const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  if (loading) return (
    <div className="flex h-screen items-center justify-center bg-[var(--assessment-surface-container)] text-slate-900">
      <div className="text-center">
        <div className="mb-4 h-12 w-12 animate-spin rounded-full border-4 border-[var(--color-primary)] border-t-transparent mx-auto" />
        <p className="text-slate-500 font-medium">Loading Assessment...</p>
      </div>
    </div>
  );

  if (submitResult) {
    if (submitResult.pending) {
      return (
        <div className="min-h-screen bg-slate-50 font-sans">
          <div className="mx-auto max-w-2xl space-y-6 p-6 py-12 text-center">
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-8">
              <h1 className="text-2xl font-semibold text-amber-900">Evaluating your submission</h1>
              <p className="mt-2 text-sm text-amber-800">
                This usually takes a few minutes. This page will update when grading finishes.
              </p>
              <p className="mt-4 text-sm font-bold text-red-600 animate-pulse">
                ⚠️ Please do not close this window or go back.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (submitResult.hidden_summary?.startsWith('Evaluation failed')) {
      return (
        <div className="min-h-screen bg-slate-50 font-sans">
          <div className="mx-auto max-w-2xl space-y-6 p-6 py-12 text-center">
            <div className="rounded-xl border border-red-200 bg-red-50 p-8">
              <h1 className="text-2xl font-semibold text-red-900">Evaluation failed</h1>
              <p className="mt-2 text-sm text-red-800">
                {submitResult.hidden_summary}
              </p>
            </div>
            <div className="mt-6">
              <button
                type="button"
                onClick={() => router.push(`/candidate/portal/${token}`)}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm"
              >
                Back to portal
              </button>
            </div>
          </div>
        </div>
      );
    }

    const failed = threshold !== null && submitResult.score_pct < threshold;

    if (failed) {
      return (
        <div className="min-h-screen bg-slate-50 font-sans">
          <div className="mx-auto max-w-4xl space-y-8 p-6 py-12">
            <div className="bg-[#005ea2] text-white p-12 text-center rounded-sm shadow-sm">
              <h1 className="text-4xl font-semibold mb-4 tracking-tight">Assessment complete</h1>
              <h2 className="text-2xl font-medium">Thank you!</h2>
            </div>
            <div className="px-2 text-gray-800 space-y-4">
              <p className="text-[15px]">Unfortunately, your score did not meet the requirement to advance to the next stage of the process. We sincerely appreciate the time and effort you invested in this assessment.</p>
              <div className="mt-6 rounded-xl border border-slate-200 bg-[var(--assessment-surface-container)] p-6 shadow-sm">
                <p className="text-3xl font-black text-[var(--color-primary)] mb-2">{submitResult.score_pct}%</p>
                <p className="text-slate-600 font-medium">Required passing score: {threshold}%</p>
                <p className="text-slate-500 text-sm mt-2">{submitResult.passed} / {submitResult.total} Test Cases Passed</p>
              </div>
              <div className="mt-6">
                <button
                  type="button"
                  onClick={() => router.push(`/candidate/portal/${token}`)}
                  className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
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
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="mx-auto max-w-4xl space-y-8 p-6 py-12">
          <div className="bg-[#005ea2] text-white p-12 text-center rounded-sm shadow-sm">
            <h1 className="text-4xl font-semibold mb-4 tracking-tight">
              {threshold === null ? 'Round Completed' : 'Congratulations!'}
            </h1>
            <h2 className="text-2xl font-medium">You completed this round.</h2>
          </div>
          <div className="px-2 text-gray-800 space-y-4">
            <div className="mt-6 rounded-xl border border-slate-200 bg-[var(--assessment-surface-container)] p-6 shadow-sm">
              <p className="text-3xl font-black text-[var(--color-primary)] mb-2">{submitResult.score_pct}%</p>
              <p className="text-slate-600 font-medium">Your score for this round</p>
              <p className="text-slate-500 text-sm mt-2">{submitResult.passed} / {submitResult.total} Test Cases Passed</p>
            </div>
            <div className="mt-6">
              <button
                type="button"
                onClick={() => router.push(`/candidate/portal/${token}`)}
                className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 transition-colors"
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
    <div className="flex h-screen flex-col bg-[var(--assessment-surface-container)] text-slate-900 font-sans overflow-hidden">
      
      {/* Timer Warning Banner */}
      {timerWarning && secondsLeft !== null && secondsLeft > 0 && (
        <div className="flex-shrink-0 flex items-center justify-between bg-red-600 px-5 py-2 text-white text-sm font-bold">
          <span>⚠️ Only {formatTime(secondsLeft)} remaining! Please submit your solutions soon.</span>
          <button onClick={() => setTimerWarning(false)} className="ml-4 text-white opacity-70 hover:opacity-100 font-bold text-base leading-none">✕</button>
        </div>
      )}

      {/* 1. Header (Top Navigation) */}
      <header className="flex h-[60px] flex-shrink-0 items-center justify-between border-b border-slate-200 bg-[var(--assessment-surface-container)] px-5">
        
        {/* Left: Branding & Breadcrumbs */}
        <div className="flex items-center gap-5">
          <div className="flex items-center gap-2 text-[15px] font-bold text-[var(--color-on-primary-container)]">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-[var(--color-primary)]">
              <Code2 className="h-4 w-4 text-white" />
            </div>
          CodeVox Assessment Platform
          </div>
          <div className="h-5 w-px bg-slate-300"></div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
            <span className="hidden sm:inline">Coding Assessment</span>
            <span className="hidden sm:inline text-slate-300">/</span>
            <span className="text-[var(--color-primary)] font-bold flex items-center gap-2">
              Problem {activeProblemIdx + 1} of {problems.length}
            </span>
            <span className="text-slate-300 mx-1">/</span>
            <span className="text-slate-400 hover:text-slate-600 cursor-pointer">Overview</span>
          </div>

          {/* Problem Navigator */}
          <div className="ml-4 hidden md:flex items-center gap-1 bg-slate-100 rounded-full p-1 border border-slate-200">
             {problems.map((p, i) => (
                <button 
                  key={p.id}
                  onClick={() => { setActiveProblemIdx(i); setSelectedTestCaseIdx(0); }}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                    i === activeProblemIdx ? 'bg-[var(--color-primary)] text-white shadow' : 'text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  {i + 1}
                </button>
             ))}
             <div className="w-px h-4 bg-slate-300 mx-1"></div>
             <button 
               disabled={activeProblemIdx === 0}
               onClick={() => { setActiveProblemIdx(prev => prev - 1); setSelectedTestCaseIdx(0); }}
               className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:opacity-50"
             >&lt;</button>
             <button 
               disabled={activeProblemIdx === problems.length - 1}
               onClick={() => { setActiveProblemIdx(prev => prev + 1); setSelectedTestCaseIdx(0); }}
               className="flex h-6 w-6 items-center justify-center rounded-full text-slate-400 hover:bg-slate-200 hover:text-slate-600 disabled:opacity-50"
             >&gt;</button>
          </div>
        </div>

        {/* Center: Timer */}
        {secondsLeft !== null && (
          <div className={`hidden md:flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold border transition-all ${
            secondsLeft < 300
              ? 'bg-red-50 border-red-300 text-red-700 animate-pulse'
              : 'bg-slate-100 border-slate-200 text-slate-700'
          }`}>
            <Clock className={`h-4 w-4 ${secondsLeft < 300 ? 'text-red-500' : 'text-slate-500'}`} />
            <span>{formatTime(secondsLeft)} remaining</span>
          </div>
        )}

        {/* Right: Actions */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            <ShieldCheck className="h-4 w-4" /> Proctor Active
          </div>
          <button
            onClick={handleRun}
            disabled={running || submitting}
            className="flex items-center gap-2 rounded border border-slate-300 bg-[var(--assessment-surface-container)] px-4 py-1.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
          >
            {running ? <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" /> : <Play className="h-4 w-4 text-emerald-600 fill-emerald-600" />}
            Run Code
          </button>
          <button
            onClick={() => handleSubmit(false)}
            disabled={running || submitting}
            className="flex items-center gap-2 rounded bg-[var(--color-primary)] px-4 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-[var(--color-primary-dark)] disabled:opacity-50"
          >
            <Send className="h-4 w-4" /> Submit Assessment
          </button>
          <div className="ml-2 flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 font-bold text-slate-600 shadow-inner">
            <User className="h-5 w-5 text-slate-500" />
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        <PanelGroup direction="horizontal">
        
        {/* LEFT PANEL: Problem Description */}
        <Panel defaultSize={45} minSize={25} className="flex flex-col bg-[var(--assessment-surface-container)]">
          
          {/* Tabs */}
          <div className="flex h-11 border-b border-slate-200 px-2 pt-2">
            <button className="flex items-center border-b-2 border-[var(--color-primary)] px-4 pb-2 text-sm font-bold text-[var(--color-on-primary-container)]">
              Problem Description
            </button>
            <button className="flex items-center border-b-2 border-transparent px-4 pb-2 text-sm font-medium text-slate-500 hover:text-slate-800">
              Submissions
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            <div className="mb-4">
              <h1 className="text-2xl font-black text-slate-900">{activeProblemIdx + 1}. {activeProblem?.title}</h1>
            </div>
            
            {/* Badges */}
            <div className="mb-8 flex flex-wrap items-center gap-2">
              {activeProblem?.difficulty && (() => {
                const d = activeProblem.difficulty.toLowerCase();
                const colors = d === 'easy'
                  ? 'bg-emerald-100 text-emerald-800'
                  : d === 'hard'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-amber-100 text-amber-800';
                return <span className={`rounded ${colors} px-2 py-1 text-xs font-bold capitalize`}>{activeProblem.difficulty}</span>;
              })()}
              <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Time: {activeProblem?.time_limit_minutes ?? 2}.0 min</span>
              <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Memory: 256 MB</span>
              <span className="rounded bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-600">Points: {activeProblem?.marks ?? 10} pts</span>
            </div>

            {/* Markdown Description */}
            <div className="mb-10 max-w-none space-y-4 text-[15px] leading-relaxed text-slate-700">
              <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} rehypePlugins={[rehypeKatex]}
                components={{
                  p: ({ children }) => <p className="mb-3 leading-7 text-slate-700">{children}</p>,
                  h2: ({ children }) => <h2 className="mt-6 mb-3 text-base font-bold text-slate-900 border-b border-slate-100 pb-1">{children}</h2>,
                  h3: ({ children }) => <h3 className="mt-4 mb-2 text-sm font-bold text-slate-800">{children}</h3>,
                  strong: ({ children }) => <strong className="font-bold text-slate-900">{children}</strong>,
                  code: ({ children }) => (
                    <code className="rounded-md bg-slate-100 border border-slate-200 px-1.5 py-0.5 font-mono text-[13px] text-[var(--color-on-primary-container)] font-medium">{children}</code>
                  ),
                  pre: ({ children }) => (
                    <pre className="my-3 overflow-x-auto rounded-xl bg-slate-900 p-4 text-sm text-slate-100 font-mono">{children}</pre>
                  ),
                  ul: ({ children }) => <ul className="my-3 space-y-1.5 pl-5">{children}</ul>,
                  ol: ({ children }) => <ol className="my-3 space-y-1.5 pl-5 list-decimal">{children}</ol>,
                  li: ({ children }) => (
                    <li className="flex items-start gap-2 text-slate-700">
                      <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[var(--color-primary-fixed-dim)]"></span>
                      <span>{children}</span>
                    </li>
                  ),
                  blockquote: ({ children }) => (
                    <blockquote className="my-3 border-l-4 border-[var(--color-primary-fixed-dim)] bg-[var(--color-primary-container)] pl-4 py-2 italic text-slate-600 rounded-r-lg">{children}</blockquote>
                  ),
                  hr: () => <hr className="my-5 border-slate-200" />,
                  table: ({ children }) => <div className="overflow-x-auto my-6 rounded-lg border border-slate-200 shadow-sm"><table className="w-full text-sm text-left text-slate-600">{children}</table></div>,
                  thead: ({ children }) => <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase font-semibold text-slate-600">{children}</thead>,
                  tbody: ({ children }) => <tbody className="divide-y divide-slate-100">{children}</tbody>,
                  tr: ({ children }) => <tr className="hover:bg-slate-50 transition-colors">{children}</tr>,
                  th: ({ children }) => <th className="px-4 py-3 whitespace-nowrap">{children}</th>,
                  td: ({ children }) => <td className="px-4 py-2">{children}</td>,
                }}
              >
                {activeProblem?.description_md || ''}
              </ReactMarkdown>
            </div>

            {/* Examples */}
            {activeProblem?.examples && activeProblem.examples.length > 0 && (
              <>
                <h2 className="mb-4 text-lg font-bold text-slate-900">Examples</h2>
                <div className="space-y-4 mb-10">
                  {activeProblem.examples.map((ex, i) => (
                    <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-5 shadow-sm">
                      <p className="mb-3 text-xs font-black tracking-widest text-slate-400 uppercase">Example {i + 1}</p>
                      <div className="font-mono text-sm text-slate-800 leading-relaxed">
                        <div className="mb-1"><strong>Input:</strong> {ex.input.replace(/\n/g, ', ')}</div>
                        <div className="mb-1"><strong>Output:</strong> {ex.output.replace(/\n/g, ', ')}</div>
                        {ex.explanation && <div className="mt-2 text-slate-600"><strong>Explanation:</strong> {ex.explanation}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Constraints */}
            {activeProblem?.constraints && (
              <div className="mb-10">
                <h2 className="mb-3 text-lg font-bold text-slate-900">Constraints</h2>
                <ul className="list-inside list-disc font-mono text-sm text-slate-700 space-y-1 rounded-xl bg-slate-50 p-5 border border-slate-200">
                  {activeProblem.constraints.split('\n').map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* Follow up Challenge (Mock) */}
            <div className="rounded-xl bg-blue-50 p-5 border border-blue-100 flex items-start gap-3">
               <div className="mt-0.5"><div className="h-4 w-4 rounded-full bg-blue-200 flex items-center justify-center text-blue-700 font-bold text-[10px]">?</div></div>
               <div>
                 <p className="text-sm font-bold text-blue-900 mb-1">Follow-up Challenge</p>
                 <p className="text-sm text-blue-800">Can you come up with an algorithm that is less than O(n²) time complexity?</p>
               </div>
            </div>
          </div>
        </Panel>

        <PanelResizeHandle className="relative flex w-2 items-center justify-center bg-slate-100 hover:bg-[var(--color-primary)] transition-colors cursor-col-resize group z-10 border-x border-slate-200 hover:border-transparent shadow-[inset_1px_0_2px_rgba(0,0,0,0.05)]">
          <div className="h-10 w-1 rounded-full bg-slate-300 group-hover:bg-[var(--assessment-surface-container)]" />
        </PanelResizeHandle>

        {/* RIGHT PANEL: Editor & Console */}
        <Panel defaultSize={55} minSize={30} className="flex flex-col bg-slate-50">
          <PanelGroup direction="vertical">
          
            {/* Editor Panel */}
            <Panel defaultSize={60} minSize={20} className="flex flex-col relative bg-[var(--assessment-surface-container)]">
          {/* Editor Toolbar */}
          <div className="flex h-12 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-slate-100 px-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 rounded border border-slate-200 bg-[var(--assessment-surface-container)] px-3 py-1 shadow-sm">
                <Code2 className="h-4 w-4 text-slate-400" />
                <select
                  value={activeLang}
                  onChange={(e) => onLanguageChange(e.target.value)}
                  disabled={isSqlProblem}
                  className="bg-transparent text-sm font-bold text-slate-700 outline-none cursor-pointer"
                >
                  {isSqlProblem ? <option value="sql">SQL</option> : languages.map((l) => (
                    <option key={l} value={l}>{LANG_DISPLAY[l] ?? l.toUpperCase()}</option>
                  ))}
                </select>
              </div>
              <span className="text-xs font-medium text-slate-400">• Saved just now</span>
            </div>
            <div className="flex items-center gap-3 text-slate-400">
               <Settings className="h-4 w-4 cursor-pointer hover:text-slate-600 transition-colors" />
               <Maximize className="h-4 w-4 cursor-pointer hover:text-slate-600 transition-colors" />
            </div>
          </div>

          {/* Monaco Editor */}
          <div className="flex-1 relative border-b border-slate-200 shadow-[inset_0_2px_4px_rgba(0,0,0,0.02)] bg-[var(--assessment-surface-container)]">
            <MonacoEditor
              height="100%"
              language={LANG_MONACO[activeLang] ?? 'plaintext'}
              value={activeCode}
              onChange={(v) => setCode(v ?? '')}
              theme="light"
              options={{
                fontSize: 14,
                fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                padding: { top: 16 },
                renderLineHighlight: 'gutter',
                scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
              }}
            />
          </div>

          </Panel>

          <PanelResizeHandle className="relative flex h-2 items-center justify-center bg-slate-100 hover:bg-[var(--color-primary)] transition-colors cursor-row-resize group z-10 border-y border-slate-200 hover:border-transparent shadow-[inset_0_1px_2px_rgba(0,0,0,0.05)]">
            <div className="h-1 w-10 rounded-full bg-slate-300 group-hover:bg-[var(--assessment-surface-container)]" />
          </PanelResizeHandle>

          {/* Test Cases Console (Bottom Panel) */}
          <Panel defaultSize={40} minSize={20} className="flex flex-col bg-[var(--assessment-surface-container)]">
            
            {/* Console Tabs */}
            <div className="flex h-10 flex-shrink-0 items-center justify-between border-b border-slate-200 bg-slate-50 px-2 pt-1">
              <div className= "flex h-full items-end">
                <button className="flex h-full items-center border-b-2 border-[var(--color-primary)] bg-[var(--assessment-surface-container)] px-4 text-sm font-bold text-[var(--color-on-primary-container)] shadow-[0_-2px_0_rgba(0,0,0,0.02)]">
                  {isSqlProblem ? "Query Output" : "Test Cases"}
                </button>
                <button className="flex h-full items-center border-b-2 border-transparent px-4 text-sm font-medium text-slate-500 hover:text-slate-800">
                  Console Log
                </button>
              </div>
              
              <div className="flex items-center gap-2 mb-1 pr-2">
                 <button onClick={handleRun} disabled={running} className="flex items-center gap-1.5 text-sm font-bold text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-50">
                   {running ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" /> : <Play className="h-3.5 w-3.5 text-slate-500 fill-slate-500" />} 
                   Run
                 </button>
              </div>
            </div>

            {/* Test Cases Viewer */}
            <div className="flex-1 overflow-y-auto p-5">
               {error && <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700 border border-red-200">{error}</div>}
               
               {/* Global Result Banner */}
               {results && results.length > 0 && (!isSqlProblem && visibleCases.length > 0) && (
                  <div className={`mb-5 flex items-center justify-between rounded-lg px-4 py-3 font-bold border ${results.every(r => r.passed) ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                     <span>{results.filter(r => r.passed).length} / {results.length} Test Cases Passed</span>
                     <span className="text-xl">{results.every(r => r.passed) ? '✅' : '❌'}</span>
                  </div>
               )}

               {/* Case Selector Pills */}
               {!isSqlProblem && (
               <div className="mb-5 flex flex-wrap gap-2">
                 {visibleCases.map((tc, idx) => {
                    const r = results?.find(x => x.id === tc.id);
                    const isSelected = selectedTestCaseIdx === idx;
                    
                    let bg = isSelected ? 'bg-slate-800 text-white shadow-md' : 'bg-slate-100 text-slate-700 hover:bg-slate-200';
                    let icon = null;

                    if (r) {
                       if (r.passed) {
                         bg = isSelected ? 'bg-emerald-600 text-white shadow-md' : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100';
                         icon = <CheckCircle2 className="h-3.5 w-3.5" />;
                       } else {
                         bg = isSelected ? 'bg-red-600 text-white shadow-md' : 'bg-red-50 text-red-700 border border-red-200 hover:bg-red-100';
                         icon = <XCircle className="h-3.5 w-3.5" />;
                       }
                    }

                    return (
                       <button 
                         key={`tc-${tc.id || ''}-${idx}`} 
                         onClick={() => setSelectedTestCaseIdx(idx)}
                         className={`flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-sm font-bold transition-all ${bg}`}
                      >
                         {icon} Case {idx + 1}
                      </button>
                    )
                 })}
               </div>
               )}

               {/* Selected Case Details */}
               {visibleCases[selectedTestCaseIdx] && (
                 <div className="flex flex-col gap-4">
                    {/* Input */}
                    {!isSqlProblem && (
                    <div>
                       <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">Input</p>
                       <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 font-mono text-sm text-slate-700 whitespace-pre-wrap">
                          {visibleCases[selectedTestCaseIdx].input}
                       </div>
                    </div>
                    )}
                    
                    {/* Expected Output vs Actual Output */}
                    <div className={`grid ${isSqlProblem ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
                       {!isSqlProblem && (
                       <div>
                          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">Expected Output</p>
                          <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 font-mono text-sm text-slate-700 whitespace-pre-wrap">
                            {visibleCases[selectedTestCaseIdx].expected_output ?? '(unknown)'}
                          </div>
                       </div>
                       )}
                       
                       {results?.find(x => x.id === visibleCases[selectedTestCaseIdx].id) && (
                         <div>
                            <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-slate-500">{isSqlProblem ? "Query Output (Stdout)" : "Your Output"}</p>
                            <div className={`rounded-lg p-3 font-mono text-sm whitespace-pre-wrap border ${
                               results.find(x => x.id === visibleCases[selectedTestCaseIdx].id)?.passed 
                                 ? 'bg-emerald-50 border-emerald-200 text-emerald-800' 
                                 : 'bg-red-50 border-red-200 text-red-800'
                            }`}>
                              {results.find(x => x.id === visibleCases[selectedTestCaseIdx].id)?.stdout || '(empty stdout)'}
                            </div>
                         </div>
                       )}
                    </div>
                    
                    {/* STDERR / Compilation Error */}
                    {results?.find(x => x.id === visibleCases[selectedTestCaseIdx].id)?.stderr && (
                       <div>
                          <p className="mb-1.5 text-xs font-bold uppercase tracking-wider text-red-500">Compilation / Runtime Error</p>
                          <div className="rounded-lg bg-red-950 p-4 font-mono text-sm text-red-400 whitespace-pre-wrap overflow-x-auto shadow-inner">
                            {results.find(x => x.id === visibleCases[selectedTestCaseIdx].id)?.stderr}
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
  );
}
