'use client';

import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import { workspaceWsUrl } from '@/lib/workspace-api';
import '@xterm/xterm/css/xterm.css';

export function WorkspaceTerminal(props: {
  candidateAssessmentId: string;
  enabled: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!props.enabled || !containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 13,
      theme: {
        background: '#0a0a0a',
        foreground: '#e5e5e5',
        cursor: '#7aa2ff',
      },
      convertEol: true,
    });
    const fit = new FitAddon();
    const links = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(links);
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    const ws = new WebSocket(workspaceWsUrl());
    socketRef.current = ws;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'attach',
          candidateAssessmentId: props.candidateAssessmentId,
        }),
      );
    };

    ws.onmessage = (event) => {
      const data = typeof event.data === 'string' ? event.data : '';
      if (data.startsWith('{') && data.includes('"type"')) {
        try {
          const msg = JSON.parse(data) as { type?: string; message?: string };
          if (msg.type === 'error') {
            term.writeln(`\r\n\x1b[31m${msg.message ?? 'Terminal error'}\x1b[0m`);
          } else if (msg.type === 'ready') {
            term.writeln('\r\n\x1b[32mConnected to workspace shell (/workspace)\x1b[0m');
          } else if (msg.type === 'exit') {
            term.writeln('\r\n\x1b[33mShell session ended\x1b[0m');
          }
          return;
        } catch {
          // fall through - raw output
        }
      }
      term.write(data);
    };

    ws.onerror = () => {
      term.writeln('\r\n\x1b[31mTerminal connection failed\x1b[0m');
    };

    ws.onclose = () => {
      term.writeln('\r\n\x1b[33mTerminal disconnected\x1b[0m');
    };

    const dataDisposable = term.onData((input) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data: input }));
      }
    });

    const resizeObserver = new ResizeObserver(() => fit.fit());
    resizeObserver.observe(containerRef.current);

    return () => {
      dataDisposable.dispose();
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      socketRef.current = null;
      fitRef.current = null;
    };
  }, [props.candidateAssessmentId, props.enabled]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0a0a0a]">
      <div className="flex h-8 shrink-0 items-center border-b border-white/10 px-3 text-[11px] font-semibold uppercase tracking-wider text-white/50">
        Terminal
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 p-1" />
    </div>
  );
}
