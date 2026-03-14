"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  Bold,
  Heading2,
  Heading3,
  Italic,
  List,
  ListOrdered,
  Quote,
  Redo2,
  RotateCcw,
  Undo2,
} from "lucide-react";
import { stripHtml } from "@/lib/study-docs";
import type { StoredPdfHighlight } from "./DocsLibraryClient";

const PdfInlineViewer = dynamic(() => import("./PdfInlineViewer"), {
  ssr: false,
  loading: () => <div className="study-doc-pdf-empty">Loading PDF viewer…</div>,
});

type StudyDocDraft = {
  title: string;
  contentHtml: string;
  updatedAt: string;
};

type StudyDocEditorProps = {
  mode: "read" | "edit" | "pdf";
  baseTitle: string;
  baseContent: string;
  hasText: boolean;
  hasPdf: boolean;
  pdfUrl?: string | null;
  pdfLoading?: boolean;
  pdfFileName?: string;
  pdfHighlights: StoredPdfHighlight[];
  savedTitle?: string;
  savedContent?: string;
  savedUpdatedAt?: string;
  onPdfHighlightsChange: (highlights: StoredPdfHighlight[]) => void;
  onDraftChange: (draft: StudyDocDraft) => void;
  onResetDraft: () => void;
};

function countWords(value: string): number {
  const words = value.trim().match(/\S+/g);
  return words ? words.length : 0;
}

function formatSavedAt(value?: string): string {
  if (!value) {
    return "Local draft";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Local draft";
  }

  return `Saved ${date.toLocaleString()}`;
}

function ToolbarButton({
  active,
  disabled,
  label,
  onClick,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={[
        "inline-flex h-9 min-w-9 items-center justify-center rounded-lg border px-2.5 text-sm transition",
        active
          ? "border-border bg-bg-elevated text-text-primary"
          : "border-transparent text-text-secondary hover:border-border hover:bg-bg-base hover:text-text-primary",
        disabled ? "cursor-not-allowed opacity-40" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

export default function StudyDocEditor({
  mode,
  baseTitle,
  baseContent,
  hasText,
  hasPdf,
  pdfUrl,
  pdfLoading,
  pdfFileName,
  pdfHighlights,
  savedTitle,
  savedContent,
  savedUpdatedAt,
  onPdfHighlightsChange,
  onDraftChange,
  onResetDraft,
}: StudyDocEditorProps) {
  const initialTitle = savedTitle ?? baseTitle;
  const initialContent = savedContent ?? baseContent;
  const [title, setTitle] = useState(initialTitle);
  const [contentHtml, setContentHtml] = useState(initialContent);
  const [lastSavedAt, setLastSavedAt] = useState(savedUpdatedAt);
  const [wordCount, setWordCount] = useState(countWords(stripHtml(initialContent)));
  const titleRef = useRef(initialTitle);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  function persistDraft(nextTitle: string, nextContent: string) {
    const updatedAt = new Date().toISOString();
    setLastSavedAt(updatedAt);
    setContentHtml(nextContent);
    setWordCount(countWords(stripHtml(nextContent)));
    onDraftChange({
      title: nextTitle,
      contentHtml: nextContent,
      updatedAt,
    });
  }

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [2, 3],
        },
      }),
    ],
    content: initialContent,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "study-doc-editor",
      },
    },
    onUpdate: ({ editor: activeEditor }) => {
      persistDraft(titleRef.current, activeEditor.getHTML());
    },
  });

  useEffect(() => {
    editor?.setEditable(mode === "edit");
  }, [editor, mode]);

  return (
    <div className="study-doc-canvas">
      <div className="study-doc-header">
        {mode === "edit" && hasText ? (
          <input
            type="text"
            value={title}
            onChange={(event) => {
              const nextTitle = event.target.value;
              setTitle(nextTitle);
              persistDraft(nextTitle, editor?.getHTML() ?? initialContent);
            }}
            placeholder="Untitled document"
            className="study-doc-title-input"
          />
        ) : (
          <h1 className="study-doc-title-view">{title}</h1>
        )}
        <div className="study-doc-subtle-row">
          {hasText ? <span>{wordCount} words</span> : <span>PDF source</span>}
          {(hasText || hasPdf) ? <span className="h-1 w-1 rounded-full bg-border" /> : null}
          {hasPdf ? <span>{pdfFileName || "Attached PDF"}</span> : null}
          {hasPdf ? <span className="h-1 w-1 rounded-full bg-border" /> : null}
          <span>{formatSavedAt(lastSavedAt)}</span>
        </div>
      </div>

      {mode === "edit" && hasText ? (
        <div className="study-doc-toolbar">
          <ToolbarButton
            label="Heading 2"
            disabled={!editor}
            active={editor?.isActive("heading", { level: 2 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          >
            <Heading2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Heading 3"
            disabled={!editor}
            active={editor?.isActive("heading", { level: 3 })}
            onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          >
            <Heading3 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Bold"
            disabled={!editor}
            active={editor?.isActive("bold")}
            onClick={() => editor?.chain().focus().toggleBold().run()}
          >
            <Bold className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Italic"
            disabled={!editor}
            active={editor?.isActive("italic")}
            onClick={() => editor?.chain().focus().toggleItalic().run()}
          >
            <Italic className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Bullet list"
            disabled={!editor}
            active={editor?.isActive("bulletList")}
            onClick={() => editor?.chain().focus().toggleBulletList().run()}
          >
            <List className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Ordered list"
            disabled={!editor}
            active={editor?.isActive("orderedList")}
            onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          >
            <ListOrdered className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Quote"
            disabled={!editor}
            active={editor?.isActive("blockquote")}
            onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          >
            <Quote className="h-4 w-4" />
          </ToolbarButton>
          <div className="study-doc-toolbar-spacer" />
          <ToolbarButton
            label="Undo"
            disabled={!editor?.can().undo()}
            onClick={() => editor?.chain().focus().undo().run()}
          >
            <Undo2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Redo"
            disabled={!editor?.can().redo()}
            onClick={() => editor?.chain().focus().redo().run()}
          >
            <Redo2 className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton
            label="Reset to template"
            onClick={() => {
              setTitle(baseTitle);
              titleRef.current = baseTitle;
              setContentHtml(baseContent);
              editor?.commands.setContent(baseContent, { emitUpdate: false });
              setWordCount(countWords(stripHtml(baseContent)));
              setLastSavedAt(undefined);
              onResetDraft();
            }}
          >
            <RotateCcw className="h-4 w-4" />
          </ToolbarButton>
        </div>
      ) : null}

      <div className="study-doc-sheet">
        {mode === "pdf" ? (
          pdfLoading ? (
            <div className="study-doc-pdf-empty">Loading PDF…</div>
          ) : pdfUrl ? (
            <PdfInlineViewer
              file={pdfUrl}
              fileName={pdfFileName}
              highlights={pdfHighlights}
              onHighlightsChange={onPdfHighlightsChange}
            />
          ) : (
            <div className="study-doc-pdf-empty">
              The original PDF source is not available for this document.
            </div>
          )
        ) : mode === "edit" && hasText ? (
          <EditorContent editor={editor} />
        ) : hasText ? (
          <article
            className="study-doc-editor study-doc-viewer"
            dangerouslySetInnerHTML={{ __html: contentHtml }}
          />
        ) : (
          <div className="study-doc-pdf-empty">
            This document only has the original PDF source. Switch to the PDF tab to read it.
          </div>
        )}
      </div>
    </div>
  );
}
