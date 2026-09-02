// Tests for the sort-imports deterministic sorter transform.
//
// Coverage: already-sorted inputs stay unchanged; unsorted members are
// Sorted by local binding name (case-sensitive); import statements are
// Ordered by (syntax group, first local member name); side effects, namespace
// And type-only imports follow the group rules; inter-import comments are
// Preserved byte-for-byte; member sorting is skipped when the import specifier
// List contains a comment (matching the rule's own fixer); files without
// Leading imports and files starting with directives are left unchanged;
// Every changed output parses cleanly again (TypeScript transpile check).
import assert from "node:assert/strict";
import { runTransform } from "../../transformations/sort-imports.mjs";
import { test } from "node:test";
import ts from "../../../frontend/node_modules/typescript/lib/typescript.js";

/**
 * Asserts that a transform application yields the expected text.
 * @param {string} source - Input source text.
 * @param {string} expected - Expected output text.
 * @returns {void} Asserts the exact result.
 */
const assertTransformed = (source, expected) => {
  const first = runTransform(source, "fixture.ts");
  assert.equal(first.changed, true);
  assert.equal(first.text, expected);
  const second = runTransform(first.text, "fixture.ts");
  assert.equal(second.changed, false);
  assert.equal(second.text, expected);
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

test("already sorted imports stay unchanged", () => {
  const source = `import "./setup";
import * as api from "@/lib/api";
import {
  API_BASE_URL,
  analyzeArticle,
  addToReadingQueue as apiAddToQueue,
  removeFromReadingQueueByUrl as apiRemoveFromQueue,
} from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import type { NewsArticle } from "@/lib/api";
import { toast } from "sonner";

const value = 1;
`;
  assertUnchanged(source);
});

test("unsorted members are sorted by local binding name", () => {
  const source = `import {
  addToReadingQueue as apiAddToQueue,
  API_BASE_URL,
  analyzeArticle,
  removeFromReadingQueueByUrl as apiRemoveFromQueue,
} from "@/lib/api";
`;
  const expected = `import {
  API_BASE_URL,
  analyzeArticle,
  addToReadingQueue as apiAddToQueue,
  removeFromReadingQueueByUrl as apiRemoveFromQueue,
} from "@/lib/api";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

test("member sorting is case-sensitive", () => {
  const source = `import { a, B } from "m";
`;
  const expected = `import { B, a } from "m";
`;
  assertTransformed(source, expected);
});

test("statement order follows first local member name", () => {
  const source = `import { toast } from "sonner";
import { useCallback } from "react";
import { NewsArticle } from "@/lib/api";
`;
  const expected = `import { NewsArticle } from "@/lib/api";
import { toast } from "sonner";
import { useCallback } from "react";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

test("syntax groups are ordered: multiple before single", () => {
  const source = `import { foo } from "a";
import { b, a } from "m";
`;
  const expected = `import { a, b } from "m";
import { foo } from "a";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

test("type-only and value imports of one module sort by name", () => {
  const source = `import { v } from "m";
import type { T } from "m";
`;
  const expected = `import type { T } from "m";
import { v } from "m";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

test("inter-import comments are preserved byte-for-byte", () => {
  const source = `import { b } from "b";

// section: api imports
import { a } from "a";
`;
  const expected = `import { a } from "a";

// section: api imports
import { b } from "b";
`;
  assertTransformed(source, expected);
});

test("member sorting is skipped when a comment is inside the specifier list", () => {
  const source = `import { zzzz, /* keep */ aaaa } from "m";
`;
  assertUnchanged(source);
});

test("files without leading imports stay unchanged", () => {
  const source = `const x = 1;
export const y = x;
`;
  assertUnchanged(source);
});

test("files with a directive before imports stay unchanged", () => {
  const source = `"use client";
import { b } from "b";
import { a } from "a";
`;
  assertUnchanged(source);
});
