// Tests for the function-style-const hoist-safe function-to-const transform.
//
// Coverage: clean top-level module functions convert to const arrows (JSX
// Component functions included, satisfying react/function-component-definition);
// Recursion inside the function's own body stays convertible; functions
// Referenced before their declaration stay untouched (TDZ/hoisting lock); a
// Reference inside an earlier function body also locks; exported, body-less,
// Overload, and duplicated-name declarations stay untouched; `this`-body,
// `arguments`-body, generator, generic, and `new`-constructed functions become
// Function expressions (arrows would capture `this`, lack `arguments`, cannot
// Be generators, and are not constructable); async keeps its keyword; every
// Conversion preserves parameters, comments, and return types; every output
// parses again and the transform is idempotent.
import { runTransform } from "../../transformations/function-style-const.mjs";
import ts from "../../../frontend/node_modules/typescript/lib/typescript.js";

const assert = process.getBuiltinModule("node:assert/strict");
const { test } = process.getBuiltinModule("node:test");

/**
 * Asserts that a transform application yields the expected text.
 * @param {string} source - Input source text.
 * @param {string} expected - Expected output text.
 * @param {string} filePath - Source file path for script kind.
 * @returns {void} Asserts the exact result, idempotence, and parse validity.
 */
const assertTransformed = (source, expected, filePath = "fixture.ts") => {
  const first = runTransform(source, filePath);
  assert.equal(first.changed, true);
  assert.equal(first.text, expected);
  const second = runTransform(first.text, filePath);
  assert.equal(second.changed, false);
  assert.equal(second.text, expected);
  assertParses(expected, filePath);
};

/**
 * Asserts that a transform application reports no change.
 * @param {string} source - Input source text.
 * @param {string} filePath - Source file path for script kind.
 * @returns {void} Asserts the unchanged result.
 */
const assertUnchanged = (source, filePath = "fixture.ts") => {
  const result = runTransform(source, filePath);
  assert.equal(result.changed, false);
  assert.equal(result.text, source);
};

/**
 * Asserts that a source text is syntactically valid TypeScript.
 * @param {string} source - Source text to parse.
 * @param {string} filePath - Source file path for script kind.
 * @returns {void} Asserts there are no parse errors.
 */
const assertParses = (source, filePath = "fixture.ts") => {
  const scriptKind = filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const parsed = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  assert.equal(parsed.parseDiagnostics.length, 0, "transformed output must parse");
};

void test("clean module function with JSX use converts to const arrow", () => {
  const source = `function Greeting({ name }: { name: string }) {
  return <div>{name}</div>;
}
<Greeting name="Ada" />;
`;
  const expected = `const Greeting = ({ name }: { name: string }) => {
  return <div>{name}</div>;
}
<Greeting name="Ada" />;
`;
  assertTransformed(source, expected, "fixture.tsx");
});

void test("recursive function converts; self-reference stays valid", () => {
  const source = `function factorial(n: number): number {
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}
`;
  const expected = `const factorial = (n: number): number => {
  if (n <= 1) {
    return 1;
  }
  return n * factorial(n - 1);
}
`;
  assertTransformed(source, expected);
});

void test("functions referenced before their declaration stay untouched", () => {
  const source = `const before = Name();
function Name() {
  return 1;
}
`;
  assertUnchanged(source);
});

void test("functions referenced inside an earlier function body stay untouched", () => {
  const source = `function wrapper() {
  return Name();
}
function Name() {
  return 1;
}
`;
  const expected = `const wrapper = () => {
  return Name();
}
function Name() {
  return 1;
}
`;
  assertTransformed(source, expected);
});

void test("exported and export-default functions stay untouched", () => {
  const source = `export function Exported() {
  return 1;
}
export default function DefaultExport() {
  return 2;
}
`;
  assertUnchanged(source);
});

void test("overload declarations and implementations stay untouched", () => {
  const source = `function Name(a: string): void;
function Name(a: number): void;
function Name(a: any): void {
  void a;
}
`;
  assertUnchanged(source);
});

void test("names bound twice at module level stay untouched", () => {
  const source = `function Name() {
  return 1;
}
function Name() {
  return 2;
}
`;
  assertUnchanged(source);
});

void test("generators convert to function-star expressions, never arrows", () => {
  const source = `function* gen(a: number): Generator<number> {
  yield a;
}
`;
  const expected = `const gen = function* (a: number): Generator<number> {
  yield a;
}
`;
  assertTransformed(source, expected);
});

void test("async generators keep async with a function-star expression", () => {
  const source = `async function* stream(): AsyncGenerator<number> {
  yield 1;
}
`;
  const expected = `const stream = async function* (): AsyncGenerator<number> {
  yield 1;
}
`;
  assertTransformed(source, expected);
});

void test("async clean-body functions convert to async arrows", () => {
  const source = `async function fetchItems(): Promise<number[]> {
  return [];
}
`;
  const expected = `const fetchItems = async (): Promise<number[]> => {
  return [];
}
`;
  assertTransformed(source, expected);
});

void test("this-using bodies convert to function expressions", () => {
  const source = `function withThis() {
  return this.value;
}
`;
  const expected = `const withThis = function () {
  return this.value;
}
`;
  assertTransformed(source, expected);
});

void test("arguments-using bodies convert to function expressions", () => {
  const source = `function collect() {
  return arguments[0];
}
`;
  const expected = `const collect = function () {
  return arguments[0];
}
`;
  assertTransformed(source, expected);
});

void test("nested this inside an arrow body still forces a function expression", () => {
  const source = `function outer() {
  return () => this;
}
`;
  const expected = `const outer = function () {
  return () => this;
}
`;
  assertTransformed(source, expected);
});

void test("new.target bodies convert to function expressions", () => {
  const source = `function factory() {
  return new.target;
}
`;
  const expected = `const factory = function () {
  return new.target;
}
`;
  assertTransformed(source, expected);
});

void test("new-constructed functions convert to function expressions", () => {
  const source = `function Point(x: number) {
  this.x = x;
}
const p = new Point(1);
`;
  const expected = `const Point = function (x: number) {
  this.x = x;
}
const p = new Point(1);
`;
  assertTransformed(source, expected);
});

void test("clean bodies with new call sites convert to function expressions", () => {
  const source = `function Node(value: number) {
  return value;
}
const n = new Node(1);
`;
  const expected = `const Node = function (value: number) {
  return value;
}
const n = new Node(1);
`;
  assertTransformed(source, expected);
});

void test("generic functions convert to function expressions", () => {
  const source = `function pick<T>(items: T[], index: number): T {
  return items[index];
}
`;
  const expected = `const pick = function <T>(items: T[], index: number): T {
  return items[index];
}
`;
  assertTransformed(source, expected);
});

void test("parameters and comments inside the signature are preserved", () => {
  const source = `function span(a: number /* keep */, b = 2): number {
  return a + b;
}
`;
  const expected = `const span = (a: number /* keep */, b = 2): number => {
  return a + b;
}
`;
  assertTransformed(source, expected);
});

void test("multiple functions in one module each convert independently", () => {
  const source = `function alpha(a: number) {
  return a;
}
function beta(b: number): number {
  return b + 1;
}
`;
  const expected = `const alpha = (a: number) => {
  return a;
}
const beta = (b: number): number => {
  return b + 1;
}
`;
  assertTransformed(source, expected);
});

void test("a mixed module is locked per declaration and idempotent", () => {
  const source = `const before = shared();
function shared() {
  return 1;
}
function free() {
  return 2;
}
`;
  const expected = `const before = shared();
function shared() {
  return 1;
}
const free = () => {
  return 2;
}
`;
  assertTransformed(source, expected);
});

void test("nested function declarations stay function declarations", () => {
  const source = `function wrap() {
  function inner() {
    return 1;
  }
  return inner();
}
`;
  const expected = `const wrap = () => {
  function inner() {
    return 1;
  }
  return inner();
}
`;
  assertTransformed(source, expected);
});

void test("object property names and member names are not references", () => {
  const source = `const config = { Name: 1, other: Name };
function Name() {
  return 1;
}
`;
  assertUnchanged(source);
});




void test('multi-line function signature converts with the verbatim splice', () => {
  const source = `function useSelectedSourcesQuery(
  selectedSources: ReadonlySet<string>,
  lens: string,
) {
  return selectedSources.size + lens.length;
}
`;
  const expected = `const useSelectedSourcesQuery = (
  selectedSources: ReadonlySet<string>,
  lens: string,
) => {
  return selectedSources.size + lens.length;
}
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

void test('multi-line signature with return annotation converts', () => {
  const source = `function compute(
  input: string,
): number {
  return input.length;
}
`;
  const expected = `const compute = (
  input: string,
): number => {
  return input.length;
}
`;
  assertTransformed(source, expected);
  assertParses(expected);
});
