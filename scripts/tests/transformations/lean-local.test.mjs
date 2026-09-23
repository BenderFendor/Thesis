/// <reference path="../../../frontend/node_modules/@types/node/index.d.ts" />
import assert from "node:assert/strict";
import { execFileAsync } from "../../quality-hardening/verify.mjs";
import { test } from "node:test";
import ts from "../../../frontend/node_modules/typescript/lib/typescript.js";
import { runTransform } from "../../transformations/lean-local.ts";

void test("live bindings, required undefined arguments and ambiguous modules remain intact", () => {
  const sources = [
    "function clear(value: string | undefined) { return value; } export const result = clear(undefined);",
    "function original() { return 7; } export { original as canonical };",
    "function live() { return 7; } export const result = { live };",
    'function live() { return 7; } export const result = eval("live()");',
    "function globalEntry() { return 7; }",
    "function incomplete( {; export {};",
  ];
  for (const source of sources) {
    assert.equal(runTransform(source).text, source);
  }
});

/**
 * @param {string} source TypeScript module to execute.
 * @returns {Promise<string>} Serialized result.
 */
const execute = async (source) => {
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics.length, 0);
  const result = await execFileAsync(
    process.execPath,
    ["-e", `${compiled.outputText}\nprocess.stdout.write(JSON.stringify(exports.result));`],
    { encoding: "utf8" },
  );
  return result.stdout;
};

void test("dead declarations disappear while exported, side-effectful and merged declarations remain", async () => {
  const source = `
    interface Unused { value: number }
    type Dead = Unused;
    function unused() { throw new Error("never called"); }
    const unusedArrow = () => { throw new Error("never called"); };
    const events = [];
    const sideEffect = events.push("kept");
    interface Merged { a: string }
    interface Merged { b: string }
    export const result = events;
  `;
  const first = runTransform(source, "fixture.ts");
  const second = runTransform(first.text, "fixture.ts");
  assert.equal(first.changed, true);
  assert.equal(await execute(second.text), await execute(source));
  assert.ok(second.text.includes("const sideEffect"));
  assert.ok(second.text.includes("interface Merged"));
  assert.ok(!second.text.includes("function unused"));
  assert.ok(!second.text.includes("interface Unused"));
  assert.equal(runTransform(second.text, "fixture.ts").changed, false);
});
