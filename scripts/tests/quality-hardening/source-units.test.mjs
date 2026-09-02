import assert from "node:assert/strict";
import { test } from "node:test";
import { sourceUnitId } from "../../quality-hardening/source-units.mjs";

test("source unit IDs are stable and path-sensitive", () => {
  const input = { kind: "function", language: "ecmascript", symbol: "render", path: "frontend/app/page.tsx" };
  assert.equal(sourceUnitId(input), sourceUnitId({ ...input }));
  assert.notEqual(sourceUnitId(input), sourceUnitId({ ...input, path: "frontend/app/other.tsx" }));
});
