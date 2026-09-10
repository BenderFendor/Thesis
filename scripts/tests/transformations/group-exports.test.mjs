// Tests for the group-exports export-grouping transform.
//
// Coverage: scattered exported declarations are collected into one trailing
// value export statement plus one trailing type-only export statement, in
// Declaration order, with the per-declaration `export` keywords removed;
// Type-only exports (interface, type alias) stay separated from value exports
// (const, function, class, enum) and become `export type { ... }`; re-exports
// (`export { x } from ...`) and side-effect exports (`export * from ...`)
// Stay in place while the plain exports of a mixed file are still collected;
// `export default` statements are never touched (a default-only file stays
// Identical; a default-plus-named file keeps its default and groups the named
// Ones); a single export statement per kind stays unchanged (the rule cannot
// Fire); files with a collected name referenced in a JSDoc brace group or
// `{@link ...}`/`@link`/`@see` tag are skipped, as are files whose collected
// Name appears in another export clause of the same file, files where a
// Collected name is bound twice at top level, destructuring exports, and
// Files that do not parse; function overload groups deduplicate into one
// Export list entry; multi-member `export const` chains collect every member;
// Transformations are idempotent and every changed output parses cleanly.
import { runTransform } from "../../transformations/group-exports.mjs";
import ts from "../../../frontend/node_modules/typescript/lib/typescript.js";

const assert = process.getBuiltinModule("node:assert/strict");
const { test } = process.getBuiltinModule("node:test");

/**
 * Asserts that a transform application yields the expected text.
 * @param {string} source - Input source text.
 * @param {string} expected - Expected output text.
 * @returns {void} Asserts the exact result, idempotence, and parse validity.
 */
const assertTransformed = (source, expected) => {
  const first = runTransform(source, "fixture.ts");
  assert.equal(first.changed, true);
  assert.equal(first.text, expected);
  const second = runTransform(first.text, "fixture.ts");
  assert.equal(second.changed, false);
  assert.equal(second.text, expected);
  assertParses(expected);
};

/**
 * Asserts that a transform application reports no change.
 * @param {string} source - Input source text.
 * @returns {void} Asserts the unchanged result.
 */
const assertUnchanged = (source) => {
  const result = runTransform(source, "fixture.ts");
  assert.equal(result.changed, false);
  assert.equal(result.text, source);
};

/**
 * Asserts that a source text is syntactically valid TypeScript.
 * @param {string} source - Source text to parse.
 * @returns {void} Asserts there are no parse errors.
 */
const assertParses = (source) => {
  const result = ts.transpileModule(source, {
    compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022},
    reportDiagnostics: true,
  });
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, "transformed output must parse");
};

void test("scattered exports collect into one trailing statement per kind", () => {
  const source = `/** Doc. */
export const beta = 2;
const middle = 1;
export interface Foo { x: number }
export const alpha = 1;
export type Bar = string;
export function run() {}
`;
  const expected = `/** Doc. */
const beta = 2;
const middle = 1;
interface Foo { x: number }
const alpha = 1;
type Bar = string;
function run() {}
export { beta, alpha, run };
export type { Foo, Bar };
`;
  assertTransformed(source, expected);
});

void test("mixed file keeps re-exports in place and collects the plain exports", () => {
  const source = `export { helper } from "./lib";
export const a = 1;
export const b = 2;
`;
  const expected = `export { helper } from "./lib";
const a = 1;
const b = 2;
export { a, b };
`;
  assertTransformed(source, expected);
});

void test("side-effect re-export stays in place while local exports group", () => {
  const source = `export * from "./lib";
export interface Props { x: number }
export type Kind = string;
`;
  const expected = `export * from "./lib";
interface Props { x: number }
type Kind = string;
export type { Props, Kind };
`;
  assertTransformed(source, expected);
});

void test("default-only file stays unchanged", () => {
  const source = `export default function main() {}
`;
  assertUnchanged(source);
});

void test("default export is never touched while named exports still group", () => {
  const source = `export default function main() {}
export const a = 1;
export const b = 2;
`;
  const expected = `export default function main() {}
const a = 1;
const b = 2;
export { a, b };
`;
  assertTransformed(source, expected);
});

void test("single export per kind is already grouped and stays unchanged", () => {
  const source = `export const a = 1;
export interface Props { x: number }
`;
  assertUnchanged(source);
});

void test("multi-member export const chain collects every member", () => {
  const source = `export const a = 1, b = 2;
export const c = 3;
`;
  const expected = `const a = 1, b = 2;
const c = 3;
export { a, b, c };
`;
  assertTransformed(source, expected);
});

void test("class and enum exports group as values, interfaces as types", () => {
  const source = `export class Widget {}
export interface Props { x: number }
export enum Mode { A }
`;
  const expected = `class Widget {}
interface Props { x: number }
enum Mode { A }
export { Widget, Mode };
export type { Props };
`;
  assertTransformed(source, expected);
});

void test("async function exports group as values", () => {
  const source = `export async function load() {}
export const data = 1;
`;
  const expected = `async function load() {}
const data = 1;
export { load, data };
`;
  assertTransformed(source, expected);
});

void test("function overload group deduplicates into one export list entry", () => {
  const source = `export function f(a: string): string;
export function f(a: number): number;
export function f(a: string | number): string | number { return a; }
`;
  const expected = `function f(a: string): string;
function f(a: number): number;
function f(a: string | number): string | number { return a; }
export { f };
`;
  assertTransformed(source, expected);
});

void test("file without trailing newline gains a newline before the export statement", () => {
  const source = `export const a = 1;
export const b = 2;`;
  const expected = `const a = 1;
const b = 2;
export { a, b };
`;
  assertTransformed(source, expected);
});

void test("single var statement with two members joins a later export", () => {
  const source = `export const x = 1;
export const y = 2, z = 3;
export type T = string;
`;
  const expected = `const x = 1;
const y = 2, z = 3;
type T = string;
export { x, y, z };
export type { T };
`;
  assertTransformed(source, expected);
});

void test("JSDoc brace reference to a collected name skips the file", () => {
  const source = `/** Uses {@link bar} internally. */
export const bar = 2;
export const baz = 3;
`;
  assertUnchanged(source);
});

void test("JSDoc @param type reference to a collected name skips the file", () => {
  const source = `/**
 * Something.
 * @param {bar} value Description.
 */
export const bar = 2;
export const baz = 3;
`;
  assertUnchanged(source);
});

void test("plain prose in a JSDoc comment does not skip the file", () => {
  const source = `/** Documentation about the bar value. */
export const bar = 2;
export const baz = 3;
`;
  const expected = `/** Documentation about the bar value. */
const bar = 2;
const baz = 3;
export { bar, baz };
`;
  assertTransformed(source, expected);
});

void test("collected name re-exported elsewhere in the file skips", () => {
  const source = `export { a } from "./lib";
export const a = 1;
export const b = 2;
`;
  assertUnchanged(source);
});

void test("bare export clause of a collected name skips", () => {
  const source = `export const a = 1;
export { a };
export const b = 2;
`;
  assertUnchanged(source);
});

void test("bare export clause of an uncollected name stays in place", () => {
  const source = `const a = 1;
export { a };
export const b = 2;
export const c = 3;
`;
  const expected = `const a = 1;
export { a };
const b = 2;
const c = 3;
export { b, c };
`;
  assertTransformed(source, expected);
});

void test("collected name bound twice at top level skips", () => {
  const source = `export const a = 1;
export const b = 2;
const a = 3;
`;
  assertUnchanged(source);
});

void test("destructuring export skips the whole file", () => {
  const source = `export const { x } = obj;
export const a = 1;
`;
  assertUnchanged(source);
});

void test("unparseable source stays unchanged", () => {
  const source = `export const a = ;
`;
  assertUnchanged(source);
});

void test("all values and types already grouped by one statement stay unchanged", () => {
  const source = `const a = 1;
export { a };
export type { T };
`;
  assertUnchanged(source);
});
