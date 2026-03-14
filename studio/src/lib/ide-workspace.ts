export type PracticeFileLanguage =
  | "python"
  | "javascript"
  | "typescript"
  | "markdown"
  | "json"
  | "html"
  | "css";

export type PracticeTemplateId = "python" | "javascript" | "typescript" | "markdown" | "json";

export type PracticeFile = {
  id: string;
  name: string;
  language: PracticeFileLanguage;
  content: string;
};

export type PracticeWorkspace = {
  files: PracticeFile[];
  activeFileId: string;
  updatedAt: string;
};

export const IDE_WORKSPACE_STORAGE_KEY = "studyspace:ide-workspace";

export const IDE_FILE_TEMPLATES: Array<{
  id: PracticeTemplateId;
  label: string;
  defaultName: string;
}> = [
  { id: "python", label: "Python", defaultName: "practice.py" },
  { id: "javascript", label: "JavaScript", defaultName: "practice.js" },
  { id: "typescript", label: "TypeScript", defaultName: "practice.ts" },
  { id: "markdown", label: "Markdown", defaultName: "notes.md" },
  { id: "json", label: "JSON", defaultName: "data.json" },
];

const TEMPLATE_CONTENT: Record<PracticeTemplateId, { language: PracticeFileLanguage; content: string }> = {
  python: {
    language: "python",
    content: [
      "def solve(numbers: list[int]) -> int:",
      "    \"\"\"Return the sum of the even numbers.\"\"\"",
      "    return sum(value for value in numbers if value % 2 == 0)",
      "",
      "",
      "if __name__ == \"__main__\":",
      "    sample = [1, 2, 3, 4, 5, 6]",
      "    print(solve(sample))",
    ].join("\n"),
  },
  javascript: {
    language: "javascript",
    content: [
      "function solve(numbers) {",
      "  return numbers.filter((value) => value % 2 === 0).reduce((sum, value) => sum + value, 0);",
      "}",
      "",
      "const sample = [1, 2, 3, 4, 5, 6];",
      "console.log(solve(sample));",
    ].join("\n"),
  },
  typescript: {
    language: "typescript",
    content: [
      "export function solve(numbers: number[]): number {",
      "  return numbers.filter((value) => value % 2 === 0).reduce((sum, value) => sum + value, 0);",
      "}",
      "",
      "const sample = [1, 2, 3, 4, 5, 6];",
      "console.log(solve(sample));",
    ].join("\n"),
  },
  markdown: {
    language: "markdown",
    content: [
      "# Practice Notes",
      "",
      "## Goal",
      "- Describe the problem clearly.",
      "- Outline the approach before coding.",
      "",
      "## Review",
      "- What worked?",
      "- What needs improvement?",
    ].join("\n"),
  },
  json: {
    language: "json",
    content: JSON.stringify(
      {
        title: "Practice payload",
        difficulty: "medium",
        tags: ["arrays", "filtering"],
      },
      null,
      2,
    ),
  },
};

function createId() {
  return `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function detectLanguageFromName(name: string, fallback: PracticeFileLanguage = "markdown"): PracticeFileLanguage {
  const lower = name.toLowerCase();

  if (lower.endsWith(".py")) {
    return "python";
  }
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
    return "typescript";
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx")) {
    return "javascript";
  }
  if (lower.endsWith(".json")) {
    return "json";
  }
  if (lower.endsWith(".html")) {
    return "html";
  }
  if (lower.endsWith(".css")) {
    return "css";
  }
  if (lower.endsWith(".md")) {
    return "markdown";
  }

  return fallback;
}

export function createPracticeFile(templateId: PracticeTemplateId, fileName: string): PracticeFile {
  const template = TEMPLATE_CONTENT[templateId];

  return {
    id: createId(),
    name: fileName,
    language: detectLanguageFromName(fileName, template.language),
    content: template.content,
  };
}

export function createDefaultPracticeWorkspace(): PracticeWorkspace {
  const main = createPracticeFile("python", "main.py");
  const notes = createPracticeFile("markdown", "README.md");

  notes.content = [
    "# Coding Practice",
    "",
    "Try one of these:",
    "- Refactor `main.py` to handle edge cases.",
    "- Ask the assistant to explain the current solution.",
    "- Add tests or write a second implementation.",
  ].join("\n");

  return {
    files: [main, notes],
    activeFileId: main.id,
    updatedAt: new Date().toISOString(),
  };
}
