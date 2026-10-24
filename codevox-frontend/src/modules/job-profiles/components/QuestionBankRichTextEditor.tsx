'use client';

import { EditorContent, useEditor } from '@tiptap/react';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import StarterKit from '@tiptap/starter-kit';
import { AssessmentMaterialIcon } from '@/modules/assessments/components/AssessmentMaterialIcon';

export type QuestionEditorValue = { html: string; text: string };

type ToolbarAction = 'bold' | 'italic' | 'bulletList' | 'link';

function ToolbarButton(props: {
  label: string;
  icon: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      onMouseDown={(e) => e.preventDefault()}
      onClick={props.onClick}
      className={`rounded p-0.5 transition hover:text-[var(--assessment-primary)] ${
        props.active ? 'text-[var(--assessment-primary)]' : ''
      }`}
    >
      <AssessmentMaterialIcon name={props.icon} size={18} />
    </button>
  );
}

export function QuestionBankRichTextEditor(props: {
  initialHtml?: string;
  placeholder?: string;
  onChange: (value: QuestionEditorValue) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({
        placeholder: props.placeholder ?? 'Describe the specific situation or technical problem the candidate needs to solve...',
      }),
    ],
    content: props.initialHtml ?? '',
    editorProps: {
      attributes: {
        class:
          'question-bank-rich-editor__content min-h-[120px] px-4 py-4 text-sm text-[var(--assessment-on-surface)] outline-none',
      },
    },
    onUpdate: ({ editor: ed }) => {
      props.onChange({ html: ed.getHTML(), text: ed.getText() });
    },
  });

  const run = (action: ToolbarAction) => {
    if (!editor) return;
    const chain = editor.chain().focus();
    if (action === 'bold') chain.toggleBold().run();
    if (action === 'italic') chain.toggleItalic().run();
    if (action === 'bulletList') chain.toggleBulletList().run();
    if (action === 'link') {
      const prev = editor.getAttributes('link').href as string | undefined;
      const href = window.prompt('Link URL', prev ?? 'https://');
      if (href === null) return;
      if (!href.trim()) {
        editor.chain().focus().unsetLink().run();
        return;
      }
      editor.chain().focus().setLink({ href: href.trim() }).run();
    }
  };

  return (
    <div className="question-bank-rich-editor w-full overflow-hidden rounded-lg border border-[var(--assessment-outline-variant)] transition focus-within:border-transparent focus-within:ring-2 focus-within:ring-[var(--assessment-primary)]">
      <div className="flex gap-4 border-b border-[var(--assessment-outline-variant)] bg-[var(--assessment-surface-container-low)] px-4 py-2 text-[var(--assessment-on-surface-variant)]">
        <ToolbarButton label="Bold" icon="format_bold" active={editor?.isActive('bold')} onClick={() => run('bold')} />
        <ToolbarButton
          label="Italic"
          icon="format_italic"
          active={editor?.isActive('italic')}
          onClick={() => run('italic')}
        />
        <ToolbarButton
          label="Bullet list"
          icon="format_list_bulleted"
          active={editor?.isActive('bulletList')}
          onClick={() => run('bulletList')}
        />
        <ToolbarButton label="Insert link" icon="link" active={editor?.isActive('link')} onClick={() => run('link')} />
        <div className="ml-auto flex items-center gap-1 text-xs font-bold text-[var(--nexus-secondary)]">
          <AssessmentMaterialIcon name="spark" size={16} />
          AI Assist On
        </div>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
