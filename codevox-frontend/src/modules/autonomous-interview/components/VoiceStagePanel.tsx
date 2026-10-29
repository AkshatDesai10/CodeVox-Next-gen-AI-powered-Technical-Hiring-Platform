import { CircularAudioVisualizer } from '@/modules/autonomous-interview/components/CircularAudioVisualizer';
'use client';

/// <reference types="@types/dom-speech-recognition" />
import { useCallback, useEffect, useRef, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import { getAutonomousSession, sendVoiceMessage } from '@/modules/autonomous-interview/lib/autonomous-interview-api';

import { InterviewRecBadge } from '@/modules/autonomous-interview/components/InterviewRecBadge';
import { VoicePhasePillStrip } from '@/modules/autonomous-interview/components/VoicePhasePillStrip';
import {
  resolveSpeakingState,
  useVoicePhaseProgress,
} from '@/modules/autonomous-interview/hooks/useVoicePhaseProgress';
import '@/modules/autonomous-interview/styles/conversation-session.css';

type SpeechRecognitionCtor = new () => any;

type TranscriptMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  time: string;
};

type Props = {
  candidateToken: string;
  techStack: string;
  phase: 'ai_verbal' | 'hr_verbal' | 'ai_screening' | 'unified';
  visible: boolean;
  onPhaseChange?: (phase: string) => void;
};

const DEFAULT_INTRO_MIN = 3;
const DEFAULT_INTRO_MAX = 50;

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function historyToMessages(history: { role: string; content: string }[]): TranscriptMessage[] {
  return history.map((entry, index) => ({
    id: `hist-${index}`,
    role: entry.role === 'assistant' ? 'assistant' : 'user',
    content: entry.content,
    time: formatTime(),
  }));
}

export function VoiceStagePanel({
  candidateToken,
  techStack,
  phase,
  visible,
  onPhaseChange,
}: Props) {
  const recognitionRef = useRef<any | null>(null);
  const pendingRef = useRef('');
  const interimRef = useRef('');
  const suppressRef = useRef(false);
  const shouldListenRef = useRef(true);
  const startedRef = useRef(false);
  const userMutedRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const sessionStartRef = useRef(Date.now());
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const statusRef = useRef<'idle' | 'ready' | 'listening' | 'thinking' | 'error'>('idle');
  const agentSpeakingRef = useRef(false);
  const silenceSendTimerRef = useRef<number | null>(null);
  const voiceIntroCompleteRef = useRef(false);
  const introMaxTurnsRef = useRef(DEFAULT_INTRO_MAX);
  const agentTurnsRef = useRef(0);

  const micSessionOver = useCallback(() => {
    return voiceIntroCompleteRef.current && agentTurnsRef.current >= introMaxTurnsRef.current;
  }, []);

  const SILENCE_SEND_MS = 2800;
  const MIN_SPEECH_CHARS = 3;

  const [status, setStatus] = useState<'idle' | 'ready' | 'listening' | 'thinking' | 'error'>('idle');
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [lastReply, setLastReply] = useState('');
  const [speechSupported, setSpeechSupported] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [agentTurns, setAgentTurns] = useState(0);
  const [userTurns, setUserTurns] = useState(0);
  const [introMinTurns, setIntroMinTurns] = useState(DEFAULT_INTRO_MIN);
  const [introMaxTurns, setIntroMaxTurns] = useState(DEFAULT_INTRO_MAX);
  const [voiceIntroComplete, setVoiceIntroComplete] = useState(false);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [userMuted, setUserMuted] = useState(false);
  const [videoEnabled, setVideoEnabled] = useState(true);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState('00:00');

  const stopWebcam = useCallback(() => {
    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startWebcam = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Webcam is not supported in this browser.');
      setVideoEnabled(false);
      return;
    }

    try {
      stopWebcam();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      mediaStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraError(null);
      setVideoEnabled(true);
    } catch (err) {
      setCameraError(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access and refresh.'
          : 'Could not access webcam.',
      );
      setVideoEnabled(false);
      stopWebcam();
    }
  }, [stopWebcam]);

  const toggleVideo = useCallback(() => {
    if (videoEnabled) {
      stopWebcam();
      setVideoEnabled(false);
      return;
    }
    void startWebcam();
  }, [startWebcam, stopWebcam, videoEnabled]);

  const startListeningRef = useRef<(() => void) | null>(null);
  const sendToInterviewerRef = useRef<(message: string) => Promise<void>>(async () => { });

  const setConversationStatus = useCallback(
    (next: 'idle' | 'ready' | 'listening' | 'thinking' | 'error') => {
      statusRef.current = next;
      setStatus(next);
    },
    [],
  );

  const clearSilenceSendTimer = useCallback(() => {
    if (silenceSendTimerRef.current) {
      window.clearTimeout(silenceSendTimerRef.current);
      silenceSendTimerRef.current = null;
    }
  }, []);

  const haltMicCapture = useCallback((clearPending = true) => {
    clearSilenceSendTimer();
    suppressRef.current = true;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* ignore */
      }
      recognitionRef.current = null;
    }
    if (clearPending) {
      pendingRef.current = '';
      interimRef.current = '';
      setTranscript('');
    }
  }, [clearSilenceSendTimer]);

  const scheduleSendFromSpeech = useCallback(() => {
    clearSilenceSendTimer();
    silenceSendTimerRef.current = window.setTimeout(() => {
      silenceSendTimerRef.current = null;
      if (
        suppressRef.current ||
        userMutedRef.current ||
        agentSpeakingRef.current ||
        statusRef.current === 'thinking'
      ) {
        return;
      }

      const interim = interimRef.current.trim();
      let pending = pendingRef.current.trim();
      if (interim) {
        pending = `${pending} ${interim}`.trim();
      }
      if (pending.length < MIN_SPEECH_CHARS) return;

      pendingRef.current = '';
      interimRef.current = '';
      setTranscript('');
      haltMicCapture(false);
      void sendToInterviewerRef.current(pending);
    }, SILENCE_SEND_MS);
  }, [clearSilenceSendTimer, haltMicCapture]);

  const scheduleResumeMic = useCallback(() => {
    if (userMutedRef.current || micSessionOver() || !shouldListenRef.current) return;
    window.setTimeout(() => {
      if (!userMutedRef.current && !suppressRef.current && !micSessionOver() && shouldListenRef.current) {
        startListeningRef.current?.();
      }
    }, 400);
  }, [micSessionOver]);

  const speakText = useCallback(
    (text: string) => {
      if (!text.trim() || !('speechSynthesis' in window)) return;

      window.speechSynthesis.cancel();
      haltMicCapture();

      if (!ttsEnabled) {
        suppressRef.current = false;
        setConversationStatus('ready');
        scheduleResumeMic();
        return;
      }

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95;
      utterance.lang = 'en-US';

      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(
        (v) => v.name.includes('Google') || v.name.includes('Microsoft') || v.lang.startsWith('en'),
      );
      if (preferred) utterance.voice = preferred;

      utterance.onstart = () => {
        agentSpeakingRef.current = true;
        setAgentSpeaking(true);
        haltMicCapture();
      };
      utterance.onend = () => {
        agentSpeakingRef.current = false;
        setAgentSpeaking(false);
        suppressRef.current = false;
        setConversationStatus('ready');
        scheduleResumeMic();
      };
      utterance.onerror = () => {
        agentSpeakingRef.current = false;
        setAgentSpeaking(false);
        suppressRef.current = false;
        setConversationStatus('ready');
        scheduleResumeMic();
      };

      window.speechSynthesis.speak(utterance);
    },
    [haltMicCapture, scheduleResumeMic, setConversationStatus, ttsEnabled],
  );

  const appendMessage = useCallback((role: 'assistant' | 'user', content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `${role}-${Date.now()}-${Math.random()}`, role, content, time: formatTime() },
    ]);
  }, []);

  const sendToInterviewer = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text) return;

      clearSilenceSendTimer();
      haltMicCapture();
      setConversationStatus('thinking');
      setTranscript('');
      appendMessage('user', text);
      try {
        const data = await sendVoiceMessage(candidateToken, text);
        if (data.reply) {
          setLastReply(data.reply);
          appendMessage('assistant', data.reply);
          speakText(data.reply);
        } else {
          suppressRef.current = false;
          setConversationStatus('ready');
          scheduleResumeMic();
        }
        setAgentTurns(data.agentTurns);
        if (data.userTurns != null) setUserTurns(data.userTurns);
        if (data.minTurns != null) setIntroMinTurns(data.minTurns);
        if (data.maxTurns != null) setIntroMaxTurns(data.maxTurns);
        if (data.voiceIntroComplete) {
          setVoiceIntroComplete(true);
        }
        if (data.complete && data.currentPhase === 'sandbox_code') {
          onPhaseChange?.(data.currentPhase);
        }
      } catch (err) {
        suppressRef.current = false;
        setError(err instanceof Error ? err.message : String(err));
        setConversationStatus('error');
        scheduleResumeMic();
      }
    },
    [
      appendMessage,
      candidateToken,
      clearSilenceSendTimer,
      haltMicCapture,
      onPhaseChange,
      scheduleResumeMic,
      setConversationStatus,
      speakText,
    ],
  );

  sendToInterviewerRef.current = sendToInterviewer;

  const restartListening = useCallback(() => {
    if (
      !visible ||
      suppressRef.current ||
      agentSpeakingRef.current ||
      micSessionOver() ||
      userMutedRef.current ||
      statusRef.current === 'thinking' ||
      recognitionRef.current
    ) {
      return;
    }
    startListeningRef.current?.();
  }, [micSessionOver, visible]);

  const startListening = useCallback(() => {
    if (
      !visible ||
      suppressRef.current ||
      agentSpeakingRef.current ||
      micSessionOver() ||
      userMutedRef.current ||
      statusRef.current === 'thinking' ||
      recognitionRef.current
    ) {
      return;
    }

    const Ctor = (window.SpeechRecognition || window.webkitSpeechRecognition) as
      | SpeechRecognitionCtor
      | undefined;
    if (!Ctor) {
      setSpeechSupported(false);
      setError('Speech recognition requires Chrome or Edge.');
      return;
    }

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onstart = () => {
      suppressRef.current = false;
      setConversationStatus('listening');
      setError(null);
    };

    recognition.onresult = (event: any) => {
      if (suppressRef.current) return;

      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const part = event.results[i][0]?.transcript ?? '';
        if (event.results[i].isFinal) {
          finalText += part;
        } else {
          interim += part;
        }
      }

      if (finalText) {
        pendingRef.current = `${pendingRef.current} ${finalText}`.trim();
        interimRef.current = '';
        setTranscript(pendingRef.current);
        scheduleSendFromSpeech();
      } else if (interim) {
        interimRef.current = interim;
        setTranscript(`${pendingRef.current} ${interim}`.trim());
        scheduleSendFromSpeech();
      }
    };

    recognition.onerror = (event: any) => {
      if (suppressRef.current && (event.error === 'aborted' || event.error === 'no-speech')) {
        return;
      }
      if (event.error === 'not-allowed') {
        setError('Microphone permission denied. Allow mic access and refresh.');
      } else if (event.error !== 'no-speech') {
        setError(`Speech error: ${event.error}`);
      }
      setConversationStatus('ready');
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (suppressRef.current) return;

      const interim = interimRef.current.trim();
      if (interim) {
        pendingRef.current = `${pendingRef.current} ${interim}`.trim();
        interimRef.current = '';
        setTranscript(pendingRef.current);
        scheduleSendFromSpeech();
      }

      if (!userMutedRef.current && shouldListenRef.current) {
        window.setTimeout(() => restartListening(), 300);
      } else {
        setConversationStatus('ready');
      }
    };

    recognitionRef.current = recognition;
    try {
      suppressRef.current = false;
      recognition.start();
    } catch {
      setError('Could not start microphone. Click Unmute to try again.');
      setConversationStatus('ready');
    }
  }, [
    restartListening,
    scheduleSendFromSpeech,
    setConversationStatus,
    visible,
  ]);

  startListeningRef.current = startListening;

  useEffect(() => {
    voiceIntroCompleteRef.current = voiceIntroComplete;
    introMaxTurnsRef.current = introMaxTurns;
    agentTurnsRef.current = agentTurns;
  }, [agentTurns, introMaxTurns, voiceIntroComplete]);

  const toggleMic = useCallback(() => {
    if (agentSpeakingRef.current || statusRef.current === 'thinking' || micSessionOver()) return;

    if (statusRef.current === 'listening') {
      userMutedRef.current = true;
      setUserMuted(true);

      const interim = interimRef.current.trim();
      let pending = pendingRef.current.trim();
      if (interim) {
        pending = `${pending} ${interim}`.trim();
      }

      haltMicCapture(false);
      setConversationStatus('ready');

      if (pending.length >= MIN_SPEECH_CHARS) {
        pendingRef.current = '';
        interimRef.current = '';
        setTranscript('');
        void sendToInterviewerRef.current(pending);
      } else {
        pendingRef.current = '';
        interimRef.current = '';
        setTranscript('');
      }
      return;
    }

    userMutedRef.current = false;
    setUserMuted(false);
    shouldListenRef.current = true;
    suppressRef.current = false;
    restartListening();
  }, [haltMicCapture, micSessionOver, restartListening, setConversationStatus]);

  useEffect(() => {
    const video = videoRef.current;
    const stream = mediaStreamRef.current;
    if (!videoEnabled || !video || !stream) return;
    video.srcObject = stream;
    void video.play().catch(() => { });
  }, [videoEnabled]);

  useEffect(() => {
    if (!visible) {
      shouldListenRef.current = false;
      startedRef.current = false;
      clearSilenceSendTimer();
      window.speechSynthesis?.cancel();
      recognitionRef.current?.abort();
      stopWebcam();
      return;
    }

    shouldListenRef.current = true;
    setSpeechSupported(Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));
    void startWebcam();

    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      setConversationStatus('thinking');
      try {
        const session = await getAutonomousSession(candidateToken);
        const priorTurns = session.introAgentTurns ?? 0;
        const priorUserTurns = session.introUserTurns ?? 0;
        setIntroMinTurns(session.introMinTurns ?? DEFAULT_INTRO_MIN);
        setIntroMaxTurns(session.introMaxTurns ?? DEFAULT_INTRO_MAX);
        setUserTurns(priorUserTurns);
        const history = session.introChatHistory ?? [];
        if (history.length) {
          setMessages(historyToMessages(history));
          const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant');
          if (lastAssistant) setLastReply(lastAssistant.content);
        }
        setAgentTurns(priorTurns);
        if (priorTurns >= (session.introMaxTurns ?? DEFAULT_INTRO_MAX)) {
          setVoiceIntroComplete(true);
          setConversationStatus('ready');
          return;
        }
        if (priorTurns > 0) {
          setConversationStatus('ready');
          scheduleResumeMic();
          return;
        }
        const data = await sendVoiceMessage(candidateToken, '');
        if (data.reply) {
          setLastReply(data.reply);
          appendMessage('assistant', data.reply);
          speakText(data.reply);
        }
        setAgentTurns(data.agentTurns);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setConversationStatus('error');
      }
    })();

    return () => {
      shouldListenRef.current = false;
      clearSilenceSendTimer();
      window.speechSynthesis?.cancel();
      stopWebcam();
      try {
        recognitionRef.current?.abort();
      } catch {
        /* ignore */
      }
    };
  }, [
    appendMessage,
    candidateToken,
    clearSilenceSendTimer,
    scheduleResumeMic,
    setConversationStatus,
    speakText,
    startWebcam,
    stopWebcam,
    visible,
  ]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status, transcript]);

  useEffect(() => {
    if (!visible) return;
    const tick = () => {
      const seconds = Math.floor((Date.now() - sessionStartRef.current) / 1000);
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');
      setElapsed(`${mm}:${ss}`);
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [visible]);

  const avatarGlowState = resolveSpeakingState({
    agentSpeaking,
    analyzing: status === 'thinking',
    listening: status === 'listening',
  });
  const voicePillPhase = useVoicePhaseProgress({
    visible,
    speakingState: avatarGlowState,
    backendPhase: phase,
    backendEngine:
      phase === 'hr_verbal'
        ? 'behavioral'
        : phase === 'ai_screening'
          ? 'screening'
          : 'technical',
  });

  if (!visible) return null;

  const showWave = status === 'listening' || agentSpeaking || status === 'thinking';
  const isMicLive = status === 'listening';
  const isAgentHold = agentSpeaking || status === 'thinking';
  const overlayLabel = agentSpeaking
    ? 'Speaking...'
    : status === 'listening'
      ? 'Listening...'
      : status === 'thinking'
        ? 'Thinking...'
        : null;
  const exchangeCount = userTurns + agentTurns;
  const conversationEnded = voiceIntroComplete && agentTurns >= introMaxTurns;
  const progressPct = Math.min(
    100,
    Math.round((agentTurns / Math.max(introMinTurns, 1)) * 100),
  );
  const interviewTitle = `${techStack} Interview`;
  const phaseLabel = phase === 'hr_verbal' ? 'HR Verbal' : 'AI Verbal';
  const showRecBadge = visible && !conversationEnded;

  return (
    <div className="conversation-session flex h-screen flex-col overflow-hidden bg-[var(--assessment-surface)] text-[var(--assessment-on-surface)]">
      <header className="fixed inset-x-0 top-0 z-50 flex h-14 items-center justify-between bg-[var(--assessment-primary)] px-4 shadow-md">
        <div className="flex min-w-0 items-center gap-4">
          <span className="shrink-0 text-base font-bold text-[var(--assessment-on-primary)]">
            Candidate Assessment
          </span>
          <div className="hidden h-6 w-px bg-white/30 sm:block" />
          <span className="hidden truncate text-xs font-medium uppercase tracking-wider text-white/80 sm:inline">
            {interviewTitle}
          </span>
        </div>
        <div className="flex items-center gap-4">
          {showRecBadge ? <InterviewRecBadge elapsed={elapsed} compact className="hidden sm:inline-flex" /> : null}
          <div className="hidden items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 sm:flex">
            <AssessmentMaterialIcon name="timer" size={18} className="text-white" />
            <span className="text-xs font-medium text-white">Timer: {elapsed}</span>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 sm:flex">
            <AssessmentMaterialIcon name="analytics" size={18} className="text-white" />
            <span className="text-xs font-medium text-white">
              Exchanges: {exchangeCount}
            </span>
          </div>
          <div className="ml-2 flex items-center gap-4 border-l border-white/20 pl-4">
            <div className="hidden items-center gap-2 sm:flex">
              <AssessmentMaterialIcon name="volume_up" size={18} className="text-white" />
              <span className="text-xs font-medium text-white">Enable TTS</span>
              <button
                type="button"
                aria-pressed={ttsEnabled}
                onClick={() => {
                  setTtsEnabled((v) => {
                    if (v) window.speechSynthesis.cancel();
                    return !v;
                  });
                }}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${ttsEnabled ? 'bg-white/30' : 'bg-white/20'
                  }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-[var(--assessment-surface-container)] transition-transform ${ttsEnabled ? 'translate-x-5' : 'translate-x-1'
                    }`}
                />
              </button>
            </div>
            <div className="hidden items-center gap-2 text-white md:flex">
              <AssessmentMaterialIcon
                name="wifi"
                size={20}
                className="cursor-pointer rounded-full p-2 transition-colors hover:bg-white/20"
              />
              <button
                type="button"
                onClick={toggleVideo}
                className="rounded-full p-2 transition-colors hover:bg-white/20"
                aria-label={videoEnabled ? 'Stop video' : 'Start video'}
              >
                <AssessmentMaterialIcon
                  name={videoEnabled ? 'videocam' : 'videocam_off'}
                  size={20}
                  className="text-white"
                />
              </button>
            </div>
            <button
              type="button"
              disabled={!conversationEnded}
              className="rounded-lg bg-[var(--assessment-surface-container)] px-6 py-2 text-xs font-bold text-[var(--assessment-primary)] transition-all hover:bg-[var(--color-primary-container)] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Submit
            </button>
          </div>
        </div>
      </header>

      <main className="mt-14 flex min-h-0 flex-1 bg-[var(--color-page)]">
        <section className="relative flex w-[70%] flex-col items-center justify-center overflow-hidden bg-[var(--color-primary-container)]/20 p-6">
          <div className="mb-3 w-full">
            <VoicePhasePillStrip active={voicePillPhase} />
          </div>
          {showRecBadge ? (
            <div className="mb-3 w-full sm:hidden">
              <InterviewRecBadge elapsed={elapsed} />
            </div>
          ) : null}
          <div className="group relative h-full w-full overflow-hidden rounded-xl border border-[var(--assessment-outline-variant)] bg-[#1d3054] shadow-sm">
            <div className={`avatar-glow-ring rounded-xl is-${avatarGlowState}`} aria-hidden />
            <div className="absolute inset-0 flex items-center justify-center">
              <img
                src={AI_INTERVIEWER_AVATAR_URL}
                alt="AI interviewer"
                className="h-full w-full object-cover object-[center_18%] brightness-[0.96] contrast-[1.04] saturate-[1.05]"
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0f1b33]/75 via-transparent to-[#0f1b33]/30" />
            </div>

            {overlayLabel ? (
              <div className="absolute left-6 top-6 flex flex-col gap-2">
                <div className="glass-card flex items-center gap-2 rounded-full px-4 py-2 shadow-lg">
                  <div className="h-2.5 w-2.5 animate-pulse rounded-full bg-[var(--assessment-primary-container)]" />
                  <span className="text-xs font-bold uppercase tracking-widest text-[var(--assessment-on-surface)]">
                    {overlayLabel}
                  </span>
                </div>
                {showWave ? (
                  <div className={`glass-card wave-container rounded-full px-4 py-2 shadow-lg is-${avatarGlowState}`}>
                    {Array.from({ length: 10 }).map((_, i) => (
                      <div
                        key={i}
                        className="wave-bar"
                        style={{ animationDelay: `${(i + 1) * 0.1}s` }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            <div className="glass-card absolute bottom-6 right-6 h-40 w-64 overflow-hidden rounded-lg border-2 border-[var(--assessment-primary-container)] bg-[#1d3054] shadow-2xl transition-transform hover:scale-105">
              {videoEnabled ? (
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="h-full w-full scale-x-[-1] object-cover"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-[#1d3054] text-white/70">
                  <AssessmentMaterialIcon name="videocam_off" size={32} />
                  <span className="text-[10px] font-medium uppercase tracking-wider">Camera off</span>
                </div>
              )}
              <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/50 px-2 py-0.5 text-[10px] text-white backdrop-blur-sm">
                <AssessmentMaterialIcon name="person" size={12} className="text-[var(--color-primary-fixed)]" />
                You (Candidate)
              </div>
              {videoEnabled ? (
                <div className="absolute right-2 top-2 flex items-center gap-1 rounded bg-green-600/80 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--assessment-surface-container)]" />
                  Live
                </div>
              ) : null}
            </div>
          </div>

          <div className="absolute bottom-10 left-1/2 z-10 flex -translate-x-1/2 items-center gap-6 rounded-full border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] px-10 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-xl transition-all hover:shadow-[0_12px_40px_rgba(0,0,0,0.18)]">
            <button
              type="button"
              disabled={!speechSupported || isAgentHold || conversationEnded}
              onClick={toggleMic}
              className="group flex flex-col items-center gap-1"
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${isMicLive
                  ? 'bg-[var(--assessment-primary)]/15 text-[var(--assessment-primary)] group-hover:bg-[var(--assessment-primary)] group-hover:text-white'
                  : isAgentHold || userMuted
                    ? 'bg-[var(--color-error-container)] text-[var(--assessment-error)]'
                    : 'bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)] group-hover:bg-[var(--assessment-primary)] group-hover:text-white'
                  }`}
              >
                <AssessmentMaterialIcon
                  name={isMicLive ? 'mic' : 'mic_off'}
                  size={24}
                />
              </div>
              <span
                className={`text-xs ${isMicLive
                  ? 'text-[var(--assessment-primary)]'
                  : isAgentHold || userMuted
                    ? 'text-[var(--assessment-error)]'
                    : 'text-[var(--assessment-on-surface-variant)] group-hover:text-[var(--assessment-primary)]'
                  }`}
              >
                {isAgentHold ? 'Muted' : isMicLive ? 'Mute' : 'Unmute'}
              </span>
            </button>

            <button
              type="button"
              onClick={toggleVideo}
              className="group flex flex-col items-center gap-1"
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-full transition-all ${videoEnabled
                  ? 'bg-[var(--assessment-primary)]/15 text-[var(--assessment-primary)] group-hover:bg-[var(--assessment-primary)] group-hover:text-white'
                  : 'bg-[var(--color-error-container)] text-[var(--assessment-error)] group-hover:bg-[var(--assessment-error)] group-hover:text-white'
                  }`}
              >
                <AssessmentMaterialIcon
                  name={videoEnabled ? 'videocam' : 'videocam_off'}
                  size={24}
                />
              </div>
              <span
                className={`text-xs ${videoEnabled
                  ? 'text-[var(--assessment-primary)] group-hover:text-[var(--assessment-primary)]'
                  : 'text-[var(--assessment-error)]'
                  }`}
              >
                {videoEnabled ? 'Stop Video' : 'Start Video'}
              </span>
            </button>

            <div className="mx-2 h-10 w-px bg-[var(--assessment-outline-variant)]" />

            <button type="button" className="group flex flex-col items-center gap-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--assessment-surface-container)] text-[var(--assessment-on-surface-variant)] transition-all group-hover:bg-[var(--assessment-primary-container)] group-hover:text-white">
                <AssessmentMaterialIcon name="screen_share" size={24} />
              </div>
              <span className="text-xs text-[var(--assessment-on-surface-variant)] group-hover:text-[var(--assessment-primary)]">
                Share Screen
              </span>
            </button>

            <button type="button" className="group flex flex-col items-center gap-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[var(--assessment-error)]/20 bg-[var(--color-error-container)]/20 text-[var(--assessment-error)] transition-all hover:bg-[var(--assessment-error)] hover:text-white active:scale-90">
                <AssessmentMaterialIcon name="call_end" size={24} />
              </div>
              <span className="text-xs text-[var(--assessment-error)]">End Session</span>
            </button>
          </div>
        </section>

        <aside className="flex w-[30%] min-w-[300px] flex-col border-l border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)]">
          <div className="border-b border-[var(--assessment-outline-variant)] p-6">
            <h2 className="mb-4 text-base font-semibold text-[var(--assessment-on-surface)]">
              Interview Progress
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                  In conversation
                </span>
                <span className="rounded bg-[var(--assessment-primary-container)]/10 px-2 py-0.5 text-[11px] font-bold uppercase text-[var(--assessment-primary-container)]">
                  {exchangeCount} exchanges
                </span>
              </div>
              <p className="text-sm font-semibold leading-relaxed text-[var(--assessment-on-surface)]">
                {lastReply
                  ? lastReply
                  : conversationEnded
                    ? 'Voice introduction complete.'
                    : 'The interviewer will open the conversation shortly...'}
              </p>
              <p className="text-xs text-[var(--assessment-on-surface-variant)]">
                {status === 'listening'
                  ? 'Speak naturally - pause when you are done and the interviewer will respond.'
                  : agentSpeaking
                    ? 'Listen to the interviewer. Your mic will turn on when they finish.'
                    : conversationEnded
                      ? 'Intro complete. You can review the transcript above.'
                      : 'Follow-up questions adapt to what you say - take your time.'}
              </p>
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--assessment-surface-container-high)]">
                <div
                  className="h-full rounded-full bg-[var(--assessment-primary)] transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <p className="text-[11px] uppercase tracking-wider text-[var(--assessment-on-surface-variant)]">
                {phaseLabel}
              </p>
            </div>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between p-6 pb-2">
              <h3 className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[var(--assessment-on-surface-variant)]">
                <AssessmentMaterialIcon
                  name="record_voice_over"
                  size={16}
                  className="text-[var(--assessment-primary)]"
                />
                Live Transcript
              </h3>
              <div className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                <span className="text-[11px] font-medium text-[var(--assessment-on-surface-variant)]">
                  Auto-scrolling
                </span>
              </div>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 pb-6">
              {messages.map((msg) => (
                <div key={msg.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${msg.role === 'assistant'
                        ? 'bg-[var(--assessment-primary-container)]'
                        : 'bg-[var(--color-primary-fixed-dim,#93c5fd)] text-[var(--color-on-primary-container)]'
                        }`}
                    >
                      {msg.role === 'assistant' ? 'AI' : 'You'}
                    </div>
                    <span className="text-xs font-medium text-[var(--assessment-on-surface)]">
                      {msg.role === 'assistant' ? 'CodeVox AI' : 'You'}
                    </span>
                    <span className="text-[10px] text-[var(--assessment-on-surface-variant)]">
                      {msg.time}
                    </span>
                  </div>
                  <p
                    className={`rounded-lg border p-4 text-sm leading-relaxed ${msg.role === 'assistant'
                      ? 'border-[var(--assessment-outline-variant)]/30 bg-[var(--assessment-surface-container)]/30 text-[var(--assessment-on-surface-variant)]'
                      : 'border-l-4 border-l-[var(--assessment-primary)] border-[var(--assessment-primary)]/10 bg-[var(--assessment-primary)]/5 text-[var(--assessment-on-surface)]'
                      }`}
                  >
                    {msg.content}
                  </p>
                </div>
              ))}

              {transcript ? (
                <div className="flex flex-col gap-2 opacity-80">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-primary-fixed-dim,#93c5fd)] text-[10px] font-bold text-[var(--color-on-primary-container)]">
                      You
                    </div>
                    <span className="text-xs font-medium text-[var(--assessment-on-surface)]">You</span>
                    <span className="text-[10px] text-[var(--assessment-on-surface-variant)]">Speaking...</span>
                  </div>
                  <p className="rounded-lg border-l-4 border-l-[var(--assessment-primary)] border-[var(--assessment-primary)]/10 bg-[var(--assessment-primary)]/5 p-4 text-sm italic leading-relaxed text-[var(--assessment-on-surface)]">
                    {transcript}
                  </p>
                </div>
              ) : null}

              {status === 'thinking' ? (
                <div className="flex animate-pulse flex-col gap-2 opacity-80">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--assessment-primary-container)] text-[10px] font-bold text-white">
                      AI
                    </div>
                    <span className="text-xs font-medium text-[var(--assessment-on-surface)]">
                      CodeVox AI
                    </span>
                    <span className="text-[10px] text-[var(--assessment-on-surface-variant)]">
                      Just now
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--assessment-primary-container)]/40" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--assessment-primary-container)]/60 [animation-delay:0.2s]" />
                    <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--assessment-primary-container)]/80 [animation-delay:0.4s]" />
                  </div>
                </div>
              ) : null}

              {error ? (
                <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {error}
                </p>
              ) : null}

              {cameraError ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                  {cameraError}
                </p>
              ) : null}

              {!speechSupported ? (
                <p className="text-sm text-[var(--assessment-on-surface-variant)]">
                  Use Chrome or Edge for voice interviews.
                </p>
              ) : null}

              <div ref={transcriptEndRef} />
            </div>
          </div>

          <div className="border-t border-[var(--assessment-outline-variant)] bg-[var(--color-surface-container,#f1f5f9)] p-6">
            <button
              type="button"
              className="flex w-full items-center justify-center gap-4 rounded-lg border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container)] py-3 text-xs font-medium text-[var(--assessment-on-surface-variant)] transition-colors hover:bg-[var(--assessment-surface-container)]"
            >
              <AssessmentMaterialIcon name="note_add" size={18} />
              Add Quick Note
            </button>
          </div>
        </aside>
      </main>
    </div>
  );
}

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionCtor;
    webkitSpeechRecognition: SpeechRecognitionCtor;
  }
}
