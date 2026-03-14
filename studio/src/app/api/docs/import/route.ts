import { NextResponse } from "next/server";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const execFileAsync = promisify(execFile);
const IMPORT_PDF_SCRIPT = resolve(process.cwd(), "scripts/import-pdf.cjs");

export const runtime = "nodejs";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const TEXT_EXTENSIONS = [".txt", ".md"];
const HTML_EXTENSIONS = [".html", ".htm"];
const CODE_EXTENSIONS = [
  ".py", ".js", ".ts", ".tsx", ".jsx", ".css", ".scss",
  ".json", ".yaml", ".yml", ".toml",
  ".java", ".c", ".cpp", ".h", ".hpp", ".cs",
  ".go", ".rs", ".rb", ".php", ".swift", ".kt",
  ".sh", ".bash", ".sql", ".xml", ".csv",
  ".lua", ".r", ".pl", ".ex", ".exs",
];
const SUPPORTED_EXTENSIONS = [".pdf", ...TEXT_EXTENSIONS, ...HTML_EXTENSIONS, ...CODE_EXTENSIONS];

function deriveTitle(fileName: string): string {
  // Strip any known extension
  const ext = getExtension(fileName);
  const baseName = ext ? fileName.slice(0, -ext.length).trim() : fileName.trim();
  return toTitleCase(baseName || "Imported Document");
}

function getExtension(fileName: string): string {
  const match = fileName.match(/\.[a-z]+$/i);
  return match ? match[0].toLowerCase() : "";
}

function looksLikeMainHeading(lines: string[]): boolean {
  if (lines.length !== 1) {
    return false;
  }

  const value = lines[0].trim();
  if (value.length < 4 || value.length > 90) {
    return false;
  }

  // ALL CAPS lines are almost certainly headings
  if (/^[\p{Lu}\p{N}\s,:;()\-/'"&]+$/u.test(value) && value.length >= 4) {
    return true;
  }

  if (/[.?!]$/.test(value) || value.includes("  ")) {
    return false;
  }

  return /^[\p{L}\p{N}][\p{L}\p{N}\s,:;()\-/'"&]+$/u.test(value);
}

function looksLikeSubHeading(lines: string[]): boolean {
  if (lines.length !== 1) {
    return false;
  }

  const value = lines[0].trim();
  if (value.length < 3 || value.length > 60) {
    return false;
  }

  if (/[.?!]$/.test(value)) {
    return false;
  }

  // Short, title-like lines that don't end with punctuation
  return /^[\p{L}\p{N}][\p{L}\p{N}\s,:;()\-/'"&]+$/u.test(value);
}

function applyInlineFormatting(text: string): string {
  // Bold: **text** or __text__
  let result = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  result = result.replace(/__(.+?)__/g, "<strong>$1</strong>");
  // Italic: *text* or _text_ (but not inside already-processed bold)
  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "<em>$1</em>");
  result = result.replace(/(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g, "<em>$1</em>");
  return result;
}

function blockToHtml(block: string): string {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  // Blockquote: lines starting with >
  const quoteLines = lines.map((line) => line.match(/^>\s?(.*)$/)?.[1] ?? null);
  if (quoteLines.every((l) => l !== null)) {
    const inner = quoteLines.map((l) => escapeHtml(l!)).join(" ");
    return `<blockquote><p>${applyInlineFormatting(inner)}</p></blockquote>`;
  }

  // Bullet list
  const bulletLines = lines
    .map((line) => line.match(/^[-*•]\s+(.+)$/)?.[1]?.trim() ?? null);

  if (bulletLines.every(Boolean)) {
    return `<ul>${bulletLines
      .map((line) => `<li>${applyInlineFormatting(escapeHtml(line!))}</li>`)
      .join("")}</ul>`;
  }

  // Ordered list
  const orderedLines = lines
    .map((line) => line.match(/^\d+[.)]\s+(.+)$/)?.[1]?.trim() ?? null);

  if (orderedLines.every(Boolean)) {
    return `<ol>${orderedLines
      .map((line) => `<li>${applyInlineFormatting(escapeHtml(line!))}</li>`)
      .join("")}</ol>`;
  }

  // Main heading (long, title-case or ALL CAPS)
  if (looksLikeMainHeading(lines)) {
    return `<h2>${escapeHtml(lines[0])}</h2>`;
  }

  // Sub-heading (shorter title-like line)
  if (looksLikeSubHeading(lines) && lines[0].length <= 45) {
    return `<h3>${escapeHtml(lines[0])}</h3>`;
  }

  // For multi-line blocks, detect sentence-ending lines and split into
  // separate paragraphs. PDF extractors often put each visual line on its
  // own line, and a line ending with sentence punctuation (.?!:) usually
  // marks a paragraph boundary.
  if (lines.length > 1) {
    const paragraphs: string[][] = [[]];

    for (let i = 0; i < lines.length; i++) {
      const current = lines[i];
      paragraphs[paragraphs.length - 1].push(current);

      // If this line ends with sentence-ending punctuation and there is a
      // next line, start a new paragraph group
      if (i < lines.length - 1 && /[.?!:]\s*$/.test(current)) {
        paragraphs.push([]);
      }
    }

    // Only split if we actually found multiple paragraph groups
    if (paragraphs.length > 1) {
      return paragraphs
        .filter((group) => group.length > 0)
        .map((group) => `<p>${applyInlineFormatting(escapeHtml(group.join(" ")))}</p>`)
        .join("");
    }
  }

  // Default: single paragraph with inline formatting
  return `<p>${applyInlineFormatting(escapeHtml(lines.join(" ")))}</p>`;
}

function splitPdfBlocks(text: string): string[] {
  // PDF extractors produce text where:
  // - Double newlines = clear paragraph breaks
  // - Single newlines between short lines = visual line wraps
  // - Single newline after a sentence-ending line followed by a line
  //   starting with a capital letter = likely a new paragraph
  const rawBlocks = text.split(/\n{2,}/);
  const result: string[] = [];

  for (const rawBlock of rawBlocks) {
    const trimmed = rawBlock.trim();
    if (!trimmed) continue;

    // Further split on single newlines where the previous line ends with
    // sentence punctuation AND the next line starts with a capital letter
    // or a number (indicates a new thought/paragraph)
    const subBlocks: string[] = [];
    let current: string[] = [];
    const lines = trimmed.split("\n");

    for (let i = 0; i < lines.length; i++) {
      current.push(lines[i]);

      if (
        i < lines.length - 1 &&
        /[.?!]\s*$/.test(lines[i].trim()) &&
        /^\s*[A-Z\d]/.test(lines[i + 1])
      ) {
        subBlocks.push(current.join("\n"));
        current = [];
      }
    }

    if (current.length > 0) {
      subBlocks.push(current.join("\n"));
    }

    result.push(...subBlocks);
  }

  return result.filter(Boolean);
}

function pdfTextToHtml(text: string): string {
  const normalized = normalizeWhitespace(text);

  if (!normalized) {
    return "<p></p>";
  }

  // Handle fenced code blocks (```...```)
  const segments: string[] = [];
  const codeBlockRegex = /```(?:\w*)?\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = codeBlockRegex.exec(normalized)) !== null) {
    if (match.index > lastIndex) {
      segments.push(normalized.slice(lastIndex, match.index));
    }
    segments.push(`<pre><code>${escapeHtml(match[1].trim())}</code></pre>`);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < normalized.length) {
    segments.push(normalized.slice(lastIndex));
  }

  // Process non-code segments as normal blocks
  const htmlParts: string[] = [];

  for (const segment of segments) {
    if (segment.startsWith("<pre>")) {
      htmlParts.push(segment);
      continue;
    }

    const blocks = splitPdfBlocks(segment);

    for (const block of blocks) {
      const html = blockToHtml(block);
      if (html) {
        htmlParts.push(html);
      }
    }
  }

  const content = htmlParts.join("");
  return content || "<p></p>";
}

export async function POST(request: Request) {
  let tempDirectory = "";

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ detail: "A file is required." }, { status: 400 });
    }

    const ext = getExtension(file.name);

    if (!SUPPORTED_EXTENSIONS.includes(ext)) {
      return NextResponse.json(
        { detail: `Unsupported file type. Accepted formats: ${SUPPORTED_EXTENSIONS.join(", ")}` },
        { status: 400 },
      );
    }

    if (file.size > MAX_IMPORT_BYTES) {
      return NextResponse.json(
        { detail: "File is too large to import. Use a file smaller than 20 MB." },
        { status: 413 },
      );
    }

    const title = deriveTitle(file.name);

    // For plain text and markdown, read directly and run through the converter
    if (TEXT_EXTENSIONS.includes(ext)) {
      const rawText = await file.text();
      return NextResponse.json(
        { title, contentHtml: pdfTextToHtml(rawText) },
        { status: 200 },
      );
    }

    // For HTML files, pass through directly (browser-native content)
    if (HTML_EXTENSIONS.includes(ext)) {
      const rawHtml = await file.text();
      const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const contentHtml = bodyMatch ? bodyMatch[1].trim() : rawHtml.trim();
      return NextResponse.json(
        { title, contentHtml: contentHtml || "<p></p>" },
        { status: 200 },
      );
    }

    // For code files, wrap in a preformatted code block
    if (CODE_EXTENSIONS.includes(ext)) {
      const rawCode = await file.text();
      const lang = ext.replace(".", "");
      const contentHtml = `<p><strong>${escapeHtml(file.name)}</strong></p><pre><code class="language-${lang}">${escapeHtml(rawCode)}</code></pre>`;
      return NextResponse.json(
        { title, contentHtml },
        { status: 200 },
      );
    }

    // PDF processing via external script
    const arrayBuffer = await file.arrayBuffer();
    tempDirectory = await mkdtemp(join(tmpdir(), "studyspace-doc-import-"));
    const tempFilePath = join(tempDirectory, file.name);
    await writeFile(tempFilePath, new Uint8Array(arrayBuffer));
    const { stdout } = await execFileAsync(process.execPath, [IMPORT_PDF_SCRIPT, tempFilePath], {
      cwd: process.cwd(),
      maxBuffer: 20 * 1024 * 1024,
    });
    const result = JSON.parse(stdout) as { text?: string };

    return NextResponse.json(
      {
        title,
        contentHtml: pdfTextToHtml(result.text ?? ""),
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : "Unable to import file.",
      },
      { status: 500 },
    );
  } finally {
    if (tempDirectory) {
      await rm(tempDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
