import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const assert = process.getBuiltinModule("node:assert/strict");
const { test } = process.getBuiltinModule("node:test");

const repositoryRoot = resolve(import.meta.dirname, "../.."),
  checkCrap = resolve(repositoryRoot, "scripts/check-crap.mjs");

void test("check-crap fails when the measured report exceeds its threshold", () => {
  const result = spawnSync(process.execPath, [checkCrap], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, THESIS_CRAP_THRESHOLD: "0.1" },
    maxBuffer: 50 * 1024 * 1024,
  });

  assert.equal(result.status, 1);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /"status": "failed"/u,
  );
});
