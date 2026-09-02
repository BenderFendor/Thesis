import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildTasks, rebuildQueue, readTasks } from "../../quality-hardening/queue.mjs";

const policy = {
  config: { policy_version: "1", thresholds: { cccc: { cognitive_ceiling: 15, cyclomatic_ceiling: 10 }, crap: { cluster_ceiling: 8 }, mi: { cluster_floor: 50 } } },
  repositoryRoot: "/repo",
  taxonomy: {
    family_defaults: { "eslint/": { cluster_key: "rule-and-syntax", quality_factor: "mechanical_convention", repair_class: "mechanical_contextual", temporary_structural_tradeoff: false } },
  },
};

const measurement = {
  measurement_id: "qh-measure:parity",
  units: [{ path: "src/app.ts", unit_id: "u1", metrics: { cccc: { cognitive: 20, cyclomatic: 2 }, code_multivitals: { maintainability_index: 40 } } }],
  lint: { findings: [{ path: "src/app.ts", rule: "eslint/no-null" }] },
};

test("cold and warm cache generate identical task order (repo parity)", () => {
  const first = buildTasks(policy, measurement);
  const second = buildTasks(policy, measurement);
  assert.deepEqual(first, second);
});

test("queue rebuild twice on an unchanged fixture keeps task state and identity", async () => {
  const repositoryRoot = await mkdtemp(join(tmpdir(), "quality-parity-"));
  try {
    const localPolicy = { ...policy, repositoryRoot };
    const first = await rebuildQueue(localPolicy, measurement);
    const second = await rebuildQueue(localPolicy, measurement);
    assert.deepEqual(second.map((task) => task.task_id), first.map((task) => task.task_id));
    assert.equal(second[0].state, "queued");
    assert.equal((await readTasks(repositoryRoot)).length, second.length);
  } finally {
    await rm(repositoryRoot, { recursive: true, force: true });
  }
});

test("structural canary: structural family declares the lint tradeoff it may create", () => {
  const structuralTaxonomy = {
    family_defaults: { "eslint/": { cluster_key: "complexity", quality_factor: "structural_maintainability", repair_class: "structural", temporary_structural_tradeoff: true } },
    rule_ids: ["eslint/no-ternary", "eslint/no-null"],
  };
  const tasks = buildTasks(
    { ...policy, taxonomy: structuralTaxonomy },
    {
      measurement_id: "m",
      units: [{ path: "src/app.ts", unit_id: "u1", metrics: { cccc: { cognitive: 20, cyclomatic: 2 } } }],
      lint: { findings: [{ path: "src/app.ts", rule: "eslint/no-ternary" }] },
    },
  );
  const root = tasks.find((task) => task.unit_ids.includes("u1"));
  const lintTask = tasks.find((task) => task.factor === "structural_maintainability" && task.unit_ids.length === 0);
  assert.ok(root);
  assert.equal(root.repair_class, "structural");
  assert.ok(lintTask);
  // The declared tradeoff is carried on every structural task produced by the
  // same family, so an in-cluster lint increase is recognizable at acceptance.
  assert.ok(root.allowed_lint_rules.includes("eslint/no-ternary"));
  assert.ok(lintTask.allowed_lint_rules.includes("eslint/no-ternary"));
});

test("mechanical canary: one isolated rule closes without structural fallout", () => {
  const tasks = buildTasks(policy, {
    measurement_id: "m",
    units: [{ path: "src/app.ts", unit_id: "u1", metrics: {} }],
    lint: { findings: [{ path: "src/app.ts", rule: "eslint/no-null" }] },
  });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].factor, "mechanical_convention");
  assert.equal(tasks[0].hard_findings, 0);
});

test("coverage canary: unknown coverage stays unknown, never fabricated CRAP", () => {
  const tasks = buildTasks(policy, {
    measurement_id: "m",
    units: [
      { path: "src/app.ts", unit_id: "u1", coverage: { state: "unmapped" }, metrics: { cccc: { cognitive: 30, cyclomatic: 8 } } },
      { path: "src/api.ts", unit_id: "u2", coverage: { state: "measured", crap: 40 }, metrics: {} },
    ],
  });
  const crapTasks = tasks.filter((task) => task.factor === "testing");
  assert.equal(crapTasks.length, 1);
  assert.deepEqual(crapTasks[0].unit_ids, ["u2"]);
  assert.equal(tasks.some((task) => task.unit_ids.includes("u1") && task.factor === "testing"), false);
});
