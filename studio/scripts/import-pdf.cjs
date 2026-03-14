const { readFile } = require("node:fs/promises");
const { PDFParse } = require("pdf-parse");

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    throw new Error("Missing PDF file path.");
  }

  const buffer = await readFile(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    process.stdout.write(
      JSON.stringify({
        text: result.text ?? "",
      }),
    );
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

main().catch((error) => {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
