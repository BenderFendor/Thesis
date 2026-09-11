import assert from "node:assert/strict";
import { test } from "node:test";
import { runChecks } from "../../quality-hardening/verify.mjs";

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
