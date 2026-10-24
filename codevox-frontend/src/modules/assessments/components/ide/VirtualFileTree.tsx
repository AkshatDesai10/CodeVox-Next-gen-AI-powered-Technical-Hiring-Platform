'use client';

import { useState } from 'react';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';
import type { WorkspaceFileNode } from '@/lib/workspace-api';

function FileTreeNode(props: {
  node: WorkspaceFileNode;
  depth: number;
  activePath: string | null;
  onSelect: (path: string) => void;
  onCreateFile: (dir: string) => void;
}) {
  const { node, depth, activePath, onSelect, onCreateFile } = props;
  const isDir = node.type === 'directory';
  const isActive = !isDir && node.path === activePath;
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <div
        className={`group flex w-full items-center gap-1 rounded text-left text-xs ${
          isActive ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
        }`}
        style={{ paddingLeft: `${8 + depth * 12}px` }}
      >
        <button
          type="button"
          onClick={() => {
            if (isDir) setExpanded((prev) => !prev);
            else onSelect(node.path);
          }}
          className="flex min-w-0 flex-1 items-center gap-2 py-1 pr-1 text-left"
        >
          {isDir ? (
            <AssessmentMaterialIcon
              name={expanded ? 'folder_open' : 'folder'}
              size={16}
              className="shrink-0 text-white/50"
            />
          ) : (
            <AssessmentMaterialIcon
              name="description"
              size={16}
              className={isActive ? 'shrink-0 text-[var(--assessment-primary)]' : 'shrink-0 text-white/50'}
            />
          )}
          <span className="truncate">{node.name}</span>
        </button>
        {isDir ? (
          <button
            type="button"
            onClick={() => onCreateFile(node.path)}
            className="mr-1 shrink-0 p-1 text-white/40 opacity-0 transition-opacity hover:text-white group-hover:opacity-100"
            title="New file in folder"
          >
            <AssessmentMaterialIcon name="note_add" size={14} />
          </button>
        ) : null}
      </div>
      {isDir && expanded && node.children?.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          activePath={activePath}
          onSelect={onSelect}
          onCreateFile={onCreateFile}
        />
      ))}
    </div>
  );
}

export function VirtualFileTree(props: {
  tree: WorkspaceFileNode[];
  activePath: string | null;
  onSelect: (path: string) => void;
  onCreateFile: () => void;
  onCreateFileInDir: (dir: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#252526] text-white">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-white/10 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">
          Explorer
        </span>
        <button
          type="button"
          onClick={props.onCreateFile}
          className="text-white/60 hover:text-white"
          title="New file"
        >
          <AssessmentMaterialIcon name="note_add" size={16} />
        </button>
      </div>
      <div className="workspace-scroll min-h-0 flex-1 overflow-y-auto py-2">
        {props.tree.length ? (
          props.tree.map((node) => (
            <FileTreeNode
              key={node.path}
              node={node}
              depth={0}
              activePath={props.activePath}
              onSelect={props.onSelect}
              onCreateFile={props.onCreateFileInDir}
            />
          ))
        ) : (
          <p className="px-3 text-xs text-white/40">No files yet</p>
        )}
      </div>
    </div>
  );
}
