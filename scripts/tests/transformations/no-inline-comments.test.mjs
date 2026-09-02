import { mkdtemp, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { join } from "node:path";
import { runTransform } from "../../transformations/no-inline-comments.mjs";
import { test } from "node:test";
import { tmpdir } from "node:os";
import ts from "../../../frontend/node_modules/typescript/lib/typescript.js";

/**
 * Type-check a source text with the repository TypeScript compiler.
 * @param {string} sourceText - Source text to check.
 * @param {string} extension - File extension (".ts" or ".tsx").
 * @returns {Promise<string[]>} Flattened diagnostic messages.
 */
async function typeCheck(sourceText, extension) {
  const directory = await mkdtemp(join(tmpdir(), "no-inline-comments-"));
  const filePath = join(directory, `fixture${extension}`);
  try {
    await writeFile(filePath, sourceText);
    const program = ts.createProgram([filePath], {
      jsx: ts.JsxEmit.Preserve,
      module: ts.ModuleKind.ESNext,
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: ts.ScriptTarget.ES2020,
    });
    return ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("moves a trailing line comment above its statement", () => {
  const source = "const limit = 20; // articles per page\n";
  const result = runTransform(source, "fixture.ts");
  assert.equal(result.changed, true);
  assert.equal(result.text, "// articles per page\nconst limit = 20;\n");
});

test("moves an indented comment with the statement indentation", () => {
  const source = "function load() {\n  const limit = 20; // per page\n  return limit;\n}\n";
  const result = runTransform(source, "fixture.ts");
  assert.equal(result.changed, true);
  assert.equal(
    result.text,
    "function load() {\n  // per page\n  const limit = 20;\n  return limit;\n}\n",
  );
});

test("moves the real comment but never treats URL slashes inside strings as comments", () => {
  const source = 'const apiUrl = "https://example.com/api"; // fetch from the API\n';
  const result = runTransform(source, "fixture.ts");
  assert.equal(result.changed, true);
  assert.equal(result.text, '// fetch from the API\nconst apiUrl = "https://example.com/api";\n');
});

test("keeps a bare string containing double slashes untouched", () => {
  const source = 'const apiUrl = "https://example.com/a//b";\n';
  const result = runTransform(source, "fixture.ts");
  assert.equal(result.changed, false);
  assert.equal(result.text, source);
});

test("keeps comments inside multi-line template literals untouched", () => {
  const source = "const prompt = `Line one\n// this is template text\nend`;\n";
  const result = runTransform(source, "fixture.ts");
  assert.equal(result.changed, false);
  assert.equal(result.text, source);
});

test("keeps JSX text containing double slashes untouched", () => {
  const source = "<div>render a//b</div>;\n";
  const result = runTransform(source, "fixture.tsx");
  assert.equal(result.changed, false);
  assert.equal(result.text, source);
});

test("preserves block comments while moving the line comment", () => {
  const source = "foo(); /* block */ // line comment\n";
  const result = runTransform(source, "fixture.ts");
  assert.equal(result.changed, true);
  assert.equal(result.text, "// line comment\nfoo(); /* block */\n");
});

test("leaves an already-clean file unchanged", () => {
  const source = "// Clean comment above\nconst x = 1;\n";
  const result = runTransform(source, "fixture.ts");
  assert.equal(result.changed, false);
  assert.equal(result.text, source);
});

test("is idempotent (a second run changes nothing)", () => {
  const source = "function f() {\n  const value = 1; // one\n  return value;\n}\n";
  const first = runTransform(source, "fixture.ts");
  const second = runTransform(first.text, "fixture.ts");
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
});

test("protects regex literals containing escaped slashes", () => {
  const source = "const re = /^https?:\\/\\/[^/]+/; // url matcher\n";
  const result = runTransform(source, "fixture.ts");
  assert.equal(result.changed, true);
  assert.equal(result.text, "// url matcher\nconst re = /^https?:\\/\\/[^/]+/;\n");
});

test("transformed output still type-checks with the repository compiler", async () => {
  const source = [
    "function load(limit: number) { // loads entries",
    "  const value = limit; // the limit",
    "  return value; // the value",
    "}",
    "",
  ].join("\n");
  const result = runTransform(source, "fixture.ts");
  assert.equal(result.changed, true);
  assert.deepEqual(await typeCheck(result.text, ".ts"), []);
});
