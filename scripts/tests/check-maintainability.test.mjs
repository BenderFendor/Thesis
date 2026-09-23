import { mkdtemp, rm, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

void test("maintainability emits complete JSON through a pipe and preserves failure status", async () => {
  const directory = await mkdtemp("/tmp/thesis-mi-test-"),
    source = resolve(directory, "functions.ts"),
    count = 700;
  try {
    await writeFile(source, Array.from({ length: count }, (_, index) =>
      `export function value${index}() { return ${index}; }`).join("\n"));
    const result = spawnSync(process.execPath,
      ["scripts/check-maintainability.mjs", "--json", "--strict", source], {
        cwd: resolve(import.meta.dirname, "../.."),
        encoding: "utf8",
        env: { ...process.env, THESIS_MI_CAP: "101", THESIS_MI_ERROR: "102" },
        maxBuffer: 2_000_000,
      });
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout);
    assert.equal(report.total, count);
    assert.equal(report.fails.length, count);
    assert.ok(result.stdout.length > 65_536);
  } finally {
    await rm(directory, { recursive: true });
  }
});
