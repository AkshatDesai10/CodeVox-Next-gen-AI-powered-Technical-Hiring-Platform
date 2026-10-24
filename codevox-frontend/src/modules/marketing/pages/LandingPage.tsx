'use client';

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
    badge: 'Voice AI Intelligence',
    title: 'Conversational Code Defense',
    body: 'Unlike static multiple-choice or LeetCode trivia, CodeVox asks candidates to defend their architectural choices live, probing edge cases and time complexity.',
    metric: '98.4%',
    metricLabel: 'Signal Confidence',
  },
  {
    badge: 'Execution Sandbox',
    title: 'Real-World Production IDE',
    body: 'Full sandboxed environment powered by Monaco Editor supporting Python, TypeScript, Java, C++, and Go with real-time test case verification.',
    metric: '< 40ms',
    metricLabel: 'Execution Latency',
  },
  {
    badge: 'Proctoring Engine',
    title: 'AI-Powered Session Integrity',
    body: 'Continuous facial presence verification, multi-person detection, audio anomaly scanning, and tab-switch monitoring to eliminate proxy test-takers.',
    metric: '100%',
    metricLabel: 'Tamper-Proof Audit',
  },
  {
    badge: 'Automated Decisions',
    title: 'Instant Candidate Dossier',
    body: 'Recruiter-ready report cards complete with full transcripts, annotated code replays, category scores, and objective hiring recommendations.',
    metric: '3x',
    metricLabel: 'Faster Decisions',
  },
];

export function LandingPage() {
  return (
    <div className="cvx-landing">
      {/* Top Navbar — Spacious desktop bar */}
      <header className="cvx-nav-glass sticky top-0 z-50">
        <div className="mx-auto flex h-20 max-w-7xl items-center justify-between px-6 lg:px-12">
          <Link href="/" className="text-2xl font-extrabold tracking-tight text-white">
            Code<span className="cvx-text-gradient">Vox</span>
          </Link>
          <nav className="hidden items-center gap-10 text-[15px] font-medium text-[#C4B5FD] md:flex">
            <a href="#features" className="transition duration-200 hover:text-white">Features</a>
            <a href="#cockpit" className="transition duration-200 hover:text-white">IDE &amp; Proctoring</a>
            <a href="#how" className="transition duration-200 hover:text-white">How it works</a>
            <a href="#advantages" className="transition duration-200 hover:text-white">Why CodeVox</a>
          </nav>
          <div className="flex items-center gap-5">
            <Link href="/signin" className="hidden text-[15px] font-semibold text-[#C4B5FD] transition duration-200 hover:text-white sm:inline">
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
              <div className="cvx-fade-up mb-6 inline-flex items-center gap-2 rounded-full border border-purple-500/30 bg-purple-950/40 px-4 py-1.5 text-xs font-semibold tracking-wider text-[#DDD6FE]">
                <span className="h-2 w-2 rounded-full bg-[#55E63B]" />
                CODEVOX RECRUITMENT INTELLIGENCE
              </div>
              <h1 className="cvx-fade-up text-4xl font-extrabold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl xl:text-[4.2rem]">
                Hire smarter with{' '}
                <span className="cvx-lime-text">AI interviews</span>
                {' '}and proctored coding tests
              </h1>
              <p className="cvx-fade-up-delay mt-6 max-w-2xl text-lg leading-relaxed text-[#C4B5FD] lg:text-xl">
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
              <div className="absolute -right-12 -top-12 h-56 w-56 rounded-full bg-[#7C3AED]/35 blur-3xl" />
              <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-[#55E63B]/20 blur-3xl" />
              <div className="relative">
                <div className="mb-6 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-[#948BB0]">Live interview</p>
                    <p className="mt-1 text-base font-bold text-white">AI Technical Screen · Round 1</p>
                  </div>
                  <span className="rounded-full border border-[rgba(85,230,59,0.35)] bg-[rgba(85,230,59,0.12)] px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-[#55E63B]">
                    Pro
                  </span>
                </div>
                <div className="rounded-2xl border border-purple-500/20 bg-[#160A30]/90 p-6 shadow-xl">
                  <div className="mb-4 flex items-center gap-2.5 text-xs font-medium text-[#C4B5FD]">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-[#55E63B]" />
                    Voice agent speaking (Low latency WebRTC)
                  </div>
                  <div className="cvx-waveform my-2">
                    {Array.from({ length: 14 }).map((_, i) => (
                      <span key={i} />
                    ))}
                  </div>
                  <p className="mt-5 text-[15px] leading-relaxed text-[#DDD6FE]">
                    “Walk me through how you’d design a rate-limited API gateway for 10k RPS…”
                  </p>
                </div>
                <div className="mt-5 grid grid-cols-3 gap-3.5 text-center">
                  {[
                    { label: 'Signal', value: '94%' },
                    { label: 'Integrity', value: 'High' },
                    { label: 'Latency', value: '42ms' },
                  ].map((stat) => (
                    <div key={stat.label} className="rounded-xl border border-purple-500/20 bg-purple-950/40 px-3 py-3.5">
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#948BB0]">{stat.label}</p>
                      <p className="mt-1.5 font-mono text-base font-extrabold text-[#55E63B]">{stat.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section — Spacious 4-column desktop layout */}
      <section id="features" className="mx-auto max-w-7xl px-6 py-24 lg:px-12 lg:py-32">
        <div className="mb-14 max-w-2xl lg:mb-16">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#55E63B]">Capabilities</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Built for serious technical hiring
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#C4B5FD] lg:text-lg">
            Everything you need to evaluate engineers — without the noise.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 lg:gap-8">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="cvx-glass-panel flex flex-col justify-between p-7 transition duration-300 hover:-translate-y-1.5 hover:border-[#8B5CF6]/60 lg:p-8"
            >
              <div>
                <div className="mb-6 flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-900/40 text-[#55E63B]">
                  <span className="material-symbols-outlined text-[28px]">{f.icon}</span>
                </div>
                <h3 className="text-lg font-bold text-white lg:text-xl">{f.title}</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-[#C4B5FD] lg:text-[15px]">{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Live Assessment Cockpit & Sandboxed IDE — Desktop wide layout */}
      <section id="cockpit" className="mx-auto max-w-7xl px-6 py-24 lg:px-12 lg:py-32">
        <div className="mb-14 max-w-3xl lg:mb-16">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#55E63B]">Live Assessment Cockpit</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Sandboxed Monaco IDE with live AI proctoring
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#C4B5FD] lg:text-lg">
            Watch code execute against hidden edge cases while real-time face tracking and audio forensics verify session integrity.
          </p>
        </div>

        <div className="cvx-glass-panel overflow-hidden border border-purple-500/25 p-8 lg:p-10 xl:p-12">
          <div className="grid gap-10 lg:grid-cols-[1.55fr_1fr] lg:items-start xl:gap-12">
            {/* Left: Code IDE with realistic tabs & syntax */}
            <div className="flex flex-col overflow-hidden rounded-2xl border border-purple-500/20 bg-[#0A0417] shadow-2xl">
              {/* Window Bar */}
              <div className="flex items-center justify-between border-b border-purple-500/20 bg-[#120626] px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className="h-3.5 w-3.5 rounded-full bg-[#F43F5E]" />
                  <span className="h-3.5 w-3.5 rounded-full bg-[#F59E0B]" />
                  <span className="h-3.5 w-3.5 rounded-full bg-[#55E63B]" />
                  <span className="ml-3 rounded-md bg-purple-950/60 px-3 py-1 font-mono text-xs font-medium text-[#C4B5FD]">
                    lru_cache.py
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[#55E63B]" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-[#55E63B]">
                    Sandbox Active
                  </span>
                </div>
              </div>

              {/* Code Editor Body */}
              <div className="overflow-x-auto p-6 font-mono text-sm leading-relaxed text-[#DDD6FE]">
                <p><span className="text-[#C084FC]">class</span> <span className="text-[#55E63B]">LRUCache</span>:</p>
                <p className="pl-6 text-[#948BB0]"># Doubly-linked list + hash map for O(1) operations</p>
                <p className="pl-6"><span className="text-[#C084FC]">def</span> <span className="text-[#93C5FD]">__init__</span>(self, capacity: <span className="text-[#55E63B]">int</span>):</p>
                <p className="pl-12">self.cap = capacity</p>
                <p className="pl-12">self.cache = &#123;&#125;</p>
                <p className="pl-12">self.head, self.tail = Node(0, 0), Node(0, 0)</p>
                <p className="pl-12">self.head.next, self.tail.prev = self.tail, self.head</p>
                <p className="pl-6 pt-3"><span className="text-[#C084FC]">def</span> <span className="text-[#93C5FD]">get</span>(self, key: <span className="text-[#55E63B]">int</span>) -&gt; <span className="text-[#55E63B]">int</span>:</p>
                <p className="pl-12"><span className="text-[#C084FC]">if</span> key <span className="text-[#C084FC]">in</span> self.cache:</p>
                <p className="pl-16">self._remove(self.cache[key])</p>
                <p className="pl-16">self._insert(self.cache[key])</p>
                <p className="pl-16"><span className="text-[#C084FC]">return</span> self.cache[key].val</p>
                <p className="pl-12"><span className="text-[#C084FC]">return</span> -1</p>
              </div>

              {/* Test Cases Output Drawer */}
              <div className="border-t border-purple-500/20 bg-[#120626]/90 p-5">
                <div className="mb-3 flex items-center justify-between text-xs font-semibold text-[#948BB0]">
                  <span>AUTOMATED TEST EXECUTION</span>
                  <span className="font-bold text-[#55E63B]">3 of 3 Passed (100%)</span>
                </div>
                <div className="space-y-2 font-mono text-xs">
                  <div className="flex items-center justify-between rounded-lg bg-purple-950/40 px-3.5 py-2 text-[#DDD6FE]">
                    <span className="flex items-center gap-2.5">
                      <span className="font-bold text-[#55E63B]">✓</span> Test 1: High frequency get/put eviction sequence
                    </span>
                    <span className="text-xs text-[#948BB0]">12ms</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-purple-950/40 px-3.5 py-2 text-[#DDD6FE]">
                    <span className="flex items-center gap-2.5">
                      <span className="font-bold text-[#55E63B]">✓</span> Test 2: Concurrent capacity overflow limit
                    </span>
                    <span className="text-xs text-[#948BB0]">8ms</span>
                  </div>
                  <div className="flex items-center justify-between rounded-lg bg-purple-950/40 px-3.5 py-2 text-[#DDD6FE]">
                    <span className="flex items-center gap-2.5">
                      <span className="font-bold text-[#55E63B]">✓</span> Test 3: Zero capacity and negative key handling
                    </span>
                    <span className="text-xs text-[#948BB0]">14ms</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Right: Proctoring & Candidate Verification Panel */}
            <div className="flex flex-col gap-6">
              <div className="rounded-2xl border border-purple-500/20 bg-[#14082C]/75 p-6 lg:p-7">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold uppercase tracking-wider text-[#55E63B]">Live Integrity Monitor</p>
                  <span className="rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-bold text-[#55E63B]">
                    Clean Session
                  </span>
                </div>

                <div className="mt-5 space-y-3.5">
                  <div className="flex items-center justify-between rounded-xl border border-purple-500/20 bg-[#0E0520] p-3.5">
                    <span className="text-sm text-[#C4B5FD]">Face Presence</span>
                    <span className="flex items-center gap-2 font-mono text-sm font-bold text-[#55E63B]">
                      <span className="h-2 w-2 rounded-full bg-[#55E63B]" /> Verified (1 Face)
                    </span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-purple-500/20 bg-[#0E0520] p-3.5">
                    <span className="text-sm text-[#C4B5FD]">Tab / Screen Focus</span>
                    <span className="font-mono text-sm font-bold text-white">0 Unfocused Events</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-purple-500/20 bg-[#0E0520] p-3.5">
                    <span className="text-sm text-[#C4B5FD]">Audio Stream Noise</span>
                    <span className="font-mono text-sm font-bold text-[#55E63B]">Single Speaker</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl border border-purple-500/20 bg-[#0E0520] p-3.5">
                    <span className="text-sm text-[#C4B5FD]">Overall Integrity Score</span>
                    <span className="font-mono text-sm font-extrabold text-[#55E63B]">99 / 100</span>
                  </div>
                </div>
              </div>

              {/* Candidate Technical Intelligence Verdict */}
              <div className="rounded-2xl border border-purple-500/20 bg-gradient-to-br from-[#1F0C42] to-[#120626] p-6 lg:p-7">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-[#C4B5FD]">AI Candidate Verdict</span>
                  <span className="rounded-full bg-[#55E63B]/15 px-3.5 py-0.5 text-xs font-extrabold text-[#55E63B]">
                    Strong Hire
                  </span>
                </div>
                <p className="mt-4 text-[15px] leading-relaxed text-[#DDD6FE]">
                  &ldquo;Candidate demonstrated optimal O(1) space-time trade-offs and clearly articulated cache eviction mechanics during the follow-up interrogation.&rdquo;
                </p>
                <div className="mt-5 flex flex-wrap gap-2.5">
                  <span className="rounded-lg border border-purple-500/30 bg-purple-950/40 px-3 py-1 text-xs font-semibold text-[#C4B5FD]">
                    DSA: 96%
                  </span>
                  <span className="rounded-lg border border-purple-500/30 bg-purple-950/40 px-3 py-1 text-xs font-semibold text-[#C4B5FD]">
                    Architecture: 94%
                  </span>
                  <span className="rounded-lg border border-purple-500/30 bg-purple-950/40 px-3 py-1 text-xs font-semibold text-[#C4B5FD]">
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
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#55E63B]">Workflow</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            From role to hire in four steps
          </h2>
        </div>
        <div className="relative grid gap-8 md:grid-cols-4 lg:gap-10">
          <div className="cvx-timeline-line absolute left-0 right-0 top-7 hidden h-px md:block" />
          {STEPS.map((s) => (
            <div key={s.step} className="relative">
              <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-purple-500/30 bg-[#160A30] text-base font-extrabold text-[#55E63B] shadow-[0_0_24px_rgba(124,58,237,0.35)]">
                {s.step}
              </div>
              <h3 className="text-lg font-bold text-white lg:text-xl">{s.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[#C4B5FD] lg:text-[15px]">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why Top Engineering Teams Choose CodeVox — Spacious bento grid */}
      <section id="advantages" className="mx-auto max-w-7xl px-6 py-24 lg:px-12 lg:py-32">
        <div className="mb-14 max-w-3xl lg:mb-16">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#55E63B]">The CodeVox Advantage</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Why leading tech companies hire through CodeVox
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#C4B5FD] lg:text-lg">
            Replace shallow resume screens and leak-prone coding tests with high-fidelity technical signal that candidates actually respect.
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-2 lg:gap-10">
          {ADVANTAGES.map((adv) => (
            <div
              key={adv.title}
              className="cvx-glass-panel relative flex flex-col justify-between overflow-hidden p-8 transition duration-300 hover:-translate-y-1.5 hover:border-[#8B5CF6]/60 lg:p-10"
            >
              <div>
                <div className="flex items-center justify-between">
                  <span className="rounded-full border border-purple-500/30 bg-purple-950/60 px-3.5 py-1 text-xs font-semibold text-[#DDD6FE]">
                    {adv.badge}
                  </span>
                  <div className="text-right">
                    <p className="font-mono text-3xl font-black text-[#55E63B]">{adv.metric}</p>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-[#948BB0]">{adv.metricLabel}</p>
                  </div>
                </div>
                <h3 className="mt-6 text-xl font-bold text-white lg:text-2xl">{adv.title}</h3>
                <p className="mt-3 text-base leading-relaxed text-[#C4B5FD]">{adv.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Final Call to Action — Spacious hero banner */}
      <section className="mx-auto max-w-7xl px-6 pb-32 lg:px-12 lg:pb-40">
        <div className="cvx-glass-panel flex flex-col items-start justify-between gap-8 bg-gradient-to-br from-[#1C0D3D] to-[#0D051C] p-10 lg:flex-row lg:items-center lg:p-16">
          <div>
            <h2 className="text-3xl font-extrabold text-white sm:text-4xl lg:text-5xl">
              Ready to hire with signal?
            </h2>
            <p className="mt-3 text-base leading-relaxed text-[#C4B5FD] lg:text-xl">
              Open the CodeVox dashboard and run your first AI interview today.
            </p>
          </div>
          <Link href="/signin" className="cvx-btn-primary shrink-0 px-8 py-4 text-base font-bold shadow-xl">
            Launch CodeVox &rarr;
          </Link>
        </div>
      </section>

      <footer className="border-t border-purple-500/20 py-10 text-center text-xs text-[#948BB0]">
        © {new Date().getFullYear()} CodeVox · AI-powered technical hiring
      </footer>
    </div>
  );
}
