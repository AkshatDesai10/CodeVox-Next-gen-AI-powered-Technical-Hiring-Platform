'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  hasMeaningfulSource,
  provisionWorkspace,
  resolveWorkspaceFilesFromSource,
  serializeVfsSnapshot,
  syncWorkspaceFiles,
  type WorkspaceFileNode,
} from '@/lib/workspace-api';
import { MultiFileMonacoEditor } from '@/modules/assessments/components/ide/MultiFileMonacoEditor';
import { VirtualFileTree } from '@/modules/assessments/components/ide/VirtualFileTree';
import { WorkspaceTerminal } from '@/modules/assessments/components/ide/WorkspaceTerminal';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

function buildTreeFromFiles(files: Record<string, string>): WorkspaceFileNode[] {
  const paths = Object.keys(files).sort();
  const root: WorkspaceFileNode[] = [];

  for (const filePath of paths) {
    const parts = filePath.split('/');
    let current = root;
    let prefix = '';
    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      prefix = prefix ? `${prefix}/${part}` : part;
      const isFile = i === parts.length - 1;
      if (!isFile) {
        let dir = current.find((n) => n.path === prefix && n.type === 'directory');
        if (!dir) {
          dir = { path: prefix, name: part, type: 'directory', children: [] };
          current.push(dir);
        }
        current = dir.children ?? [];
      } else {
        current.push({ path: filePath, name: part, type: 'file' });
      }
    }
  }
  return root;
}

export function IdeWorkspace(props: {
  candidateAssessmentId: string;
  language: string;
  initialSource: string;
  readOnly?: boolean;
  running?: boolean;
  onRun?: () => void;
  onSerializedChange: (serialized: string) => void;
}) {
  const resolved = useMemo(
    () => resolveWorkspaceFilesFromSource(props.initialSource, props.language),
    [props.initialSource, props.language],
  );

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [entryFile, setEntryFile] = useState(resolved.entryFile);
  const [files, setFiles] = useState(resolved.files);
  const [activePath, setActivePath] = useState<string | null>(resolved.entryFile);
  const [terminalHeight, setTerminalHeight] = useState(220);

  const fileTree = useMemo(() => buildTreeFromFiles(files), [files]);
  const lastEmittedRef = useRef<string | null>(null);
  const { onSerializedChange } = props;

  const emitSerialized = useCallback(
    (nextFiles: Record<string, string>, nextEntry = entryFile) => {
      const serialized = serializeVfsSnapshot(nextEntry, nextFiles);
      if (serialized === lastEmittedRef.current) return;
      lastEmittedRef.current = serialized;
      onSerializedChange(serialized);
    },
    [entryFile, onSerializedChange],
  );

  useEffect(() => {
    const next = resolveWorkspaceFilesFromSource(props.initialSource, props.language);
    const serialized = serializeVfsSnapshot(next.entryFile, next.files);
    if (serialized === lastEmittedRef.current) return;
    if (!hasMeaningfulSource(props.initialSource)) return;
    setEntryFile(next.entryFile);
    setFiles(next.files);
    setActivePath(next.entryFile);
    lastEmittedRef.current = serialized;
    if (ready) {
      void syncWorkspaceFiles(props.candidateAssessmentId, next.files).catch(() => undefined);
    }
  }, [props.initialSource, props.language, props.candidateAssessmentId, ready]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const snapshot = resolveWorkspaceFilesFromSource(props.initialSource, props.language);
        await provisionWorkspace(props.candidateAssessmentId, {
          language: props.language,
          entry_file: snapshot.entryFile,
          files: snapshot.files,
        });
        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
      setReady(false);
    };
  }, [props.candidateAssessmentId, props.language]);

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => {
      void syncWorkspaceFiles(props.candidateAssessmentId, files).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [files, props.candidateAssessmentId, ready]);

  useEffect(() => {
    if (!hasMeaningfulSource(serializeVfsSnapshot(entryFile, files))) return;
    emitSerialized(files);
  }, [files, entryFile, emitSerialized]);

  const updateFile = (path: string, content: string) => {
    setFiles((prev) => ({ ...prev, [path]: content }));
  };

  const createFile = (dir = '') => {
    const name = window.prompt('New file name', 'untitled.txt');
    if (!name?.trim()) return;
    const path = dir ? `${dir}/${name.trim()}` : name.trim();
    setFiles((prev) => ({ ...prev, [path]: '' }));
    setActivePath(path);
  };

  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-red-400">
        Workspace failed to start: {error}
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-white/60">
        Starting remote workspace...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-white/10 bg-neutral-900 px-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-white/50">
          Workspace
        </span>
        {props.onRun ? (
          <button
            type="button"
            disabled={props.running || props.readOnly}
            onClick={props.onRun}
            className="flex items-center gap-1 rounded-lg bg-[var(--assessment-primary)] px-4 py-1.5 text-xs font-bold text-white transition-all hover:bg-[#295bb5] active:scale-95 disabled:opacity-60"
          >
            <AssessmentMaterialIcon name="play_arrow" size={18} className="text-white" />
            {props.running ? 'Running...' : 'Run Code'}
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-52 shrink-0 border-r border-black/30">
          <VirtualFileTree
            tree={fileTree}
            activePath={activePath}
            onSelect={setActivePath}
            onCreateFile={() => createFile()}
            onCreateFileInDir={(dir) => createFile(dir)}
          />
        </aside>
        <div className="min-w-0 flex-1">
          <MultiFileMonacoEditor
            activePath={activePath}
            files={files}
            readOnly={props.readOnly}
            onChange={updateFile}
            onSelect={setActivePath}
          />
        </div>
      </div>
      <div
        className="shrink-0 border-t border-black/30"
        style={{ height: terminalHeight }}
      >
        <div
          className="h-1 cursor-row-resize bg-white/5 hover:bg-[var(--assessment-primary)]/40"
          onMouseDown={(event) => {
            const startY = event.clientY;
            const startH = terminalHeight;
            const onMove = (e: MouseEvent) => {
              setTerminalHeight(Math.max(120, Math.min(480, startH + (startY - e.clientY))));
            };
            const onUp = () => {
              window.removeEventListener('mousemove', onMove);
              window.removeEventListener('mouseup', onUp);
            };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
          }}
        />
        <div className="h-[calc(100%-4px)]">
          <WorkspaceTerminal
            candidateAssessmentId={props.candidateAssessmentId}
            enabled={ready}
          />
        </div>
      </div>
    </div>
  );
}
