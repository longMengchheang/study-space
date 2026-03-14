import { spawn } from "node:child_process";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_COMMAND_LENGTH = 1200;
const MAX_OUTPUT_BYTES = 220_000;
const TERMINAL_TIMEOUT_MS = 20_000;
const BLOCKED_COMMAND_PATTERNS = [
  "rm -rf /",
  "rd /s /q",
  "del /f /q",
  "format ",
  "shutdown",
  "reboot",
  "halt",
];

type TerminalAttempt = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  missingShell: boolean;
};

function appendChunk(current: string, chunk: Buffer | string) {
  const next = `${current}${chunk.toString()}`;
  return next.length > MAX_OUTPUT_BYTES ? next.slice(0, MAX_OUTPUT_BYTES) : next;
}

function isBlockedCommand(command: string) {
  const normalized = command.trim().toLowerCase();
  return BLOCKED_COMMAND_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function resolveWorkingDirectory(baseRoot: string, requested?: string, relativeFrom?: string) {
  if (!requested || !requested.trim()) {
    return relativeFrom || baseRoot;
  }

  const normalizedBaseRoot = path.resolve(baseRoot);
  const fromRoot = path.resolve(relativeFrom || normalizedBaseRoot);
  const cleaned = requested.trim();
  const resolved = path.isAbsolute(cleaned)
    ? path.resolve(cleaned)
    : path.resolve(fromRoot, cleaned);
  const relative = path.relative(normalizedBaseRoot, resolved);
  const escapesRoot = relative.startsWith("..") || path.isAbsolute(relative);

  if (escapesRoot) {
    throw new Error("Working directory must stay inside the IDE workspace root.");
  }

  return resolved;
}

function normalizeCdTarget(target: string) {
  const trimmed = target.trim();
  if (!trimmed || trimmed === "~") {
    return ".";
  }

  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return trimmed.slice(2);
  }

  return trimmed;
}

function runTerminal(command: string, cwd: string): Promise<TerminalAttempt> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

    const isWindows = process.platform === "win32";
    const executable = isWindows ? "powershell.exe" : "/bin/bash";
    const args = isWindows
      ? ["-NoLogo", "-NoProfile", "-Command", command]
      : ["-lc", command];

    const finalize = (attempt: Omit<TerminalAttempt, "durationMs">) => {
      if (finished) {
        return;
      }

      finished = true;

      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }

      resolve({
        ...attempt,
        durationMs: Date.now() - startedAt,
      });
    };

    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      env: process.env,
    });

    child.stdout?.on("data", (chunk) => {
      stdout = appendChunk(stdout, chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendChunk(stderr, chunk);
    });

    child.on("error", (error) => {
      const code = (error as NodeJS.ErrnoException).code;
      finalize({
        stdout,
        stderr: appendChunk(stderr, error.message),
        exitCode: null,
        timedOut,
        missingShell: code === "ENOENT",
      });
    });

    timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");

      setTimeout(() => {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      }, 450);
    }, TERMINAL_TIMEOUT_MS);

    child.on("close", (code) => {
      finalize({
        stdout,
        stderr,
        exitCode: timedOut ? null : code,
        timedOut,
        missingShell: false,
      });
    });
  });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    command?: string;
    cwd?: string;
  };
  const command = body.command?.trim() || "";
  const cwdRequest = body.cwd?.trim() || "";

  if (!command) {
    return NextResponse.json(
      {
        detail: "Command is required.",
      },
      { status: 400 },
    );
  }

  if (command.length > MAX_COMMAND_LENGTH) {
    return NextResponse.json(
      {
        detail: "Command is too long for embedded terminal execution.",
      },
      { status: 413 },
    );
  }

  if (isBlockedCommand(command)) {
    return NextResponse.json(
      {
        detail: "This command is blocked in the embedded terminal.",
      },
      { status: 400 },
    );
  }

  const baseRoot = path.resolve(process.env.STUDYSPACE_IDE_TERMINAL_CWD?.trim() || process.cwd());
  let cwd = baseRoot;

  try {
    cwd = resolveWorkingDirectory(baseRoot, cwdRequest || ".", baseRoot);
  } catch (error) {
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : "Invalid working directory.",
      },
      { status: 400 },
    );
  }

  const cdMatch = command.match(/^cd(?:\s+(.+))?$/i);
  if (cdMatch) {
    try {
      const cdTarget = normalizeCdTarget(cdMatch[1] || ".");
      const nextCwd = resolveWorkingDirectory(baseRoot, cdTarget, cwd);
      return NextResponse.json(
        {
          command,
          cwd: nextCwd,
          stdout: "",
          stderr: "",
          exitCode: 0,
          timedOut: false,
          durationMs: 0,
        },
        { status: 200 },
      );
    } catch (error) {
      return NextResponse.json(
        {
          detail: error instanceof Error ? error.message : "Invalid working directory.",
        },
        { status: 400 },
      );
    }
  }

  try {
    const result = await runTerminal(command, cwd);

    if (result.missingShell) {
      return NextResponse.json(
        {
          detail: "Shell runtime was not found on PATH.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      {
        command,
        cwd,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        durationMs: result.durationMs,
      },
      { status: 200 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        detail: error instanceof Error ? error.message : "Terminal command failed.",
      },
      { status: 500 },
    );
  }
}
