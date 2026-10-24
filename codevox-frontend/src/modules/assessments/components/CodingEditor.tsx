'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[320px] items-center justify-center text-sm text-white/60">
      Loading editor...
    </div>
  ),
});

const LANGUAGE_OPTIONS = ['PHP', 'PYTHON', 'NODE', 'JAVASCRIPT', 'JAVA', 'SQL'];

function solutionFileName(language: string) {
  const key = language.toUpperCase();
  if (key === 'PHP') return 'solution.php';
  if (key === 'PYTHON') return 'solution.py';
  if (key === 'SQL') return 'solution.sql';
  if (key === 'JAVA') return 'Solution.java';
  return 'solution.js';
}

export function CodingEditor(props: {
  language: string;
  value: string;
  onChange: (value: string) => void;
  onLanguageChange: (language: string) => void;
  onRun?: () => void;
  running?: boolean;
  readOnly?: boolean;
  autosaveEnabled?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [editorHeight, setEditorHeight] = useState(420);

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const updateHeight = () => {
      setEditorHeight(Math.max(320, node.clientHeight));
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const monacoLanguage = useMemo(() => {
    const key = props.language.toUpperCase();
    if (key === 'PHP') return 'php';
    if (key === 'PYTHON') return 'python';
    if (key === 'NODE' || key === 'JAVASCRIPT') return 'javascript';
    if (key === 'JAVA') return 'java';
    if (key === 'SQL') return 'sql';
    return 'plaintext';
  }, [props.language]);

  return (
    <div className="workspace-code-editor-bg group relative flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/5 bg-neutral-900 px-4">
        <div className="flex h-full items-center gap-4">
          <div className="flex items-center gap-1 rounded bg-white/10 px-2 py-1 text-white">
            <AssessmentMaterialIcon name="code" size={18} className="text-white" />
            <select
              value={props.language}
              onChange={(e) => props.onLanguageChange(e.target.value)}
              disabled={props.readOnly}
              className="cursor-pointer border-none bg-transparent p-0 text-sm text-white focus:ring-0"
            >
              {LANGUAGE_OPTIONS.map((lang) => (
                <option key={lang} value={lang} className="text-black">
                  {solutionFileName(lang)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[11px] font-medium uppercase tracking-widest text-white/40">
            Autosave: {props.autosaveEnabled === false ? 'Off' : 'Enabled'}
          </span>
          <AssessmentMaterialIcon name="settings" size={18} className="text-white/60" />
        </div>
      </div>

      <div ref={containerRef} className="min-h-0 flex-1">
        <MonacoEditor
          height={editorHeight}
          language={monacoLanguage}
          value={props.value}
          onChange={(value) => props.onChange(value ?? '')}
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
            padding: { top: 16, bottom: 16 },
          }}
        />
      </div>

      {props.onRun ? (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-10 -translate-x-1/2 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100">
          <button
            type="button"
            disabled={props.running || props.readOnly}
            onClick={props.onRun}
            className="pointer-events-auto flex items-center gap-1 rounded-full border border-white/10 bg-neutral-800 px-6 py-2 font-bold text-white shadow-2xl transition-all hover:bg-[var(--assessment-primary)] active:scale-95 disabled:opacity-60"
          >
            <AssessmentMaterialIcon name="play_arrow" size={20} className="text-white" />
            {props.running ? 'Running...' : 'Run Code'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
