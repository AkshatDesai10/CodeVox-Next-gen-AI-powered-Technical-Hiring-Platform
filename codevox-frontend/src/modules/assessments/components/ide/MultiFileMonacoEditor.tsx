'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { monacoLanguageForPath } from '@/lib/workspace-api';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-sm text-white/60">
      Loading editor...
    </div>
  ),
});

export function MultiFileMonacoEditor(props: {
  activePath: string | null;
  files: Record<string, string>;
  readOnly?: boolean;
  onChange: (path: string, content: string) => void;
  onSelect?: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(360);
  const activePath = props.activePath ?? Object.keys(props.files)[0] ?? null;
  const value = activePath ? (props.files[activePath] ?? '') : '';

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const update = () => setHeight(Math.max(240, node.clientHeight));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const language = useMemo(
    () => (activePath ? monacoLanguageForPath(activePath) : 'plaintext'),
    [activePath],
  );

  const openTabs = Object.keys(props.files);

  return (
    <div className="workspace-code-editor-bg flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-white/5 bg-neutral-900 px-2">
        {openTabs.map((path) => (
          <button
            key={path}
            type="button"
            onClick={() => props.onSelect?.(path)}
            className={`shrink-0 rounded px-2 py-1 text-xs ${
              path === activePath ? 'bg-white/10 text-white' : 'text-white/50 hover:text-white/80'
            }`}
          >
            {path.split('/').pop()}
          </button>
        ))}
      </div>
      <div ref={containerRef} className="min-h-0 flex-1">
        {activePath ? (
          <MonacoEditor
            key={activePath}
            height={height}
            language={language}
            value={value}
            onChange={(next) => props.onChange(activePath, next ?? '')}
            theme="vs-dark"
            options={{
              readOnly: props.readOnly,
              minimap: { enabled: false },
              fontFamily: 'JetBrains Mono, monospace',
              fontSize: 14,
              lineHeight: 22,
              automaticLayout: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              padding: { top: 12, bottom: 12 },
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-white/50">
            Select or create a file
          </div>
        )}
      </div>
    </div>
  );
}
