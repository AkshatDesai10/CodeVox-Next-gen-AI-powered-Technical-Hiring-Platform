'use client';

import { useState } from 'react';
import Link from 'next/link';
import '@/modules/marketing/styles/landing.css';

const FEATURES = [
  {
    title: 'AI voice interviews',
    body: 'Adaptive conversational interviews that probe depth, clarity, and real technical judgment.',
    icon: 'mic',
  },
  {
    title: 'Monaco coding IDE',
    body: 'Sandboxed multi-language assessments with live execution and private test cases.',
    icon: 'code',
  },
  {
    title: 'Live proctoring',
    body: 'Face presence, multi-face detection, and session integrity signals without friction.',
    icon: 'visibility',
  },
  {
    title: 'Instant reports',
    body: 'Scores, transcripts, and integrity summaries ready the moment a candidate finishes.',
    icon: 'analytics',
  },
];

const STEPS = [
  { step: '01', title: 'Define the role', body: 'Build a job profile with stages, rubrics, and problem banks.' },
  { step: '02', title: 'Invite candidates', body: 'Share magic links for interviews, coding, and take-home rounds.' },
  { step: '03', title: 'Evaluate automatically', body: 'AI interviews and graders produce structured evidence.' },
  { step: '04', title: 'Decide with confidence', body: 'Compare reports, integrity signals, and hiring outcomes.' },
];

const ADVANTAGES = [
  {
    badge: 'Adaptive Voice Screen',
    title: 'Conversational Problem-Solving Over Memorized Syntax',
    body: 'An AI interviewer that adapts in real time to candidate responses. It probes edge-cases, system constraints, and design trade-offs instead of asking textbook trivia.',
    metric: '98.4%',
    metricLabel: 'Evaluation Depth Score',
    legacy: 'Static multiple-choice & predictable phone screens',
    signal: 'Dynamic follow-ups that test real technical intuition',
  },
  {
    badge: 'Production Sandboxes',
    title: 'Real-World Coding Without the Leaked Question Bank',
    body: 'Give developers a full-featured Monaco editor running against containerized micro-environments. Test against hidden performance, memory, and concurrency edge cases.',
    metric: '< 40ms',
    metricLabel: 'Execution & Validation Latency',
    legacy: 'Over-rehearsed LeetCode puzzles with answers easily found online',
    signal: 'Sandboxed execution with dynamic inputs and private test suites',
  },
  {
    badge: 'Zero-Proxy Integrity',
    title: 'Verify the Actual Developer, Not a Stand-in',
    body: 'Client-side facial tracking, audio stream forensics, and focus validation make sure the person submitting code and speaking is the person you hired.',
    metric: '100%',
    metricLabel: 'Session Integrity Rate',
    legacy: 'Proxy test-takers, hidden ChatGPT tabs, and fake credentials',
    signal: 'Continuous biometric verification and anomaly tracking',
  },
  {
    badge: 'Instant Dossier',
    title: 'Hiring Decisions Backed by Evidence, Not Gut Feeling',
    body: 'Hand engineering leads an executive scorecard the second a test wraps up—complete with annotated code replay, verbal transcript, and objective competency ratings.',
    metric: '3x',
    metricLabel: 'Faster Decision Cycle',
    legacy: 'Subjective interviewer bias and days waiting for debriefs',
    signal: 'Structured performance data ready in 60 seconds',
  },
];

export function LandingPage() {
  const [activeAdvTab, setActiveAdvTab] = useState(0);
  return (
    <div className="cvx-landing">
      {/* Top Navbar — Spacious desktop bar */}
      <header className="cvx-nav-glass sticky top-0 z-50">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-12">
          <Link href="/" className="text-2xl font-extrabold tracking-tight text-white">
            Code<span className="cvx-text-gradient">Vox</span>
          </Link>
          <nav className="hidden items-center gap-10 text-[15px] font-medium text-[#A7B7CD] md:flex">
            <a href="#features" className="transition duration-200 hover:text-white">Features</a>
            <a href="#cockpit" className="transition duration-200 hover:text-white">IDE &amp; Proctoring</a>
            <a href="#how" className="transition duration-200 hover:text-white">How it works</a>
            <a href="#advantages" className="transition duration-200 hover:text-white">Why CodeVox</a>
          </nav>
          <div className="flex items-center gap-5">
            <Link href="/signin" className="hidden text-[15px] font-semibold text-[#A7B7CD] transition duration-200 hover:text-white sm:inline">
              Sign in
            </Link>
            <Link href="/signin" className="cvx-btn-primary px-6 py-2.5 text-sm font-semibold">
              Start hiring
            </Link>
          </div>
        </div>
      </header>

      {/* Hero — Spacious desktop grid with generous breathing room */}
      <section className="cvx-hero-glow relative overflow-hidden">
        <div className="mx-auto max-w-7xl px-6 pb-28 pt-20 lg:px-12 lg:pb-36 lg:pt-28">
          <div className="grid gap-14 lg:grid-cols-[1.18fr_0.92fr] lg:items-center xl:gap-20">
            <div>
              <div className="cvx-fade-up mb-6 inline-flex items-center gap-2 rounded-full border border-[#293B57] bg-[#081426]/70 px-4 py-1.5 text-xs font-semibold tracking-wider text-[#F8FAFC]">
                <span className="h-2 w-2 rounded-full bg-[#22D3EE]" />
                CODEVOX RECRUITMENT INTELLIGENCE
              </div>
              <h1 className="cvx-fade-up text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl xl:text-[4.2rem]">
                Hire smarter with{' '}
                <span className="cvx-lime-text">AI interviews</span>
                {' '}and proctored coding tests
              </h1>
              <p className="cvx-fade-up-delay mt-6 max-w-2xl text-lg leading-relaxed text-[#A7B7CD] lg:text-xl">
                Screen, interview, and evaluate engineering talent at scale — with voice AI, sandboxed coding, and integrity built in.
              </p>
              <div className="cvx-fade-up-delay-2 mt-10 flex flex-wrap items-center gap-4">
                <Link href="/signin" className="cvx-btn-primary px-7 py-3.5 text-base font-semibold shadow-lg">
                  Open dashboard &rarr;
                </Link>
                <a href="#cockpit" className="cvx-btn-ghost px-7 py-3.5 text-base font-semibold">
                  Explore product
                </a>
              </div>
            </div>

            {/* Hero Right Visual Card — Spacious glass preview */}
            <div className="cvx-fade-up-delay-2 cvx-glass-panel relative overflow-hidden p-8 lg:p-9">
              <div className="absolute -right-12 -top-12 h-56 w-56 rounded-full bg-[#1685FF]/25 blur-3xl" />
              <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-[#22D3EE]/20 blur-3xl" />
              <div className="relative">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#A7B7CD]">Live interview</p>
                    <p className="mt-1 text-base font-bold text-white">AI Technical Screen · Round 1</p>
                  </div>
                  <span className="rounded-full border border-[rgba(34,211,238,0.35)] bg-[rgba(34,211,238,0.12)] px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-[#22D3EE]">
                    Pro
                  </span>
                </div>
                <div className="rounded-2xl border border-[#293B57] bg-[#081426]/90 p-6 shadow-xl">
                  <div className="mb-4 flex items-center gap-2.5 text-xs font-medium text-[#A7B7CD]">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#22D3EE]" />
                    Voice agent speaking (Low latency WebRTC)
                  </div>
                  <div className="cvx-waveform my-2">
                    {Array.from({ length: 14 }).map((_, i) => (
                      <span key={i} />
                    ))}
                  </div>
                  <p className="mt-5 text-[15px] leading-relaxed text-[#F8FAFC]">
                    “Walk me through how you’d design a rate-limited API gateway for 10k RPS…”
                  </p>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3.5 text-center">
                  {[
                    { label: 'Signal', value: '94%' },
                    { label: 'Integrity', value: 'High' },
                    { label: 'Latency', value: '42ms' },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-[#293B57] bg-[#081426]/70 px-3 py-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#A7B7CD]">{stat.label}</p>
                      <p className="mt-1.5 font-mono text-base font-extrabold text-[#22D3EE]">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section — Built for Smarter Technical Hiring */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-12 lg:px-8 lg:py-16">
        {/* Section Header */}
        <div className="mb-8 text-center lg:mb-10">
          <div className="inline-flex items-center rounded-full border border-[#293B57] bg-[#081426]/70 px-3 py-1 shadow-[0_0_12px_rgba(34,211,238,0.2)] backdrop-blur-md">
            <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#22D3EE]">Why Codevox?</span>
          </div>
          <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
            Built for <span className="bg-gradient-to-r from-[#22D3EE] via-[#38BDF8] to-[#1685FF] bg-clip-text text-transparent">Smarter</span> Technical Hiring.
          </h2>
          <p className="mt-2 text-sm text-[#A7B7CD] sm:text-base">
            One platform. Three powerful capabilities.
          </p>
        </div>

        {/* 2-Column Responsive Bento Layout - Tight Gaps */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
          
          {/* Card 01: Intelligent Interviews (Left Column, Span 5 on LG) */}
          <div className="flex flex-col justify-between rounded-2xl border border-[#293B57] bg-[#0B1930]/90 p-5 shadow-xl backdrop-blur-xl transition duration-300 hover:border-[#293B57] lg:col-span-5 lg:p-6">
            <div>
              {/* Header */}
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#22D3EE]/30 bg-gradient-to-br from-cyan-500/20 to-blue-600/30 text-[#22D3EE] shadow-inner">
                  <span className="material-symbols-outlined text-[22px]">mic</span>
                </div>
                <div>
                  <span className="font-mono text-[11px] font-semibold text-[#64748B]">01</span>
                  <h3 className="text-lg font-bold text-white sm:text-xl">
                    Intelligent <span className="text-[#22D3EE]">Interviews</span>
                  </h3>
                </div>
              </div>

              <p className="mt-3 text-xs leading-relaxed text-[#A7B7CD] sm:text-sm">
                Conduct AI-powered technical interviews that adapt to the candidate&apos;s responses and assess real problem-solving skills.
              </p>

              {/* Bullet Points */}
              <div className="mt-4 space-y-2">
                {[
                  'Natural, conversational flow',
                  'Role-specific technical questions',
                  'Real-time AI evaluation',
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2.5">
                    <div className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-[#38BDF8]">
                      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <span className="text-xs font-medium text-[#D8D2EB]">{item}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Mock Chat & Waveform Widget */}
            <div className="mt-5 overflow-hidden rounded-xl border border-[#293B57] bg-[#050B18]/95 p-4 shadow-xl">
              <div className="mb-3 flex items-center justify-between border-b border-[#293B57] pb-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
                  <span className="text-xs font-semibold text-white">AI Interview</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 animate-ping rounded-full bg-[#22D3EE]" />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#22D3EE]">Live</span>
                </div>
              </div>

              {/* Chat & Skills Split */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:gap-2.5">
                {/* Dialogue area */}
                <div className="space-y-2 sm:col-span-8">
                  {/* AI Bubble 1 */}
                  <div className="flex items-start gap-2">
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[#0F203B]/80 text-[#22D3EE]">
                      <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                    </div>
                    <div className="rounded-lg border border-[#293B57] bg-[#081426]/70 p-2 text-[11px] text-[#F8FAFC]">
                      <p>How would you optimize a function that processes a large collection of records?</p>
                      <span className="mt-0.5 block text-right font-mono text-[9px] text-[#64748B]">00:42</span>
                    </div>
                  </div>

                  {/* Candidate Bubble */}
                  <div className="flex items-start justify-end gap-2">
                    <div className="rounded-lg border border-blue-500/20 bg-blue-950/30 p-2 text-[11px] text-[#E0E7FF]">
                      <p>I would first analyze its time complexity and look for unnecessary iterations...</p>
                      <span className="mt-0.5 block text-right font-mono text-[9px] text-[#64748B]">00:56</span>
                    </div>
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-blue-900/60 text-[#93C5FD]">
                      <span className="material-symbols-outlined text-[14px]">person</span>
                    </div>
                  </div>

                  {/* AI Bubble 2 */}
                  <div className="flex items-start gap-2">
                    <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md bg-[#0F203B]/80 text-[#22D3EE]">
                      <span className="material-symbols-outlined text-[14px]">smart_toy</span>
                    </div>
                    <div className="rounded-lg border border-[#293B57] bg-[#081426]/70 p-2 text-[11px] text-[#F8FAFC]">
                      <p>What data structures could help reduce the processing time?</p>
                      <span className="mt-0.5 block text-right font-mono text-[9px] text-[#64748B]">01:15</span>
                    </div>
                  </div>
                </div>

                {/* Skills Assessed Box */}
                <div className="flex flex-col justify-between rounded-lg border border-[#293B57] bg-[#081426]/70 p-2.5 sm:col-span-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#38BDF8]">Skills Assessed</span>
                  <div className="mt-1.5 space-y-1.5">
                    {[
                      { name: 'Problem Solving', icon: 'psychology' },
                      { name: 'Data Structures', icon: 'account_tree' },
                      { name: 'Algorithms', icon: 'terminal' },
                      { name: 'Communication', icon: 'record_voice_over' },
                    ].map((s) => (
                      <div key={s.name} className="flex items-center gap-1.5 text-[10px] text-[#A7B7CD]">
                        <span className="material-symbols-outlined text-[11px] text-[#38BDF8]">{s.icon}</span>
                        <span className="truncate">{s.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Bottom Voice Waveform Bar */}
              <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-[#293B57] bg-[#081426]/70 px-2.5 py-1.5">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1685FF] text-white">
                  <span className="material-symbols-outlined text-[12px]">play_arrow</span>
                </div>
                <div className="flex flex-1 items-center justify-center gap-0.5">
                  {[4, 8, 14, 6, 18, 22, 10, 16, 24, 12, 20, 8, 14, 22, 16, 9, 13, 20, 7, 12, 18, 5].map((h, i) => (
                    <span
                      key={i}
                      className="w-1 rounded-full bg-gradient-to-t from-[#1685FF] to-[#22D3EE]"
                      style={{ height: (h * 0.75) + 'px' }}
                    />
                  ))}
                </div>
                <span className="font-mono text-[9px] text-[#A7B7CD]">01:45</span>
              </div>
            </div>
          </div>

          {/* Right Column (Cards 02 & 03, Span 7 on LG - Tight gap) */}
          <div className="flex flex-col gap-4 lg:col-span-7 lg:gap-5">
            
            {/* Card 02: Real-Time Coding */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#293B57] bg-[#0B1930]/90 p-5 shadow-xl backdrop-blur-xl transition duration-300 hover:border-[#293B57] lg:p-6">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
                
                {/* Left side: details */}
                <div className="lg:col-span-5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#22D3EE]/30 bg-gradient-to-br from-cyan-500/20 to-blue-600/30 text-[#22D3EE]">
                      <span className="material-symbols-outlined text-[20px]">code</span>
                    </div>
                    <div>
                      <span className="font-mono text-[11px] font-semibold text-[#64748B]">02</span>
                      <h3 className="text-base font-bold text-white sm:text-lg">
                        Real-Time <span className="text-[#22D3EE]">Coding</span>
                      </h3>
                    </div>
                  </div>

                  <p className="mt-2.5 text-xs leading-relaxed text-[#A7B7CD]">
                    Give candidates a familiar coding experience with a secure, sandboxed environment and automated test cases.
                  </p>

                  <div className="mt-3.5 space-y-1.5">
                    {[
                      'Multiple programming languages',
                      'Instant feedback & test results',
                      'Secure, isolated execution',
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-2">
                        <div className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-[#38BDF8]">
                          <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <span className="text-xs font-medium text-[#D8D2EB]">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right side: Mock IDE window */}
                <div className="overflow-hidden rounded-xl border border-[#293B57] bg-[#050B18]/95 shadow-xl lg:col-span-7">
                  {/* IDE Toolbar */}
                  <div className="flex items-center justify-between border-b border-[#293B57] bg-[#081426] px-3 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[13px] text-[#38BDF8]">terminal</span>
                      <span className="rounded bg-[#081426]/70 px-1.5 py-0.5 font-mono text-[10px] text-[#A7B7CD]">Python ▾</span>
                    </div>
                    <button className="flex items-center gap-1 rounded bg-[#22D3EE] px-2 py-0.5 text-[10px] font-bold text-black shadow-[0_0_10px_rgba(85,230,59,0.35)]">
                      <span className="material-symbols-outlined text-[11px]">play_arrow</span> Run
                    </button>
                  </div>

                  {/* IDE Code */}
                  <div className="p-3 font-mono text-[10.5px] leading-relaxed text-[#F8FAFC]">
                    <p><span className="text-[#22D3EE]">def</span> <span className="text-[#93C5FD]">find_missing_numbers</span>(nums):</p>
                    <p className="pl-3">n = len(nums) + <span className="text-[#22D3EE]">1</span></p>
                    <p className="pl-3">total = n * (n + <span className="text-[#22D3EE]">1</span>) // <span className="text-[#22D3EE]">2</span></p>
                    <p className="pl-3"><span className="text-[#22D3EE]">return</span> total - sum(nums)</p>
                    <p className="pt-1 text-[#64748B]"># Test cases</p>
                    <p><span className="text-[#22D3EE]">print</span>(find_missing_numbers([1, 2, 4, 6]))</p>
                  </div>

                  {/* Test Results Output */}
                  <div className="border-t border-[#293B57] bg-[#081426]/80 p-2.5">
                    <p className="text-[9px] font-bold uppercase tracking-wider text-[#64748B]">Test Results</p>
                    <div className="mt-1.5 space-y-1">
                      {[
                        { name: 'Test Case 1', time: '20ms' },
                        { name: 'Test Case 2', time: '18ms' },
                        { name: 'Test Case 3', time: '22ms' },
                      ].map((t) => (
                        <div key={t.name} className="flex items-center justify-between text-[10px]">
                          <div className="flex items-center gap-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-[#22D3EE]" />
                            <span className="text-white">{t.name}</span>
                            <span className="text-[9px] text-[#22D3EE]">Passed</span>
                          </div>
                          <span className="font-mono text-[9px] text-[#64748B]">{t.time}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              </div>
            </div>

            {/* Card 03: Unified Assessment */}
            <div className="flex flex-col justify-between rounded-2xl border border-[#293B57] bg-[#0B1930]/90 p-5 shadow-xl backdrop-blur-xl transition duration-300 hover:border-[#293B57] lg:p-6">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-5">
                
                {/* Left side: details */}
                <div className="lg:col-span-5">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#22D3EE]/30 bg-gradient-to-br from-cyan-500/20 to-blue-600/30 text-[#22D3EE]">
                      <span className="material-symbols-outlined text-[20px]">description</span>
                    </div>
                    <div>
                      <span className="font-mono text-[11px] font-semibold text-[#64748B]">03</span>
                      <h3 className="text-base font-bold text-white sm:text-lg">
                        Unified <span className="text-[#22D3EE]">Assessment</span>
                      </h3>
                    </div>
                  </div>

                  <p className="mt-2.5 text-xs leading-relaxed text-[#A7B7CD]">
                    Get detailed evaluation reports with coding results, interview summaries, and key insights — all in one place.
                  </p>

                  <div className="mt-3.5 space-y-1.5">
                    {[
                      'Performance breakdown',
                      'AI-generated interview summary',
                      'Actionable hiring insights',
                    ].map((item) => (
                      <div key={item} className="flex items-center gap-2">
                        <div className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full bg-cyan-500/20 text-[#38BDF8]">
                          <svg className="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                        <span className="text-xs font-medium text-[#D8D2EB]">{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right side: Mock Candidate Report Widget */}
                <div className="rounded-xl border border-[#293B57] bg-[#050B18]/95 p-3.5 shadow-xl lg:col-span-7">
                  <div className="flex items-center justify-between border-b border-[#293B57] pb-2.5">
                    <div>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-[#64748B]">Candidate Report</span>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-600/50 text-[10px] font-bold text-white">
                          AJ
                        </div>
                        <div>
                          <p className="text-[11px] font-bold text-white">Alex Johnson</p>
                          <p className="text-[9px] text-[#64748B]">Frontend Developer</p>
                        </div>
                      </div>
                    </div>
                    {/* Overall Score Badge */}
                    <div className="flex flex-col items-center justify-center rounded-lg border border-[#22D3EE]/30 bg-[#22D3EE]/10 px-2.5 py-1">
                      <span className="text-[8px] font-semibold uppercase text-[#A7B7CD]">Overall Score</span>
                      <span className="font-mono text-sm font-extrabold text-[#34D399]">86%</span>
                    </div>
                  </div>

                  {/* Performance Bars */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5">
                    <div>
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="text-[#A7B7CD]">Coding Performance</span>
                        <span className="font-bold text-white">92%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#081426]">
                        <div className="h-full rounded-full bg-[#1685FF]" style={{ width: '92%' }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[9px]">
                        <span className="text-[#A7B7CD]">Interview Performance</span>
                        <span className="font-bold text-white">78%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[#081426]">
                        <div className="h-full rounded-full bg-[#818CF8]" style={{ width: '78%' }} />
                      </div>
                    </div>
                  </div>

                  {/* Skill Breakdown & Key Insights */}
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5 border-t border-[#293B57] pt-2">
                    <div>
                      <span className="text-[8.5px] font-bold uppercase tracking-wider text-[#64748B]">Skill Breakdown</span>
                      <div className="mt-1 space-y-1">
                        {[
                          { name: 'Problem Solving', val: 92 },
                          { name: 'Data Structures', val: 85 },
                          { name: 'Algorithms', val: 88 },
                          { name: 'Communication', val: 80 },
                        ].map((sb) => (
                          <div key={sb.name} className="flex items-center justify-between text-[8.5px] text-[#A7B7CD]">
                            <span className="truncate">{sb.name}</span>
                            <span className="font-mono text-[8.5px] text-white">{sb.val}%</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div>
                      <span className="text-[8.5px] font-bold uppercase tracking-wider text-[#64748B]">Key Insights</span>
                      <ul className="mt-1 space-y-0.5 text-[8.5px] leading-tight text-[#A7B7CD]">
                        <li className="flex items-start gap-1">
                          <span className="text-[#22D3EE]">✓</span> Strong problem solving skills
                        </li>
                        <li className="flex items-start gap-1">
                          <span className="text-[#22D3EE]">✓</span> Good understanding of data structures
                        </li>
                        <li className="flex items-start gap-1">
                          <span className="text-amber-400">!</span> Needs improvement in system design
                        </li>
                      </ul>
                    </div>
                  </div>

                </div>

              </div>
            </div>

          </div>

        </div>
      </section>

      {/* Live Assessment Cockpit & Sandboxed IDE — Desktop wide layout */}
      <section id="cockpit" className="mx-auto max-w-7xl px-6 py-24 lg:px-12 lg:py-32">
        <div className="mb-14 max-w-3xl lg:mb-16">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#22D3EE]">Live Assessment Cockpit</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Sandboxed Monaco IDE with live AI proctoring
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#A7B7CD] lg:text-lg">
            Watch code execute against hidden edge cases while real-time face tracking and audio forensics verify session integrity.
          </p>
        </div>

        <div className="cvx-glass-panel overflow-hidden border border-[#293B57] p-8 lg:p-10 xl:p-12">
          <div className="grid gap-10 lg:grid-cols-[1.55fr_1fr] lg:items-start xl:gap-12">
            {/* Left: Code IDE with realistic tabs & syntax */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-[#293B57] bg-[#050B18] shadow-2xl">
              {/* Window Bar */}
              <div className="flex items-center justify-between border-b border-[#293B57] bg-[#081426] px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="h-3.5 w-3.5 rounded-full bg-[#F43F5E]" />
                  <span className="h-3.5 w-3.5 rounded-full bg-[#F59E0B]" />
                  <span className="h-3.5 w-3.5 rounded-full bg-[#22D3EE]" />
                  <span className="ml-3 rounded-md bg-[#081426]/70 px-3 py-1 font-mono text-xs font-medium text-[#A7B7CD]">
                    lru_cache.py
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#22D3EE]" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#22D3EE]">
                    Sandbox Active
                  </span>
                </div>
              </div>

              {/* Code Editor Body */}
              <div className="overflow-x-auto p-6 font-mono text-sm leading-relaxed text-[#F8FAFC]">
                <p><span className="text-[#22D3EE]">class</span> <span className="text-[#22D3EE]">LRUCache</span>:</p>
                <p className="pl-6 text-[#A7B7CD]"># Doubly-linked list + hash map for O(1) operations</p>
                <p className="pl-6"><span className="text-[#22D3EE]">def</span> <span className="text-[#93C5FD]">__init__</span>(self, capacity: <span className="text-[#22D3EE]">int</span>):</p>
                <p className="pl-12">self.cap = capacity</p>
                <p className="pl-12">self.cache = &#123;&#125;</p>
                <p className="pl-12">self.head, self.tail = Node(0, 0), Node(0, 0)</p>
                <p className="pl-12">self.head.next, self.tail.prev = self.tail, self.head</p>
                <p className="pl-6 pt-3"><span className="text-[#22D3EE]">def</span> <span className="text-[#93C5FD]">get</span>(self, key: <span className="text-[#22D3EE]">int</span>) -&gt; <span className="text-[#22D3EE]">int</span>:</p>
                <p className="pl-12"><span className="text-[#22D3EE]">if</span> key <span className="text-[#22D3EE]">in</span> self.cache:</p>
                <p className="pl-16">self._remove(self.cache[key])</p>
                <p className="pl-16">self._insert(self.cache[key])</p>
                <p className="pl-16"><span className="text-[#22D3EE]">return</span> self.cache[key].val</p>
                <p className="pl-12"><span className="text-[#22D3EE]">return</span> -1</p>
              </div>

              {/* Test Cases Output Drawer */}
              <div className="border-t border-[#293B57] bg-[#081426]/90 p-5">
                <div className="mb-3 flex items-center justify-between text-xs font-semibold text-[#A7B7CD]">
                  <span>AUTOMATED TEST EXECUTION</span>
                  <span className="font-bold text-[#34D399]">3 of 3 Passed (100%)</span>
                </div>
                <div className="space-y-2 font-mono text-xs">
                  <div className="flex items-center justify-between rounded-lg bg-[#081426]/70 px-3.5 py-2 text-[#F8FAFC]">
                    <span className="flex items-center gap-2.5">
                      <span className="font-bold text-[#34D399]">✓</span> Test 1: High frequency get/put eviction sequence
                    </span>
                    <span className="text-xs text-[#A7B7CD]">12ms</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-[#081426]/70 px-3.5 py-2 text-[#F8FAFC]">
                    <span className="flex items-center gap-2.5">
                      <span className="font-bold text-[#34D399]">✓</span> Test 2: Concurrent capacity overflow limit
                    </span>
                    <span className="text-xs text-[#A7B7CD]">8ms</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-[#081426]/70 px-3.5 py-2 text-[#F8FAFC]">
                    <span className="flex items-center gap-2.5">
                      <span className="font-bold text-[#34D399]">✓</span> Test 3: Zero capacity and negative key handling
                    </span>
                    <span className="text-xs text-[#A7B7CD]">14ms</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Proctoring & Candidate Verification Panel */}
            <div className="flex flex-col gap-6">
              <div className="rounded-2xl border border-[#293B57] bg-[#0B1930]/85 p-6 lg:p-7">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#22D3EE]">Live Integrity Monitor</p>
                  <span className="rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-bold text-[#22D3EE]">
                    Clean Session
                  </span>
                </div>

                <div className="mt-5 space-y-3.5">
                  <div className="flex items-center justify-between rounded-xl border border-[#293B57] bg-[#050B18] p-3.5">
                    <span className="text-sm text-[#A7B7CD]">Face Presence</span>
                    <span className="flex items-center gap-2 font-mono text-sm font-bold text-[#22D3EE]">
                      <span className="h-2 w-2 rounded-full bg-[#22D3EE]" /> Verified (1 Face)
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-[#293B57] bg-[#050B18] p-3.5">
                    <span className="text-sm text-[#A7B7CD]">Tab / Screen Focus</span>
                    <span className="font-mono text-sm font-bold text-white">0 Unfocused Events</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-[#293B57] bg-[#050B18] p-3.5">
                    <span className="text-sm text-[#A7B7CD]">Audio Stream Noise</span>
                    <span className="font-mono text-sm font-bold text-[#22D3EE]">Single Speaker</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-[#293B57] bg-[#050B18] p-3.5">
                    <span className="text-sm text-[#A7B7CD]">Overall Integrity Score</span>
                    <span className="font-mono text-sm font-extrabold text-[#22D3EE]">99 / 100</span>
                  </div>
                </div>
              </div>

              {/* Candidate Technical Intelligence Verdict */}
              <div className="rounded-2xl border border-[#293B57] bg-gradient-to-br from-[#0F203B] to-[#081426] p-6 lg:p-7">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#A7B7CD]">AI Candidate Verdict</span>
                  <span className="rounded-full bg-[#22D3EE]/15 px-3.5 py-0.5 text-xs font-extrabold text-[#22D3EE]">
                    Strong Hire
                  </span>
                </div>
                <p className="mt-4 text-[15px] leading-relaxed text-[#F8FAFC]">
                  &ldquo;Candidate demonstrated optimal O(1) space-time trade-offs and clearly articulated cache eviction mechanics during the follow-up interrogation.&rdquo;
                </p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <span className="rounded-lg border border-[#293B57] bg-[#081426]/70 px-3 py-1 text-xs font-semibold text-[#A7B7CD]">
                    DSA: 96%
                  </span>
                  <span className="rounded-lg border border-[#293B57] bg-[#081426]/70 px-3 py-1 text-xs font-semibold text-[#A7B7CD]">
                    Architecture: 94%
                  </span>
                  <span className="rounded-lg border border-[#293B57] bg-[#081426]/70 px-3 py-1 text-xs font-semibold text-[#A7B7CD]">
                    Communication: 91%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section — Spacious 4 steps */}
      <section id="how" className="mx-auto max-w-7xl px-6 py-24 lg:px-12 lg:py-32">
        <div className="mb-14 lg:mb-16">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#22D3EE]">Workflow</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            From role to hire in four steps
          </h2>
        </div>
        <div className="relative grid gap-8 md:grid-cols-4 lg:gap-10">
          <div className="cvx-timeline-line absolute left-0 right-0 top-7 hidden h-px md:block" />
          {STEPS.map((s) => (
            <div key={s.step} className="relative">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-[#293B57] bg-[#0F203B] text-base font-extrabold text-[#22D3EE] shadow-[0_0_20px_rgba(22,133,255,0.25)]">
                {s.step}
              </div>
              <h3 className="text-lg font-bold text-white lg:text-xl">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[#A7B7CD] lg:text-[15px]">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* The CodeVox Advantage — Interactive Feature Showcase */}
      <section id="advantages" className="mx-auto max-w-7xl px-4 py-16 lg:px-8 lg:py-24">
        <div className="mb-10 max-w-3xl lg:mb-12">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#293B57] bg-[#081426]/70 px-3.5 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-[#22D3EE] shadow-[0_0_15px_rgba(34,211,238,0.15)]">
            <span>The CodeVox Advantage</span>
          </div>
          <h2 className="mt-4 text-3xl font-extrabold tracking-tight text-white sm:text-4xl lg:text-5xl">
            The Smarter Way to Evaluate Developers
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[#A7B7CD] lg:text-lg">
            Move beyond keyword-stuffed resumes and leaked coding puzzles. Get deep, verifiable signal on how engineers actually build and think.
          </p>
        </div>

        {/* Interactive Feature Showcase with Tabbed Navigation & Comparison Breakdown */}
        <div className="overflow-hidden rounded-3xl border border-[#293B57] bg-[#0B1930]/90 shadow-2xl backdrop-blur-xl">
          
          {/* Top Pill Tabs */}
          <div className="flex flex-wrap items-center gap-2 border-b border-[#293B57] bg-[#081426]/90 p-4 sm:p-5">
            {ADVANTAGES.map((adv, idx) => {
              const active = activeAdvTab === idx;
              return (
                <button
                  key={adv.badge}
                  onClick={() => setActiveAdvTab(idx)}
                  className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition duration-200 sm:text-sm ${
                    active
                      ? 'border border-[#22D3EE]/50 bg-[#1685FF] text-white shadow-[0_0_20px_rgba(34,211,238,0.35)]'
                      : 'border border-transparent bg-[#0F203B]/60 text-[#A7B7CD] hover:border-[#293B57] hover:text-[#F8FAFC]'
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-[#22D3EE]' : 'bg-[#293B57]'}`} />
                  {adv.badge}
                </button>
              );
            })}
          </div>

          {/* Active Feature Showcase Body */}
          <div className="grid grid-cols-1 gap-8 p-6 lg:grid-cols-12 lg:gap-10 lg:p-10">
            
            {/* Left: Deep-dive breakdown of selected advantage */}
            <div className="flex flex-col justify-between lg:col-span-6">
              <div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full border border-[#293B57] bg-[#0F203B] px-3.5 py-1 text-xs font-semibold text-[#22D3EE]">
                    {ADVANTAGES[activeAdvTab].badge}
                  </span>
                  <span className="font-mono text-xs text-[#64748B]">Pillar 0{activeAdvTab + 1} of 04</span>
                </div>

                <h3 className="mt-4 text-2xl font-bold tracking-tight text-white sm:text-3xl">
                  {ADVANTAGES[activeAdvTab].title}
                </h3>
                
                <p className="mt-3.5 text-sm leading-relaxed text-[#A7B7CD] sm:text-base">
                  {ADVANTAGES[activeAdvTab].body}
                </p>

                {/* Structured capability badges */}
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-[#293B57] bg-[#081426]/70 p-3.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#64748B]">Legacy Hiring</p>
                    <p className="mt-1 text-xs font-medium text-rose-400">
                      {ADVANTAGES[activeAdvTab].legacy}
                    </p>
                  </div>
                  <div className="rounded-xl border border-[#22D3EE]/30 bg-[#22D3EE]/5 p-3.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-[#22D3EE]">CodeVox Signal</p>
                    <p className="mt-1 text-xs font-medium text-[#34D399]">
                      {ADVANTAGES[activeAdvTab].signal}
                    </p>
                  </div>
                </div>
              </div>

              {/* Key Metric Highlight */}
              <div className="mt-8 flex items-center justify-between rounded-2xl border border-[#293B57] bg-[#081426] p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-[#A7B7CD]">Verified Metric</p>
                  <p className="text-xs text-[#64748B]">{ADVANTAGES[activeAdvTab].metricLabel}</p>
                </div>
                <p className="font-mono text-3xl font-black text-[#22D3EE] drop-shadow-[0_0_15px_rgba(34,211,238,0.4)] sm:text-4xl">
                  {ADVANTAGES[activeAdvTab].metric}
                </p>
              </div>
            </div>

            {/* Right: Dynamic Interactive Simulation Widget */}
            <div className="overflow-hidden rounded-2xl border border-[#293B57] bg-[#050B18] p-5 shadow-2xl lg:col-span-6">
              
              {/* Tab 0: Adaptive Voice Screen */}
              {activeAdvTab === 0 && (
                <div>
                  <div className="flex items-center justify-between border-b border-[#293B57] pb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px] text-[#22D3EE]">graphic_eq</span>
                      <span className="text-xs font-bold text-white">Active Conversation · High-Signal Dialogue</span>
                    </div>
                    <span className="rounded-full bg-[#34D399]/15 px-2.5 py-0.5 text-[10px] font-extrabold text-[#34D399]">Live Audio</span>
                  </div>
                  
                  <div className="mt-4 space-y-3 font-mono text-xs">
                    <div className="rounded-xl border border-[#293B57] bg-[#081426] p-3 text-[#A7B7CD]">
                      <span className="text-[#22D3EE]">[AI Interviewer]:</span> &ldquo;Your solution works for normal inputs, but how does memory consumption scale when payload size jumps to 1GB?&rdquo;
                    </div>
                    <div className="rounded-xl border border-sky-500/20 bg-sky-950/20 p-3 text-[#F8FAFC]">
                      <span className="text-sky-400">[Candidate]:</span> &ldquo;I would switch from in-memory array buffering to streaming chunks with backpressure handling.&rdquo;
                    </div>
                    <div className="rounded-xl border border-[#34D399]/30 bg-[#34D399]/10 p-3 text-[#34D399]">
                      <span className="font-bold">✓ Critical Thinking Verified:</span> Senior-level systems comprehension · Memory optimization depth.
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 1: Production Sandboxes */}
              {activeAdvTab === 1 && (
                <div>
                  <div className="flex items-center justify-between border-b border-[#293B57] pb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px] text-[#22D3EE]">terminal</span>
                      <span className="text-xs font-bold text-white">Docker Sandbox · Python / Node / PHP / SQL</span>
                    </div>
                    <span className="rounded-full bg-sky-500/15 px-2.5 py-0.5 font-mono text-[10px] font-bold text-sky-400">&lt; 40ms Run</span>
                  </div>

                  <div className="mt-4 space-y-2.5 font-mono text-[11px]">
                    <div className="rounded-lg bg-[#081426] p-3 text-[#A7B7CD]">
                      <p className="text-sky-400">$ sandbox run --memory=256MB --timeout=3s</p>
                      <p className="mt-1 text-[#F8FAFC]">Validating 12 public examples... [Passed]</p>
                      <p className="text-[#34D399]">Executing 28 hidden stress & concurrency test cases... [Passed]</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                      <div className="flex items-center justify-between rounded-lg border border-[#293B57] bg-[#081426] p-2">
                        <span className="text-[#A7B7CD]">Memory Leak Check</span>
                        <span className="text-[#34D399]">Clean (0 bytes leak)</span>
                      </div>
                      <div className="flex items-center justify-between rounded-lg border border-[#293B57] bg-[#081426] p-2">
                        <span className="text-[#A7B7CD]">Time Complexity</span>
                        <span className="text-[#34D399]">O(N log N) Verified</span>
                      </div>
                    </div>
                    <div className="rounded-lg border border-[#34D399]/30 bg-[#34D399]/10 p-2.5 text-center text-xs font-bold text-[#34D399]">
                      ✓ 40 / 40 Test Cases Passed · Zero Time-Limit Exceeded
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 2: Zero-Proxy Integrity */}
              {activeAdvTab === 2 && (
                <div>
                  <div className="flex items-center justify-between border-b border-[#293B57] pb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px] text-[#22D3EE]">shield</span>
                      <span className="text-xs font-bold text-white">Continuous Session Proctoring</span>
                    </div>
                    <span className="rounded-full bg-[#34D399]/15 px-2.5 py-0.5 text-[10px] font-bold text-[#34D399]">100% Trust</span>
                  </div>

                  <div className="mt-4 space-y-2 text-xs">
                    {[
                      { label: 'Candidate Face Identity', status: 'Verified (Match: 99.4%)' },
                      { label: 'Screen & Tab Lock', status: 'Active (0 Tab Switches)' },
                      { label: 'Audio Spectrum Check', status: 'Single Voice (No Prompts)' },
                      { label: 'Code Typing Cadence', status: 'Natural (No Block Pastes)' },
                    ].map((row) => (
                      <div key={row.label} className="flex items-center justify-between rounded-xl border border-[#293B57] bg-[#081426] p-2.5">
                        <span className="text-[#A7B7CD]">{row.label}</span>
                        <span className="font-mono text-[11px] font-bold text-[#34D399]">{row.status}</span>
                      </div>
                    ))}
                    <div className="rounded-lg border border-[#34D399]/30 bg-[#34D399]/10 p-2 text-center text-xs font-bold text-[#34D399]">
                      ✓ Clean Session · Anti-Cheat Audited
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: Instant Dossier */}
              {activeAdvTab === 3 && (
                <div>
                  <div className="flex items-center justify-between border-b border-[#293B57] pb-3">
                    <div className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[18px] text-[#22D3EE]">fact_check</span>
                      <span className="text-xs font-bold text-white">Executive Candidate Dossier · Alex Johnson</span>
                    </div>
                    <span className="rounded-full bg-[#34D399]/15 px-2.5 py-0.5 text-[10px] font-extrabold text-[#34D399]">Strong Hire</span>
                  </div>

                  <div className="mt-4 space-y-2.5 text-xs">
                    <div className="rounded-xl border border-[#293B57] bg-[#081426] p-3">
                      <div className="flex justify-between font-bold text-white">
                        <span>Overall Technical Match</span>
                        <span className="font-mono text-[#22D3EE]">94% — Final Round Recommended</span>
                      </div>
                      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[#0B1930]">
                        <div className="h-full rounded-full bg-gradient-to-r from-[#1685FF] to-[#22D3EE]" style={{ width: '94%' }} />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-[#293B57] bg-[#081426] p-2">
                        <p className="text-[10px] text-[#64748B]">Algorithms & Execution</p>
                        <p className="font-mono text-sm font-bold text-white">96%</p>
                      </div>
                      <div className="rounded-lg border border-[#293B57] bg-[#081426] p-2">
                        <p className="text-[10px] text-[#64748B]">System Architecture</p>
                        <p className="font-mono text-sm font-bold text-white">92%</p>
                      </div>
                      <div className="rounded-lg border border-[#293B57] bg-[#081426] p-2">
                        <p className="text-[10px] text-[#64748B]">Communication & Clarity</p>
                        <p className="font-mono text-sm font-bold text-white">94%</p>
                      </div>
                      <div className="rounded-lg border border-[#293B57] bg-[#081426] p-2">
                        <p className="text-[10px] text-[#64748B]">Integrity & Authenticity</p>
                        <p className="font-mono text-sm font-bold text-[#34D399]">100%</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

            </div>

          </div>

        </div>
      </section>

      {/* Final Call to Action — Spacious hero banner */}
      <section className="mx-auto max-w-7xl px-6 pb-32 lg:px-12 lg:pb-40">
        <div className="cvx-glass-panel flex flex-col items-start justify-between gap-8 bg-gradient-to-br from-[#0B1930] to-[#050B18] p-10 lg:flex-row lg:items-center lg:p-16">
          <div>
            <h2 className="text-3xl font-extrabold text-white sm:text-4xl lg:text-5xl">
              Ready to hire with signal?
            </h2>
            <p className="mt-3 text-base leading-relaxed text-[#A7B7CD] lg:text-xl">
              Open the CodeVox dashboard and run your first AI interview today.
            </p>
          </div>
          <Link href="/signin" className="cvx-btn-primary shrink-0 px-8 py-4 text-base font-bold shadow-xl">
            Launch CodeVox &rarr;
          </Link>
        </div>
      </section>

      <footer className="border-t border-[#293B57] py-10 text-center text-xs text-[#A7B7CD]">
        © {new Date().getFullYear()} CodeVox · AI-powered technical hiring
      </footer>
    </div>
  );
}
