import { spawn } from "node:child_process";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_COMMAND_LENGTH = 1200;
const MAX_OUTPUT_BYTES = 220_000;
const TERMINAL_TIMEOUT_MS = 20_000;

/**
 * Allowlist of permitted base commands for the embedded terminal.
 *
 * Security model: the terminal runs on the host, so only a known-safe set
 * of read-only / dev-workflow commands is permitted. This replaces the
 * previous blocklist approach, which could be bypassed trivially (e.g.
 * `rm -rf /*` would not match `rm -rf /`).
 *
 * Commands are matched against the first token of the input (case-insensitive
 * on Windows, exact on POSIX). Extend this list deliberately — never switch
 * back to a blocklist.
 */
const ALLOWED_COMMANDS = new Set([
  // Navigation & inspection
  "ls",
  "dir",
  "pwd",
  "echo",
  "cat",
  "type",
  "head",
  "tail",
  "grep",
  "find",
  "which",
  "where",
  "env",
  "set",
  "printenv",
  // File creation (safe for a dev workspace)
  "mkdir",
  "touch",
  "cp",
  "copy",
  "mv",
  "move",
  // Version control
  "git",
  // Package managers & runtimes (users code here)
  "npm",
  "npx",
  "node",
  "python",
  "python3",
  "pip",
  "pip3",
  "py",
  // Build tools
  "make",
  "cargo",
  "go",
  "rustc",
  "javac",
  "java",
  "mvn",
  "gradle",
]);

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

/**
 * Extract the base command (first token) and check it against the allowlist.
 * Handles quoted first tokens (e.g. `"python" script.py`).
 */
function isAllowedCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) return false;

  // Strip an optional leading quote around the first token
  const stripped = trimmed.startsWith('"') || trimmed.startsWith("'") ? trimmed.slice(1) : trimmed;
  const base = stripped.split(/[\s"']/)[0].toLowerCase();
  // On Windows the command might have a .exe extension
  const baseWithoutExt = base.endsWith(".exe") ? base.slice(0, -4) : base;
  return ALLOWED_COMMANDS.has(base) || ALLOWED_COMMANDS.has(baseWithoutExt);
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

  if (!isAllowedCommand(command)) {
    return NextResponse.json(
      {
        detail:
          "This command is not permitted in the embedded terminal. " +
          "Only development-workflow commands (git, npm, node, python, ls, etc.) are allowed.",
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
