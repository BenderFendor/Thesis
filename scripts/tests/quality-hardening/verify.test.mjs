import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileAsync, runChecks } from "../../quality-hardening/verify.mjs";
import { trackedStatus } from "../../quality-hardening/worktree-snapshot.mjs";

const check = (label) => ({ command: ["true"], label, output_limit_bytes: 1, timeout_ms: 1 });

void test("repository checks run concurrently with a bounded worker count", async () => {
  let active = 0;
  let maximum = 0;
  const checks = ["one", "two", "three", "four", "five"].map(check),
    results = await runChecks(checks, "/repo", 2, async (item) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { duration_ms: 5, label: item.label, status: "passed" };
    });

  assert.equal(maximum, 2);
  assert.deepEqual(results.map((result) => result.label), checks.map((item) => item.label));
});

void test("worktree snapshot detects content changes to an already-dirty path", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "quality-verifier-"));
  try {
    await execFileAsync("git", ["init", "--quiet"], { cwd: repositoryRoot });
    const path = join(repositoryRoot, "tracked.txt");
    await writeFile(path, "indexed\n");
    await execFileAsync("git", ["add", "tracked.txt"], { cwd: repositoryRoot });
    await writeFile(path, "dirty before verification\n");

    const statusBefore = (await execFileAsync("git", ["status", "--porcelain=v1"], { cwd: repositoryRoot })).stdout,
      snapshotBefore = await trackedStatus(repositoryRoot);
    await writeFile(path, "dirty after verification\n");
    const statusAfter = (await execFileAsync("git", ["status", "--porcelain=v1"], { cwd: repositoryRoot })).stdout,
      snapshotAfter = await trackedStatus(repositoryRoot);

    assert.equal(statusBefore, "AM tracked.txt\n");
    assert.equal(statusAfter, statusBefore);
    assert.notEqual(snapshotAfter, snapshotBefore);
  } finally {
    await rm(repositoryRoot, { force: true, recursive: true });
  }
});
