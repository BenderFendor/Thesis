import { normalizeReport } from "../../quality-hardening/adapters/cccc.mjs";
import { parseReport } from "../../quality-hardening/adapters/oxlint.mjs";

const assert = process.getBuiltinModule("node:assert/strict");
const { test } = process.getBuiltinModule("node:test");

void test("CCCC normalization emits stable namespaced source units", () => {
  const report = normalizeReport(
    {
      files: [{ functions: [{ cognitive: 1, cyclomatic: 2, line: 4, name: "render" }], path: "/repo/src/app.ts" }],
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

void test("Oxlint normalization preserves severity and rule counts", () => {
  const report = parseReport(
    JSON.stringify({
      diagnostics: [
        { code: "eslint(no-null)", filename: "/repo/src/app.ts", labels: [{ span: { line: 3 } }], message: "avoid null", severity: "error" },
        { code: "eslint(no-warning)", filename: "/repo/src/app.ts", labels: [{ span: { line: 4 } }], message: "warning", severity: "warning" },
      ],
    }),
    "/repo",
  );
  assert.equal(report.errors, 1);
  assert.equal(report.warnings, 1);
  assert.deepEqual(report.by_rule["eslint/no-null"], { errors: 1, warnings: 0 });
  assert.equal(report.findings[1].level, "w");
});
