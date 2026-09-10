import { resolve } from "node:path";
import { collectOwnedFrontendFiles } from "../quality-source-files.mjs";


const assert = process.getBuiltinModule("node:assert/strict");
const { test } = process.getBuiltinModule("node:test");

const repositoryRoot = resolve(import.meta.dirname, "../..");

void test("quality metrics scan owned frontend source and exclude support code", () => {
  const files = collectOwnedFrontendFiles(repositoryRoot);

  assert.ok(files.length > 0);
  assert.ok(files.includes("frontend/app/page.tsx"));
  assert.ok(files.includes("frontend/lib/api.ts"));
  assert.equal(files.some((path) => path.includes("/__tests__/")), false);
  assert.equal(files.some((path) => path.includes("/generated/")), false);
  assert.equal(files.some((path) => path.includes("/tools/")), false);
  assert.equal(files.some((path) => path.includes("/.next/")), false);
  assert.equal(files.some((path) => /\.(?:spec|test)\.[cm]?[jt]sx?$/u.test(path)), false);
});
