import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "../.."),
  checkCrap = resolve(repositoryRoot, "scripts/check-crap.mjs");

test("check-crap fails when the measured report exceeds its threshold", () => {
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
