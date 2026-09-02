// Tests for the sort-imports deterministic sorter transform.
//
// Coverage: already-sorted inputs stay unchanged; unsorted members are
// Sorted by local binding name (case-sensitive); import statements are
// Ordered by (syntax group, first local member name); side effects, namespace
// And type-only imports follow the group rules; inter-import comments are
// Preserved byte-for-byte; member sorting is skipped when the import specifier
// List contains a comment (matching the rule's own fixer); every contiguous
// Top-level import run is sorted in place, including runs after non-import
// Statements; side-effect imports keep their relative order within a run;
// A run whose first import has comments in its specifier list stays
// Untouched; imports after leading string directives are left unchanged while
// Later runs in the same file still sort; declaration order keys follow the
// Post-member-sort first local name (idempotent output); files without
// Imports stay unchanged; every changed output parses cleanly again (TS
// Transpile check).
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

test("directive-before-imports run is sorted (rule flags post-directive runs)", () => {
  const source = `"use client";
import { b } from "b";
import { a } from "a";
`;
  const expected = `"use client";
import { a } from "a";
import { b } from "b";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

test("post-code import runs are sorted in place", () => {
  const source = `const value = compute();
export const result = value;

import { b } from "b";
import { a } from "a";
`;
  const expected = `const value = compute();
export const result = value;

import { a } from "a";
import { b } from "b";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

test("post-code runs sort members and declarations together", () => {
  const source = `const x = 1;
import { b, a } from "mod";
import { z } from "z";
`;
  const expected = `const x = 1;
import { a, b } from "mod";
import { z } from "z";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

test("side-effect imports keep their relative order within a run", () => {
  const source = `import "./z";
import { a } from "a";
import "./c";
`;
  const expected = `import "./z";
import "./c";
import { a } from "a";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

test("a run is untouched when its first import has comments in its specifier list", () => {
  const source = `const x = 1;

import { b, /* keep */ a } from "m";
import { aa } from "aa";
`;
  assertUnchanged(source);
});

test("both leading and post-code runs are sorted independently", () => {
  const source = `import { z } from "z";
import { a } from "a";

const x = 1;

import { y } from "y";
import { b } from "b";
`;
  const expected = `import { a } from "a";
import { z } from "z";

const x = 1;

import { b } from "b";
import { y } from "y";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

test("directive run and later post-code run both sort", () => {
  const source = `"use client"
import { z } from "z";
import { a } from "a";

const x = 1;

import { y } from "y";
import { b } from "b";
`;
  const expected = `"use client"
import { a } from "a";
import { z } from "z";

const x = 1;

import { b } from "b";
import { y } from "y";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});

test("page-tsx style run sorts default, type and grouped imports with mixed quotes", () => {
  const source = `import {
  Bell,
  Bookmark,
  Building2,
} from "lucide-react"
import type { ComponentProps, TouchEvent } from 'react';
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useCallback, useEffect } from 'react';
import { Button } from "@/components/ui/button"
import { GlobalNavigation } from '@/components/global-navigation';
import { GridView } from "@/components/grid-view"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"
import type { ViewMode } from '@/components/global-navigation';
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { ThemeToggle } from "@/components/theme-toggle"
`;
  const expected = `import {
  Bell,
  Bookmark,
  Building2,
} from "lucide-react"
import type { ComponentProps, TouchEvent } from 'react';
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { useCallback, useEffect } from 'react';
import { Button } from "@/components/ui/button"
import { GlobalNavigation } from '@/components/global-navigation';
import { GridView } from "@/components/grid-view"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"
import { ThemeToggle } from "@/components/theme-toggle"
import type { ViewMode } from '@/components/global-navigation';
import dynamic from "next/dynamic"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
`;
  assertTransformed(source, expected);
  assertParses(expected);
});
test("member sorting stabilizes the declaration order of a run", () => {
  const source = `const x = 1;

import { filterArticlesByLens, getLensSourceIds, NEWS_LENSES } from "@/lib/news-lens";
import type { NewsArticle } from "@/lib/api";
import { fetchCacheStatus, fetchCategories } from "@/lib/api";
`;
  const expected = `const x = 1;

import { NEWS_LENSES, filterArticlesByLens, getLensSourceIds } from "@/lib/news-lens";
import { fetchCacheStatus, fetchCategories } from "@/lib/api";
import type { NewsArticle } from "@/lib/api";
`;
  assertTransformed(source, expected);
  assertParses(expected);
});
