import assert from "node:assert/strict";
import { normalizeReport } from "../../quality-hardening/adapters/cccc.mjs";
import { parseReport } from "../../quality-hardening/adapters/oxlint.mjs";
import { test } from "node:test";

test("CCCC normalization emits stable namespaced source units", () => {
  const report = normalizeReport(
    {
      files: [{ path: "/repo/src/app.ts", functions: [{ name: "render", line: 4, cyclomatic: 2, cognitive: 1 }] }],
      summary: {},
      violations: [],
    },
    "/repo",
  );
  assert.equal(report.analyzer, "cccc");
  assert.equal(report.units[0].path, "src/app.ts");
  assert.equal(report.units[0].metrics.cccc.cyclomatic, 2);
  assert.match(report.units[0].unit_id, /^qh-unit:/u);
});

test("Oxlint normalization preserves severity and rule counts", () => {
  const report = parseReport(
    JSON.stringify({
      diagnostics: [
        { code: "eslint(no-null)", filename: "/repo/src/app.ts", message: "avoid null", severity: "error", labels: [{ span: { line: 3 } }] },
        { code: "eslint(no-warning)", filename: "/repo/src/app.ts", message: "warning", severity: "warning", labels: [{ span: { line: 4 } }] },
      ],
    }),
    "/repo",
  );
  assert.equal(report.errors, 1);
  assert.equal(report.warnings, 1);
  assert.deepEqual(report.by_rule["eslint/no-null"], { errors: 1, warnings: 0 });
  assert.equal(report.findings[1].level, "w");
});
