/// <reference path="../../../frontend/node_modules/@types/node/index.d.ts" />
import assert from "node:assert/strict";
import { test } from "node:test";
import { runTransform } from "../../transformations/unused-imports.ts";

void test("native import removal keeps used aliases and explicit side-effect imports", () => {
  const source =
    'import "node:os"; import { join as pathJoin, basename } from "node:path"; export const result = pathJoin("a", "b");';
  const output = runTransform(source);
  assert.equal(output.changed, true);
  assert.ok(output.text.includes('import "node:os"'));
  assert.ok(output.text.includes("join as pathJoin"));
  assert.ok(!output.text.includes("basename"));
  assert.equal(runTransform(output.text).changed, false);
});

void test("removing the last import retains module scope", () => {
  const output = runTransform('import type { Stats } from "node:fs"; const value = 1;');
  assert.ok(output.text.includes("export {}"));
  assert.ok(!output.text.includes("Stats"));
});

void test("used imports retain formatter output and malformed modules stay unchanged", () => {
  for (const source of [
    'import { join, basename } from "node:path"; export const result = join(basename("a"), "b");',
    'import { join } from "node:path"; export const = ;',
  ]) {
    assert.equal(runTransform(source).text, source);
  }
});
