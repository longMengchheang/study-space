import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_SOURCE_BYTES = 300_000;
const MAX_OUTPUT_BYTES = 160_000;
const EXECUTION_TIMEOUT_MS = 15_000;

type SupportedLanguage = "python" | "javascript";

type RunCandidate = {
  runtime: SupportedLanguage;
  command: string;
  args: string[];
};

type RunAttempt = {
  missingCommand: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
};

function isSupportedLanguage(value: string): value is SupportedLanguage {
  return value === "python" || value === "javascript";
}

function sanitizeFileName(name: string, fallback: string) {
  const baseName = path.basename(name.trim() || fallback);
  const cleaned = baseName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cleaned || fallback;
}

function appendChunk(current: string, chunk: Buffer | string) {
  const next = `${current}${chunk.toString()}`;
  return next.length > MAX_OUTPUT_BYTES ? next.slice(0, MAX_OUTPUT_BYTES) : next;
}

function buildRunCandidates(language: SupportedLanguage, filePath: string): RunCandidate[] {
  if (language === "javascript") {
    return [
      {
        runtime: "javascript",
        command: "node",
        args: [filePath],
      },
    ];
  }

  const configuredPython = process.env.STUDYSPACE_PYTHON_BIN?.trim();
  const candidates: RunCandidate[] = [];

  if (configuredPython) {
    candidates.push({
      runtime: "python",
      command: configuredPython,
      args: [filePath],
    });
  }

  candidates.push(
    {
      runtime: "python",
      command: "python",
      args: [filePath],
    },
    {
      runtime: "python",
      command: "py",
      args: ["-3", filePath],
    },
  );

  return candidates;
}

function runProcess(candidate: RunCandidate): Promise<RunAttempt> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let finalized = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
    let timedOut = false;

    const finalize = (attempt: Omit<RunAttempt, "durationMs">) => {
      if (finalized) {
        return;
      }

      finalized = true;

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      resolve({
        ...attempt,
        durationMs: Date.now() - startedAt,
      });
    };

    const child = spawn(candidate.command, candidate.args, {
      cwd: process.cwd(),
      windowsHide: true,
    });

    child.stdout?.on("data", (chunk) => {
      stdout = appendChunk(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendChunk(stderr, chunk);
    });

    child.on("error", (error) => {
      const errorCode = (error as NodeJS.ErrnoException).code;
      finalize({
        missingCommand: errorCode === "ENOENT",
        stdout,
        stderr: errorCode === "ENOENT" ? stderr : appendChunk(stderr, error.message),
        exitCode: null,
        timedOut,
      });
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 500);
    }, EXECUTION_TIMEOUT_MS);

    child.on("close", (code) => {
      finalize({
        missingCommand: false,
        stdout,
        stderr,
        exitCode: timedOut ? null : code,
        timedOut,
      });
    });
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    fileName?: string;
    language?: string;
    content?: string;
  };
  const fileName = body.fileName?.trim() || "";
  const language = body.language?.trim() || "";
  const content = body.content ?? "";

  if (!isSupportedLanguage(language)) {
    return NextResponse.json(
      {
        detail: "Run currently supports Python and JavaScript files.",
      },
      { status: 400 },
    );
  }

  if (!content.trim()) {
    return NextResponse.json(
      {
        detail: "The active file is empty.",
      },
      { status: 400 },
    );
  }

  if (Buffer.byteLength(content, "utf8") > MAX_SOURCE_BYTES) {
    return NextResponse.json(
      {
        detail: "File is too large to run in the embedded runner.",
      },
      { status: 413 },
    );
  }

  const extension = language === "python" ? ".py" : ".js";
  const tempRoot = path.join(tmpdir(), "studyspace-ide-runs");
  const runDir = path.join(tempRoot, randomUUID());
  const outputName = sanitizeFileName(fileName, `run${extension}`);
  const normalizedName = outputName.toLowerCase().endsWith(extension)
    ? outputName
    : `${outputName}${extension}`;
  const scriptPath = path.join(runDir, normalizedName);

  try {
    await mkdir(runDir, { recursive: true });
    await writeFile(scriptPath, content, "utf8");

    const candidates = buildRunCandidates(language, scriptPath);
    let commandNotFound = true;
    let lastAttempt: RunAttempt | null = null;
    let commandLabel = "";

    for (const candidate of candidates) {
      const attempt = await runProcess(candidate);

      if (attempt.missingCommand) {
        continue;
      }

      commandNotFound = false;
      lastAttempt = attempt;
      commandLabel = [candidate.command, ...candidate.args].join(" ");
      break;
    }

    if (commandNotFound || !lastAttempt) {
      const runtimeName = language === "python" ? "Python" : "Node.js";
      return NextResponse.json(
        {
          detail: `${runtimeName} runtime was not found on PATH.`,
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        runtime: language,
        command: commandLabel,
        stdout: lastAttempt.stdout,
        stderr: lastAttempt.stderr,
        exitCode: lastAttempt.exitCode,
        timedOut: lastAttempt.timedOut,
        durationMs: lastAttempt.durationMs,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : "Run failed.",
      },
      { status: 500 },
    );
  } finally {
    await rm(runDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
