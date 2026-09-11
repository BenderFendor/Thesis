import { sourceUnitId } from "../../quality-hardening/source-units.mjs";

const assert = process.getBuiltinModule("node:assert/strict");
const { test } = process.getBuiltinModule("node:test");

void test("source unit IDs are stable and path-sensitive", () => {
  const input = { kind: "function", language: "ecmascript", path: "frontend/app/page.tsx", symbol: "render" };
  assert.equal(sourceUnitId(input), sourceUnitId({ ...input }));
  assert.notEqual(sourceUnitId(input), sourceUnitId({ ...input, path: "frontend/app/other.tsx" }));
});
