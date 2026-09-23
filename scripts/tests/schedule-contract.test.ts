import assert from "node:assert/strict";
import { test } from "node:test";
import { priorityForFactor, priorityForTask } from "../quality-hardening/schedule.mjs";

void test("scheduler accepts omitted repair classes without changing base priorities", () => {
  assert.equal(priorityForTask("correctness"), "P0");
  assert.equal(priorityForFactor("architecture_api"), "P2");
  assert.equal(priorityForTask("unknown"), "P4");
});
