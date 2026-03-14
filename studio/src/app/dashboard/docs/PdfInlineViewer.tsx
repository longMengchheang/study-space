"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Highlighter } from "lucide-react";
import type { StoredPdfHighlight } from "./DocsLibraryClient";
import "react-pdf/dist/esm/Page/AnnotationLayer.css";
import "react-pdf/dist/esm/Page/TextLayer.css";

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type PdfInlineViewerProps = {
  file: string;
  fileName?: string;
  highlights: StoredPdfHighlight[];
  onHighlightsChange: (highlights: StoredPdfHighlight[]) => void;
};

type PendingSelection = {
  pageNumber: number;
  quote: string;
  startOffset: number;
  endOffset: number;
  top: number;
  left: number;
};

function clearBrowserSelection() {
  if (typeof window === "undefined") {
    return;
  }

  window.getSelection()?.removeAllRanges();
}

function getClosestElement(node: Node | null): Element | null {
  if (!node) {
    return null;
  }

  if (node instanceof Element) {
    return node;
  }

  return node.parentElement;
}

function getTextOffset(root: HTMLElement, targetNode: Node, targetOffset: number): number | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let currentNode = walker.nextNode();

  while (currentNode) {
    const text = currentNode.textContent ?? "";

    if (currentNode === targetNode) {
      return offset + targetOffset;
    }

    offset += text.length;
    currentNode = walker.nextNode();
  }

  return null;
}

function getNodeAtOffset(root: HTMLElement, targetOffset: number): { node: Text; offset: number } | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let traversed = 0;
  let currentNode = walker.nextNode();
  let lastTextNode: Text | null = null;

  while (currentNode) {
    const textNode = currentNode as Text;
    const textLength = textNode.textContent?.length ?? 0;

    if (targetOffset <= traversed + textLength) {
      return {
        node: textNode,
        offset: Math.max(0, Math.min(targetOffset - traversed, textLength)),
      };
    }

    traversed += textLength;
    lastTextNode = textNode;
    currentNode = walker.nextNode();
  }

  if (!lastTextNode) {
    return null;
  }

  return {
    node: lastTextNode,
    offset: lastTextNode.textContent?.length ?? 0,
  };
}

export default function PdfInlineViewer({
  file,
  fileName,
  highlights,
  onHighlightsChange,
}: PdfInlineViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);
  const containerNodeRef = useRef<HTMLDivElement | null>(null);
  const overlappingPendingHighlights = pendingSelection
    ? highlights.filter(
        (highlight) =>
          highlight.pageNumber === pendingSelection.pageNumber &&
          highlight.startOffset < pendingSelection.endOffset &&
          highlight.endOffset > pendingSelection.startOffset,
      )
    : [];

  const renderHighlightOverlays = useCallback(() => {
    const container = containerNodeRef.current;
    if (!container) {
      return;
    }

    const pageShells = Array.from(
      container.querySelectorAll<HTMLElement>(".study-doc-pdf-page-shell"),
    );

    for (const shell of pageShells) {
      const pageNumber = Number(shell.dataset.pageNumber);
      const textLayer = shell.querySelector<HTMLElement>(".react-pdf__Page__textContent");
      let overlay = shell.querySelector<HTMLElement>(".study-doc-pdf-highlight-overlay");

      if (!overlay) {
        overlay = document.createElement("div");
        overlay.className = "study-doc-pdf-highlight-overlay";
        shell.appendChild(overlay);
      }

      overlay.replaceChildren();

      if (!textLayer || Number.isNaN(pageNumber)) {
        continue;
      }

      const shellRect = shell.getBoundingClientRect();
      const pageHighlights = highlights.filter((highlight) => highlight.pageNumber === pageNumber);

      for (const highlight of pageHighlights) {
        const start = getNodeAtOffset(textLayer, highlight.startOffset);
        const end = getNodeAtOffset(textLayer, highlight.endOffset);

        if (!start || !end) {
          continue;
        }

        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);

        const rects = Array.from(range.getClientRects());
        for (const rect of rects) {
          const box = document.createElement("div");
          box.className = "study-doc-pdf-highlight-box";
          box.dataset.highlightId = highlight.id;
          box.style.left = `${rect.left - shellRect.left}px`;
          box.style.top = `${rect.top - shellRect.top}px`;
          box.style.width = `${rect.width}px`;
          box.style.height = `${rect.height}px`;
          overlay.appendChild(box);
        }
      }
    }
  }, [highlights]);

  useEffect(() => {
    const container = containerNodeRef.current;
    if (!container) {
      return;
    }

    let frame = 0;
    const scheduleRender = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        renderHighlightOverlays();
      });
    };

    scheduleRender();

    const observer = new MutationObserver(() => {
      scheduleRender();
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
    });

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [file, numPages, containerWidth, renderHighlightOverlays]);

  const containerRef = useCallback((node: HTMLDivElement | null) => {
    containerNodeRef.current = node;

    if (!node) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });

    observer.observe(node);
    setContainerWidth(node.clientWidth);

    return () => observer.disconnect();
  }, []);

  const captureSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
      setPendingSelection(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const quote = selection.toString().replace(/\s+/g, " ").trim();

    if (!quote) {
      setPendingSelection(null);
      return;
    }

    const startElement = getClosestElement(range.startContainer);
    const endElement = getClosestElement(range.endContainer);
    const startShell = startElement?.closest<HTMLElement>(".study-doc-pdf-page-shell");
    const endShell = endElement?.closest<HTMLElement>(".study-doc-pdf-page-shell");

    if (!startShell || !endShell || startShell !== endShell) {
      setPendingSelection(null);
      return;
    }

    const textLayer = startShell.querySelector<HTMLElement>(".react-pdf__Page__textContent");
    if (!textLayer) {
      setPendingSelection(null);
      return;
    }

    const startOffset = getTextOffset(textLayer, range.startContainer, range.startOffset);
    const endOffset = getTextOffset(textLayer, range.endContainer, range.endOffset);

    if (startOffset == null || endOffset == null || startOffset === endOffset) {
      setPendingSelection(null);
      return;
    }

    const rect = range.getBoundingClientRect();
    const shellRect = startShell.getBoundingClientRect();
    const normalizedStart = Math.min(startOffset, endOffset);
    const normalizedEnd = Math.max(startOffset, endOffset);
    const buttonLeft = Math.max(
      12,
      Math.min(rect.left - shellRect.left, shellRect.width - 132),
    );
    const buttonTop = Math.max(12, rect.top - shellRect.top - 42);

    setPendingSelection({
      pageNumber: Number(startShell.dataset.pageNumber),
      quote,
      startOffset: normalizedStart,
      endOffset: normalizedEnd,
      top: buttonTop,
      left: buttonLeft,
    });
  }, []);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        setPendingSelection(null);
      }
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, []);

  function savePendingHighlight() {
    if (!pendingSelection) {
      return;
    }

    if (overlappingPendingHighlights.length > 0) {
      const overlapIds = new Set(overlappingPendingHighlights.map((highlight) => highlight.id));
      onHighlightsChange(highlights.filter((highlight) => !overlapIds.has(highlight.id)));
    } else {
      onHighlightsChange([
        ...highlights,
        {
          id: `highlight-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          pageNumber: pendingSelection.pageNumber,
          quote: pendingSelection.quote,
          startOffset: pendingSelection.startOffset,
          endOffset: pendingSelection.endOffset,
          createdAt: new Date().toISOString(),
        },
      ]);
    }

    setPendingSelection(null);
    clearBrowserSelection();
  }

  function clearAllHighlights() {
    onHighlightsChange([]);
  }

  return (
    <div className="study-doc-pdf-viewer-shell">
      <div className="study-doc-pdf-viewer-bar">
        <div className="study-doc-pdf-viewer-meta">
          <span>{fileName || "Attached PDF"}</span>
          <span className="h-1 w-1 rounded-full bg-border" />
          <span>{highlights.length} highlight{highlights.length === 1 ? "" : "s"}</span>
        </div>
        {highlights.length > 0 ? (
          <button
            type="button"
            onClick={clearAllHighlights}
            className="study-doc-pdf-clear-button"
          >
            Clear all
          </button>
        ) : null}
      </div>

      <div
        ref={containerRef}
        className="study-doc-pdf-inline"
        onMouseUp={() => {
          window.requestAnimationFrame(() => {
            captureSelection();
          });
        }}
      >
        <Document
          file={file}
          onLoadSuccess={({ numPages: pages }) => setNumPages(pages)}
          loading={<div className="study-doc-pdf-empty">Loading PDF...</div>}
          error={<div className="study-doc-pdf-empty">Unable to display this PDF.</div>}
        >
          {Array.from({ length: numPages }, (_, index) => {
            const pageNumber = index + 1;
            const showPending = pendingSelection?.pageNumber === pageNumber;

            return (
              <div
                key={pageNumber}
                data-page-number={pageNumber}
                className="study-doc-pdf-page-shell"
              >
                <Page
                  pageNumber={pageNumber}
                  width={containerWidth || undefined}
                  className="study-doc-pdf-page"
                  renderAnnotationLayer={false}
                  renderTextLayer
                />
                {showPending ? (
                  <button
                    type="button"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      savePendingHighlight();
                    }}
                    className="study-doc-pdf-highlight-button"
                    style={{
                      top: `${pendingSelection.top}px`,
                      left: `${pendingSelection.left}px`,
                    }}
                  >
                    <Highlighter className="h-3.5 w-3.5" />
                    {overlappingPendingHighlights.length > 0 ? "Unhighlight" : "Highlight"}
                  </button>
                ) : null}
              </div>
            );
          })}
        </Document>
      </div>
    </div>
  );
}
