import { buildTasks, expandTaskScope, readTasks, rebuildQueue, transitionTask, writeTasks } from "../../quality-hardening/queue.mjs";
import { claimWriter, expandWriterClaim, readWriterClaim, releaseWriter } from "../../quality-hardening/writer-claim.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import { analysisCacheKey } from "../../quality-hardening/cache-key.mjs";
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { tmpdir } from "node:os";

const policy = {
  config: { policy_version: "1", thresholds: { cccc: { cognitive_ceiling: 15, cyclomatic_ceiling: 10 }, crap: { cluster_ceiling: 8 }, mi: { cluster_floor: 50 } } },
  repositoryRoot: "/repo",
  taxonomy: { family_defaults: { "eslint/": { quality_factor: "mechanical_convention", repair_class: "mechanical_contextual", cluster_key: "rule-and-syntax" } } },
};

test("cache keys separate path and native configuration provenance", () => {
  const base = { analyzer: "cccc", analyzerVersion: "1", contentSha256: "same", policyHash: "p", repositoryRoot: "/repo", scopeVersion: "1" };
  assert.notEqual(analysisCacheKey({ ...base, relativePath: "src/one.ts" }), analysisCacheKey({ ...base, relativePath: "src/two.ts" }));
  assert.notEqual(analysisCacheKey({ ...base, relativePath: "src/one.ts", nativeConfigHashes: { cccc: "a" } }), analysisCacheKey({ ...base, relativePath: "src/one.ts", nativeConfigHashes: { cccc: "b" } }));
});

test("queue groups complexity and lint findings by root cause", () => {
  const tasks = buildTasks(policy, {
    measurement_id: "m1",
    units: [{ path: "src/app.ts", unit_id: "u1", metrics: { cccc: { cognitive: 20, cyclomatic: 2 }, code_multivitals: { maintainability_index: 40 } } }],
    lint: { findings: [{ path: "src/app.ts", rule: "eslint/no-null" }] },
  });
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0].state, "queued");
  assert.equal(tasks[0].priority, "P1");
  assert.deepEqual(tasks[0].unit_ids, ["u1"]);
  assert.deepEqual(tasks.map((task) => task.factor), ["structural_maintainability", "mechanical_convention"]);
});

test("task transitions and scope expansion are explicit", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "quality-hardening-"));
  try {
    const [task] = buildTasks(policy, { measurement_id: "m1", units: [{ path: "src/app.ts", unit_id: "u1", metrics: { cccc: { cognitive: 20 } } }] });
    await writeTasks(repositoryRoot, [task]);
    await transitionTask(repositoryRoot, task.task_id, "claimed", { claimed_by: "one" });
    await assert.rejects(() => transitionTask(repositoryRoot, task.task_id, "accepted"), /invalid task transition/u);
    await claimWriter(repositoryRoot, { sessionId: "one", taskId: task.task_id, paths: task.paths });
    await expandWriterClaim(repositoryRoot, "one", task.task_id, "src/other.ts");
    await expandTaskScope(repositoryRoot, task.task_id, "src/other.ts", "shared type boundary");
    const expanded = (await readTasks(repositoryRoot))[0];
    assert.deepEqual(expanded.paths, ["src/app.ts", "src/other.ts"]);
    assert.equal((await readWriterClaim(repositoryRoot))?.paths?.includes("src/other.ts"), true);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("queue rebuild marks changed open tasks stale", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "quality-hardening-"));
  try {
    const localPolicy = { ...policy, repositoryRoot };
    const [oldTask] = buildTasks(policy, { measurement_id: "m1", units: [{ path: "src/app.ts", unit_id: "u1", metrics: { cccc: { cognitive: 20 } } }] });
    await writeTasks(repositoryRoot, [oldTask]);
    const tasks = await rebuildQueue(localPolicy, { measurement_id: "m2", units: [{ path: "src/other.ts", unit_id: "u2", metrics: { cccc: { cognitive: 20 } } }] });
    assert.equal(tasks.some((task) => task.task_id === oldTask.task_id && task.state === "stale"), true);
    assert.equal(tasks.some((task) => task.unit_ids.includes("u2") && task.state === "queued"), true);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("writer claims are exclusive and released by the owner", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "quality-hardening-"));
  try {
    const claim = await claimWriter(repositoryRoot, { sessionId: "one", taskId: "task", paths: ["src/app.ts"] });
    assert.equal(claim.session_id, "one");
    assert.equal((await readWriterClaim(repositoryRoot))?.task_id, "task");
    await assert.rejects(() => claimWriter(repositoryRoot, { sessionId: "two", taskId: "other", paths: ["src/other.ts"] }), /already exists/u);
    assert.equal(await releaseWriter(repositoryRoot, "one"), true);
    assert.equal(await readWriterClaim(repositoryRoot), null);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});
