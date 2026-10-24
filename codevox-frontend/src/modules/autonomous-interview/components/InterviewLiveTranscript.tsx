'use client';

import { useEffect, useRef } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

export type ChatMessage = {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  time: string;
  rubric?: string;
  questionKind?: 'primary' | 'followup';
};

type Props = {
  messages: ChatMessage[];
  interimTranscript?: string;
  showThinking?: boolean;
  error?: string | null;
  autoScroll?: boolean;
  variant?: 'default' | 'hub';
};

export function formatChatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function historyToChatMessages(
  history: { role: string; content: string; rubric?: string; question_kind?: string }[],
): ChatMessage[] {
  return history.map((entry, index) => ({
    id: `hist-${index}`,
    role: entry.role === 'assistant' ? 'assistant' : 'user',
    content: entry.content,
    time: formatChatTime(),
    rubric: entry.rubric?.trim() || undefined,
    questionKind: entry.question_kind === 'followup' ? 'followup' : entry.question_kind === 'primary' ? 'primary' : undefined,
  }));
}

export function InterviewLiveTranscript({
  messages,
  interimTranscript,
  showThinking,
  error,
  autoScroll = true,
  variant = 'default',
}: Props) {
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!autoScroll) return;
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, interimTranscript, showThinking, error, autoScroll]);

  if (variant === 'hub') {
    return (
      <div
        className="custom-scrollbar flex-1 select-text space-y-4 overflow-y-auto p-4"
        id="transcript-container"
      >
        {messages.length === 0 && !interimTranscript && !showThinking ? (
          <p className="text-sm leading-relaxed text-[var(--assessment-on-surface-variant)]">
            Conversation transcript appears here as you and the interviewer speak.
          </p>
        ) : null}

        {messages.map((msg) =>
          msg.role === 'assistant' ? (
            <div key={msg.id} className="flex max-w-[90%] flex-col items-start gap-1">
              <div className="flex items-center gap-1.5 px-1">
                <span className="text-xs font-semibold text-[var(--assessment-on-surface)]">
                  AI Interviewer
                </span>
                <span className="font-mono-label text-[10px] text-[var(--assessment-on-surface-variant)]">
                  {msg.time}
                </span>
              </div>
              <div className="rounded-lg border border-[var(--assessment-outline-variant)]/30 border-l-4 border-l-[var(--assessment-primary)] bg-[var(--assessment-surface-container)]/40 p-3 text-xs leading-relaxed text-[var(--assessment-on-surface)] shadow-sm">
                {msg.content}
              </div>
            </div>
          ) : (
            <div key={msg.id} className="ml-auto flex max-w-[90%] flex-col items-end gap-1">
              <div className="flex items-center gap-1.5 px-1">
                <span className="font-mono-label text-[10px] text-[var(--assessment-on-surface-variant)]">
                  {msg.time}
                </span>
                <span className="text-xs font-semibold text-[var(--assessment-on-surface)]">You</span>
              </div>
              <div className="rounded-lg border border-[var(--assessment-primary)]/10 border-l-4 border-l-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5 p-3 text-xs leading-relaxed text-[var(--assessment-on-surface)] shadow-sm">
                {msg.content}
              </div>
            </div>
          ),
        )}

        {interimTranscript ? (
          <div className="ml-auto flex max-w-[90%] flex-col items-end gap-1">
            <div className="flex items-center gap-1.5 px-1">
              <span className="font-mono-label animate-pulse text-[10px] font-medium text-[var(--assessment-primary)]">
                Transcribing speech...
              </span>
              <span className="text-xs font-semibold text-[var(--assessment-on-surface)]">You</span>
            </div>
            <div className="rounded-lg border border-[var(--assessment-primary)]/10 border-l-4 border-l-[var(--assessment-primary)] bg-[var(--assessment-primary)]/5 p-3 text-xs leading-relaxed text-[var(--assessment-on-surface)] shadow-sm">
              {interimTranscript}
              <span className="ml-1 inline-block h-3.5 w-1.5 animate-pulse bg-[var(--assessment-primary)]" />
            </div>
          </div>
        ) : null}

        {showThinking ? (
          <div className="flex max-w-[90%] flex-col items-start gap-1 opacity-80">
            <div className="flex items-center gap-1.5 px-1">
              <span className="text-xs font-semibold text-[var(--assessment-on-surface)]">
                AI Interviewer
              </span>
              <span className="font-mono-label animate-pulse text-[10px] text-[var(--assessment-on-surface-variant)]">
                Thinking...
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm border border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-lowest)] px-3 py-2 shadow-sm">
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--assessment-primary)]/40" />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--assessment-primary)]/60 [animation-delay:0.2s]" />
              <div className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--assessment-primary)]/80 [animation-delay:0.4s]" />
            </div>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>
        ) : null}

        <div ref={transcriptEndRef} />
      </div>
    );
  }

  return (
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
        {messages.length === 0 && !interimTranscript && !showThinking ? (
          <p className="text-sm leading-relaxed text-[var(--assessment-on-surface-variant)]">
            Conversation transcript appears here as you and the interviewer speak.
          </p>
        ) : null}

        {messages.map((msg) => (
          <div key={msg.id} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <div
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                  msg.role === 'assistant'
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
              className={`rounded-lg border p-4 text-sm leading-relaxed ${
                msg.role === 'assistant'
                  ? 'border-[var(--assessment-outline-variant)]/30 bg-[var(--assessment-surface-container)]/30 text-[var(--assessment-on-surface-variant)]'
                  : 'border-l-4 border-l-[var(--assessment-primary)] border-[var(--assessment-primary)]/10 bg-[var(--assessment-primary)]/5 text-[var(--assessment-on-surface)]'
              }`}
            >
              {msg.content}
            </p>
          </div>
        ))}

        {interimTranscript ? (
          <div className="flex flex-col gap-2 opacity-80">
            <div className="flex items-center gap-2">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--color-primary-fixed-dim,#93c5fd)] text-[10px] font-bold text-[var(--color-on-primary-container)]">
                You
              </div>
              <span className="text-xs font-medium text-[var(--assessment-on-surface)]">You</span>
              <span className="text-[10px] text-[var(--assessment-on-surface-variant)]">
                Speaking...
              </span>
            </div>
            <p className="rounded-lg border-l-4 border-l-[var(--assessment-primary)] border-[var(--assessment-primary)]/10 bg-[var(--assessment-primary)]/5 p-4 text-sm italic leading-relaxed text-[var(--assessment-on-surface)]">
              {interimTranscript}
            </p>
          </div>
        ) : null}

        {showThinking ? (
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

        <div ref={transcriptEndRef} />
      </div>
    </div>
  );
}
