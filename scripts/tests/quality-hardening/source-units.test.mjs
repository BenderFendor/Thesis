import assert from "node:assert/strict";
import { sourceUnitId } from "../../quality-hardening/source-units.mjs";
import { test } from "node:test";

test("source unit IDs are stable and path-sensitive", () => {
  const input = { kind: "function", language: "ecmascript", path: "frontend/app/page.tsx", symbol: "render" };
  assert.equal(sourceUnitId(input), sourceUnitId({ ...input }));
  assert.notEqual(sourceUnitId(input), sourceUnitId({ ...input, path: "frontend/app/other.tsx" }));
});
