import { dominates, paretoFrontier, priorityForTask, scheduleTasks } from "../../quality-hardening/schedule.mjs";
import assert from "node:assert/strict";
import { test } from "node:test";

/** @param {Partial<Record<string, unknown>> & {task_id: string}} [extra] */
function task(extra = {}) {
  return {
    cluster_key: "rule:default",
    factor: "structural_maintainability",
    gate_distance: 0,
    hard_findings: 0,
    repair_class: "structural",
    source_units: [],
    state: "queued",
    ...extra,
  };
}

test("priority classes are strict and ordered by policy", () => {
  assert.equal(priorityForTask("correctness", undefined), "P0");
  assert.equal(priorityForTask("type_integrity", undefined), "P0");
  assert.equal(priorityForTask("structural_maintainability", "structural"), "P1");
  assert.equal(priorityForTask("testing", "coverage"), "P1");
  assert.equal(priorityForTask("architecture_api", undefined), "P2");
  assert.equal(priorityForTask("mechanical_convention", "mechanical_safe"), "P3");
  assert.equal(priorityForTask("mechanical_convention", "mechanical_contextual"), "P4");
});

test("a lower class never beats a higher class regardless of finding volume", () => {
  const ordered = scheduleTasks([
    task({ factor: "mechanical_convention", repair_class: "mechanical_contextual", task_id: "t-mech", finding_count: 500 }),
    task({ task_id: "t-struct", gate_distance: 0.2, hard_findings: 1 }),
  ]);
  assert.deepEqual(ordered.map((item) => item.task_id), ["t-struct", "t-mech"]);
});

test("dominated candidates are excluded from the frontier", () => {
  const stronger = task({ task_id: "a-strong", gate_distance: 0.5, hard_findings: 3, source_units: ["u1"] });
  const weaker = task({ task_id: "b-weak", gate_distance: 0.9, hard_findings: 1, source_units: ["u1", "u2"] });
  assert.equal(dominates(stronger, weaker), true);
  assert.equal(dominates(weaker, stronger), false);
  assert.deepEqual(paretoFrontier([weaker, stronger]).map((item) => item.task_id), ["a-strong"]);
});

test("tie-break is deterministic and prefers explained hard findings", () => {
  const list = [
    task({ task_id: "b-lower", hard_findings: 1, gate_distance: 0.4 }),
    task({ task_id: "a-higher", hard_findings: 3, gate_distance: 0.8 }),
  ];
  const first = scheduleTasks([...list]);
  const second = scheduleTasks(list.reverse());
  assert.deepEqual(first.map((item) => item.task_id), ["a-higher", "b-lower"]);
  assert.deepEqual(second.map((item) => item.task_id), ["a-higher", "b-lower"]);
});

test("effect history widens the frontier inside a class but never the class", () => {
  const tasks = [
    task({ cluster_key: "rule:no-magic", factor: "mechanical_convention", repair_class: "mechanical_safe", task_id: "m-clean", gate_distance: 0.2, hard_findings: 2, source_units: ["u1"] }),
    task({ cluster_key: "rule:one-var", factor: "mechanical_convention", repair_class: "mechanical_safe", task_id: "m-seasoned", gate_distance: 0.4, hard_findings: 1, source_units: ["u1", "u2"] }),
    task({ task_id: "s-structural", gate_distance: 0.3, hard_findings: 2 }),
  ];
  // Without history m-clean dominates m-seasoned on every dimension.
  const plain = scheduleTasks(tasks);
  assert.equal(plain[0].task_id, "s-structural");
  assert.deepEqual(plain.slice(1).map((item) => item.task_id), ["m-clean"]);
  // With history, m-seasoned's accepted predecessor keeps it on the frontier
  // (better measured success), so both candidates remain selectable.
  const effects = [{ cluster_key: "rule:one-var", status: "accepted" }];
  const ordered = scheduleTasks(tasks, effects);
  assert.equal(ordered[0].task_id, "s-structural");
  assert.deepEqual(ordered.slice(1).map((item) => item.task_id), ["m-clean", "m-seasoned"]);
});

test("no transformation dominance allows both frontier candidates", () => {
  const left = task({ task_id: "x", gate_distance: 0.2, hard_findings: 2, source_units: ["u1"] });
  const right = task({ task_id: "y", gate_distance: 0.2, hard_findings: 2, source_units: ["u2"] });
  const frontier = paretoFrontier([left, right]).map((item) => item.task_id).sort();
  assert.deepEqual(frontier, ["x", "y"]);
});
