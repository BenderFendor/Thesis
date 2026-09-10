// Tests for the sort-vars TDZ-aware member sorter transform.
//
// Coverage: dependency-free chains are reordered by case-sensitive local
// Binding name; chains where a member's initializer or type annotation
// References a sibling are reordered only when the reference stays backward
// (in the source order and in the sorted order); object-literal keys and
// Member-access names are not references while shorthand properties are;
// Separate declaration statements are never merged; comments and destructuring
// Patterns skip a chain; sorting is idempotent; every changed output parses
// Again as TypeScript.
import { runTransform } from "../../transformations/sort-vars.mjs";
import ts from "../../../frontend/node_modules/typescript/lib/typescript.js";

const assert = process.getBuiltinModule("node:assert/strict");
const { test } = process.getBuiltinModule("node:test");

/**
 * Asserts that a transform application yields the expected text.
 * @param {string} source - Input source text.
 * @param {string} expected - Expected output text.
 * @returns {void} Asserts the exact result and parse validity.
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

void test("dependency-free chain is reordered alphabetically", () => {
  const source = `const C = 3, A = 1, B = 2;
`;
  const expected = `const A = 1, B = 2, C = 3;
`;
  assertTransformed(source, expected);
});

void test("member ordering is case-sensitive", () => {
  const source = `const b = 1, A = 2;
`;
  const expected = `const A = 2, b = 1;
`;
  assertTransformed(source, expected);
});

void test("chain reordering keeps a backward alias valid", () => {
  const source = `const a = 1, C = 2, b = a;
`;
  const expected = `const C = 2, a = 1, b = a;
`;
  assertTransformed(source, expected);
});

void test("TDZ chain stays unchanged when a member references a lower-sorted sibling", () => {
  const source = `const C = 2, A = 1, B = C;
`;
  assertUnchanged(source);
});

void test("TDZ chain stays unchanged when the reference is forward in source", () => {
  const source = `const B = C, A = 1, C = 2;
`;
  assertUnchanged(source);
});

void test("multi-statement scope is untouched", () => {
  const source = `const B = 1;
const A = 2;
`;
  assertUnchanged(source);
});

void test("mixed declaration kinds are never merged", () => {
  const source = `const B = 1;
let A = 2;
var C = 3;
`;
  assertUnchanged(source);
});

void test("forward alias in source stays unchanged", () => {
  const source = `const B = A, A = 1;
`;
  assertUnchanged(source);
});

void test("object literal keys are not references", () => {
  const source = `const B = { C: 1 }, A = 2, C = 3;
`;
  const expected = `const A = 2, B = { C: 1 }, C = 3;
`;
  assertTransformed(source, expected);
});

void test("shorthand property values are references", () => {
  const source = `const B = { C }, A = 2, C = 3;
`;
  assertUnchanged(source);
});

void test("member-access names are not references", () => {
  const source = `const B = 1, A = obj.C;
`;
  const expected = `const A = obj.C, B = 1;
`;
  assertTransformed(source, expected);
});

void test("type-annotation-only members reorder when free of cross references", () => {
  const source = `let b: Foo, a: Foo;
`;
  const expected = `let a: Foo, b: Foo;
`;
  assertTransformed(source, expected);
});

void test("type annotation references block an unsafe reorder", () => {
  const source = `let C: number = 1, B: typeof C;
`;
  assertUnchanged(source);
});

void test("type annotation references allow a backward-safe reorder", () => {
  const source = `const B = 1, A = 2, C: typeof B = 3;
`;
  const expected = `const A = 2, B = 1, C: typeof B = 3;
`;
  assertTransformed(source, expected);
});

void test("chain with a comment inside is skipped", () => {
  const source = `const C = 3, /* keep */ A = 1, B = 2;
`;
  assertUnchanged(source);
});

void test("destructuring chains are untouched", () => {
  const source = `const { x } = obj, y = 1;
`;
  assertUnchanged(source);
});

void test("already sorted chains stay unchanged", () => {
  const source = `const A = 1, B = 2, C = 3;
`;
  assertUnchanged(source);
});

void test("two chains in one file are sorted independently", () => {
  const source = `const C = 3, A = 1, B = 2;
const b = 2, a = 1;
`;
  const expected = `const A = 1, B = 2, C = 3;
const a = 1, b = 2;
`;
  assertTransformed(source, expected);
});

void test("nested chain is sorted inside a function scope", () => {
  const source = `function f() {
  const C = 3, A = 1, B = 2;
}
`;
  const expected = `function f() {
  const A = 1, B = 2, C = 3;
}
`;
  assertTransformed(source, expected);
});

void test("member without initializer reorders with the chain", () => {
  const source = `let B, A = 1;
`;
  const expected = `let A = 1, B;
`;
  assertTransformed(source, expected);
});


void test("chains with executing initializers are left untouched", () => {
  const source = `const zebra = fetch("/x"), alpha = 1;
`;
  assertUnchanged(source);
});

void test("chains with async awaiting initializers are left untouched", () => {
  const source = `const zebra = await loadItems(), alpha = 1;
`;
  assertUnchanged(source);
});
