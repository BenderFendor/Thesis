import {
  configuredRuleIds,
  loadPolicy,
  resolvedTaxonomyRule,
} from "../../quality-hardening/config.mjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const assert = process.getBuiltinModule("node:assert/strict");
const { test } = process.getBuiltinModule("node:test");

const repositoryRoot = resolve(import.meta.dirname, "../../..");

void test("quality-hardening policy validates against enabled Oxlint rules", async () => {
  const policy = await loadPolicy(repositoryRoot);
  const oxlint = JSON.parse(await readFile(resolve(repositoryRoot, ".oxlintrc.json"), "utf8"));
  const configured = configuredRuleIds(oxlint);
  assert.ok(configured.size > 0);
  for (const id of configured) {
    assert.deepEqual(resolvedTaxonomyRule(id, policy.taxonomy)?.id, id);
  }
});

void test("taxonomy preserves structural metadata for function-size rules", async () => {
  const policy = await loadPolicy(repositoryRoot);
  const rule = resolvedTaxonomyRule("eslint/max-lines-per-function", policy.taxonomy);
  assert.equal(rule?.quality_factor, "structural_maintainability");
  assert.equal(rule?.repair_class, "structural");
  assert.equal(rule?.temporary_structural_tradeoff, true);
});

void test("verification profiles resolve every check from the canonical policy", async () => {
  const policy = await loadPolicy(repositoryRoot);
  const checkIds = Object.values(policy.config.profiles).flat();
  assert.equal(checkIds.every((checkId) => policy.config.verification.checks[checkId] !== undefined), true);
});
