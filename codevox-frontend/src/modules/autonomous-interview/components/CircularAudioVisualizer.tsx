'use client';

import { useMemo } from 'react';

type CircularWaveVisualizerProps = {
  isSpeaking?: boolean;
  isListening?: boolean;
  isAnalyzing?: boolean;
  agentConnected?: boolean;
  size?: number;
};

/**
 * Clean & Minimalist AI Stage:
 * - Subtle geometric radar rings & polar axis
 * - Ambient Aurora Borealis Glow
 * - 48-bar Radial Audio Waveform + Core Intelligent Orb
 * (Distracting HUD telemetry, confidence, and frequency texts removed)
 */
export function CircularAudioVisualizer({
  isSpeaking = false,
  isListening = false,
  isAnalyzing = false,
  agentConnected = true,
  size = 320,
}: CircularWaveVisualizerProps) {
  const barCount = 48;
  const radius = size * 0.35;

  const bars = useMemo(() => {
    return Array.from({ length: barCount }).map((_, i) => {
      const angleDeg = (i / barCount) * 360;
      const angleRad = (angleDeg * Math.PI) / 180;
      const baseHeightRatio = 0.25 + 0.75 * Math.abs(Math.sin((i / barCount) * Math.PI * 4));
      return { id: i, angleDeg, angleRad, baseHeightRatio };
    });
  }, [barCount]);

  const stateLabel = !agentConnected
    ? 'INITIALIZING'
    : isSpeaking
      ? 'SYNTHESIZING'
      : isAnalyzing
        ? 'EVALUATING'
        : isListening
          ? 'LISTENING'
          : 'STANDBY';

  return (
    <div className="relative flex items-center justify-center select-none w-full h-full overflow-hidden">
      {/* 1. BACKGROUND GEOMETRIC RADAR RINGS & GLOW */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        {/* Subtle dot grid */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle, #38BDF8 1px, transparent 1px)`,
            backgroundSize: '24px 24px',
          }}
        />

        {/* Outer Minimal Rings */}
        <div className="absolute h-[580px] w-[580px] rounded-full border border-cyan-500/[0.06] animate-[spin_120s_linear_infinite]" />
        <div className="absolute h-[460px] w-[460px] rounded-full border border-dashed border-blue-500/[0.07] animate-[spin_80s_linear_infinite_reverse]" />
        <div className="absolute h-[360px] w-[360px] rounded-full border border-cyan-400/[0.1]" />

        {/* Subtle crosshair lines */}
        <div className="absolute h-px w-[80%] max-w-[700px] bg-gradient-to-r from-transparent via-cyan-500/[0.12] to-transparent" />
        <div className="absolute w-px h-[80%] max-h-[500px] bg-gradient-to-b from-transparent via-blue-500/[0.12] to-transparent" />

        {/* Ambient Aurora Glow Blooms */}
        <div
          className={`absolute rounded-full blur-[100px] transition-all duration-1000 ${
            isSpeaking
              ? 'h-80 w-80 bg-cyan-500/20 opacity-80'
              : isAnalyzing
                ? 'h-80 w-80 bg-blue-600/25 opacity-70'
                : 'h-64 w-64 bg-cyan-600/10 opacity-50'
          }`}
        />
        <div className="absolute h-72 w-72 rounded-full blur-[90px] bg-[#1685FF]/15 -translate-y-10 translate-x-12" />
      </div>

      {/* 2. CENTRAL RADIAL EQUALIZER & GLOWING AI ORB */}
      <div
        className="relative flex items-center justify-center z-10"
        style={{ width: size, height: size }}
      >
        {/* Rotating outer orbital track */}
        <div
          className={`absolute inset-0 rounded-full border border-dashed transition-all duration-1000 pointer-events-none ${
            isSpeaking
              ? 'border-cyan-400/40 animate-[spin_10s_linear_infinite]'
              : isAnalyzing
                ? 'border-blue-400/30 animate-[spin_5s_linear_infinite]'
                : 'border-cyan-500/20 opacity-40 animate-[spin_30s_linear_infinite]'
          }`}
        />

        {/* Counter-rotating secondary ring */}
        <div
          className={`absolute inset-3 rounded-full border border-dotted transition-all duration-1000 pointer-events-none ${
            isSpeaking
              ? 'border-[#1685FF]/60 animate-[spin_14s_linear_infinite_reverse]'
              : 'border-slate-600/30 opacity-30 animate-[spin_35s_linear_infinite_reverse]'
          }`}
        />

        {/* SVG Circular Radial Waveform Bars */}
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="absolute inset-0 z-10 overflow-visible"
        >
          <defs>
            <linearGradient id="barGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#38BDF8" stopOpacity="1" />
              <stop offset="60%" stopColor="#1685FF" stopOpacity="0.85" />
              <stop offset="100%" stopColor="#22D3EE" stopOpacity="0.3" />
            </linearGradient>
            <filter id="neonBloom" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          <g transform={`translate(${size / 2}, ${size / 2})`}>
            {bars.map((bar) => {
              const minLen = 6;
              const maxLen = 36;
              let barLen = minLen;

              if (isSpeaking) {
                barLen = minLen + bar.baseHeightRatio * maxLen;
              } else if (isListening) {
                barLen = minLen + bar.baseHeightRatio * (maxLen * 0.45);
              } else if (isAnalyzing) {
                barLen = minLen + (bar.id % 2 === 0 ? maxLen * 0.5 : minLen);
              }

              return (
                <line
                  key={bar.id}
                  x1={0}
                  y1={-radius}
                  x2={0}
                  y2={-(radius + barLen)}
                  transform={`rotate(${bar.angleDeg})`}
                  stroke="url(#barGrad)"
                  strokeWidth={isSpeaking ? 3 : 2}
                  strokeLinecap="round"
                  filter={isSpeaking ? 'url(#neonBloom)' : undefined}
                  className="transition-all duration-150 ease-out"
                  style={{
                    opacity: isSpeaking ? 0.95 : isListening ? 0.8 : 0.4,
                  }}
                />
              );
            })}
          </g>
        </svg>

        {/* Inner Central Glass Core */}
        <div
          className={`relative z-20 flex flex-col items-center justify-center rounded-full border shadow-2xl transition-all duration-500 backdrop-blur-2xl ${
            isSpeaking
              ? 'border-cyan-400/60 bg-[#081426]/90 shadow-[0_0_50px_rgba(34,211,238,0.4)] scale-105'
              : isAnalyzing
                ? 'border-blue-400/50 bg-[#081426]/90 shadow-[0_0_35px_rgba(22,133,255,0.3)]'
                : 'border-cyan-500/25 bg-[#081426]/85 shadow-[0_0_25px_rgba(5,11,24,0.8)]'
          }`}
          style={{
            width: size * 0.52,
            height: size * 0.52,
          }}
        >
          {/* Animated Core Icon */}
          <div className="relative flex items-center justify-center">
            <div
              className={`flex items-center justify-center rounded-full transition-all duration-500 ${
                isSpeaking
                  ? 'h-16 w-16 bg-gradient-to-tr from-cyan-500/20 to-blue-500/30 ring-2 ring-cyan-400/60 shadow-[inset_0_0_15px_rgba(34,211,238,0.4)]'
                  : 'h-14 w-14 bg-gradient-to-tr from-blue-600/10 to-cyan-500/15 ring-1 ring-white/10'
              }`}
            >
              <span
                className={`material-symbols-outlined transition-transform duration-300 ${
                  isSpeaking
                    ? 'text-3xl text-cyan-400 scale-110 animate-pulse'
                    : isAnalyzing
                      ? 'text-2xl text-blue-400 animate-spin'
                      : 'text-2xl text-cyan-200/90'
                }`}
              >
                {isSpeaking ? 'graphic_eq' : isAnalyzing ? 'sync' : 'psychology'}
              </span>
            </div>
          </div>

          {/* Clean Status Badge */}
          <div className="mt-2.5 text-center">
            <p className="text-[10px] font-bold tracking-widest uppercase text-slate-200">
              AI Interviewer
            </p>
            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[8.5px] font-mono font-semibold text-cyan-300 bg-cyan-950/60 border border-cyan-500/30 shadow-sm">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isSpeaking
                    ? 'bg-cyan-400 animate-ping'
                    : isListening
                      ? 'bg-emerald-400 animate-pulse'
                      : 'bg-blue-400'
                }`}
              />
              {stateLabel}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
