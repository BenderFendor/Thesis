// @ts-check

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const CONFIG_NAME = "quality-hardening.config.json",
  OXLINT_NAME = ".oxlintrc.json",
  SCRIPT_OXLINT_NAME = "scripts/oxlint.config.json",
  REQUIRED_SCHEMA_VERSION = 1,
  RULES_NAME = "quality-hardening.rules.json";

/** @typedef {Readonly<{native_config: string, version: string, command: readonly string[], output_limit_bytes: number}>} CcccConfig */
/** @typedef {Readonly<{native_config: string, version: string, command: readonly string[], output_limit_bytes: number}>} OxlintConfig */
/** @typedef {Readonly<{version: string, command: readonly string[], output_limit_bytes: number, working_directory: string}>} CrapConfig */
/** @typedef {Readonly<{command: readonly string[], label: string}>} CheckConfig */
/** @typedef {Readonly<{checks: Readonly<Record<string, CheckConfig>>, defaults: Readonly<{output_limit_bytes: number, timeout_ms: number}>}>} VerificationConfig */
/** @typedef {Readonly<{exclude_directories: readonly string[], exclude_test_files: boolean, extensions: readonly string[], roots: readonly string[]}>} SourceScopeConfig */
/** @typedef {Readonly<{cccc: CcccConfig, crap: CrapConfig, oxlint: OxlintConfig}>} AnalyzerConfig */
/** @typedef {Readonly<{mi: Readonly<{cluster_floor: number, final_floor: number}>, crap: Readonly<{cluster_ceiling: number, legacy_observation_line: number, target: number}>, cccc: Readonly<{cognitive_ceiling: number, cyclomatic_ceiling: number}>, lint: Readonly<{errors: number, warnings: number}>, duplication_percent: number}>} ThresholdConfig */
/** @typedef {Readonly<{analyzers: AnalyzerConfig, policy_version: string, profiles: Readonly<Record<string, readonly string[]>>, schema_version: number, source_scope: SourceScopeConfig, thresholds: ThresholdConfig, verification: VerificationConfig}>} QualityConfig */
/** @typedef {Readonly<{cluster_key?: string, deterministic_fix?: boolean, quality_factor?: string, repair_class?: string, required_profiles?: readonly string[], temporary_structural_tradeoff?: boolean}>} TaxonomyRuleDefinition */
/** @typedef {Readonly<{cluster_key: string, deterministic_fix?: boolean, id: string, quality_factor: string, repair_class: string, required_profiles?: readonly string[], temporary_structural_tradeoff?: boolean}>} ResolvedTaxonomyRule */
/** @typedef {Readonly<{family_defaults: Readonly<Record<string, TaxonomyRuleDefinition>>, overrides: Readonly<Record<string, TaxonomyRuleDefinition>>, rule_ids: readonly string[], schema_version: number, taxonomy_version: string}>} TaxonomyConfig */
/** @typedef {Readonly<{rules?: Readonly<Record<string, unknown>>}>} OxlintOverride */
/** @typedef {Readonly<{rules?: Readonly<Record<string, unknown>>, overrides?: readonly OxlintOverride[]}>} OxlintPolicy */

const hashText = (value) => createHash("sha256").update(value).digest("hex");

const readJson = async (path) => {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value === null || Array.isArray(value) || Object.prototype.toString.call(value) !== "[object Object]") {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value;
};

const normalizeRuleId = (id) => id.includes("/") ? id : `eslint/${id}`;

const isEnabledRule = (setting) => {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return severity !== "off" && severity !== 0;
};

const configuredRuleIds = (oxlint) => {
  const identifiers = new Set();
  const addRules = (rules) => {
    for (const [id, setting] of Object.entries(rules ?? {})) {
      if (isEnabledRule(setting)) { identifiers.add(normalizeRuleId(id)); }
    }
  };
  addRules(oxlint.rules);
  for (const override of oxlint.overrides ?? []) { addRules(override.rules); }
  return identifiers;
};

const familyForRule = (id, taxonomy) => Object.keys(taxonomy.family_defaults)
  .toSorted((left, right) => right.length - left.length)
  .find((prefix) => id.startsWith(prefix));

const resolvedTaxonomyRule = (id, taxonomy) => {
  const family = familyForRule(id, taxonomy);
  if (family === undefined) { return undefined; }
  const definition = {
    ...taxonomy.family_defaults[family],
    ...taxonomy.overrides?.[id],
  };
  if (!definition.cluster_key || !definition.quality_factor || !definition.repair_class) {
    throw new Error(`taxonomy rule is incomplete: ${id}`);
  }
  return {
    ...definition,
    cluster_key: definition.cluster_key,
    id,
    quality_factor: definition.quality_factor,
    repair_class: definition.repair_class,
  };
};

const nonEmptyArray = (value, name) => {
  if (value.length === 0) { throw new Error(`${name} must be a non-empty array`); }
  return value;
};

const nonEmptyStrings = (value, name) => {
  nonEmptyArray(value, name);
  if (value.some((item) => item.length === 0)) {
    throw new Error(`${name} must contain non-empty strings`);
  }
  return value;
};

const validateThresholds = (thresholds) => {
  const required = new Map([
    ["mi.cluster_floor", thresholds.mi.cluster_floor],
    ["mi.final_floor", thresholds.mi.final_floor],
    ["crap.cluster_ceiling", thresholds.crap.cluster_ceiling],
    ["cccc.cyclomatic_ceiling", thresholds.cccc.cyclomatic_ceiling],
    ["cccc.cognitive_ceiling", thresholds.cccc.cognitive_ceiling],
  ]);
  for (const [name, value] of required) {
    if (!Number.isFinite(value)) { throw new TypeError(`threshold ${name} must be a finite number`); }
  }
  if (thresholds.mi.final_floor < thresholds.mi.cluster_floor) {
    throw new Error("threshold mi.final_floor must be >= mi.cluster_floor");
  }
};

const validateVerification = (config) => {
  const { checks, defaults } = config.verification;
  nonEmptyArray(Object.keys(checks), "verification.checks");
  for (const [id, check] of Object.entries(checks)) {
    nonEmptyStrings(check.command, `verification.checks.${id}.command`);
    nonEmptyStrings([check.label], `verification.checks.${id}.label`);
  }
  for (const name of ["output_limit_bytes", "timeout_ms"]) {
    const value = defaults[name];
    if (!Number.isInteger(value) || value <= 0) {
      throw new TypeError(`verification default ${name} must be a positive integer`);
    }
  }
  for (const [profile, checkIds] of Object.entries(config.profiles)) {
    nonEmptyStrings(checkIds, `profiles.${profile}`);
    for (const id of checkIds) {
      if (!(id in checks)) { throw new Error(`profile ${profile} references unknown verification check: ${id}`); }
    }
  }
};

const validateTaxonomy = (taxonomy, oxlint) => {
  if (taxonomy.schema_version !== REQUIRED_SCHEMA_VERSION) {
    throw new Error("quality-hardening taxonomy schema version is unsupported");
  }
  const ruleIds = nonEmptyStrings(taxonomy.rule_ids, "taxonomy.rule_ids"),
    knownRules = new Set(ruleIds);
  if (knownRules.size !== ruleIds.length) { throw new Error("taxonomy.rule_ids contains duplicates"); }
  for (const id of ruleIds) {
    if (resolvedTaxonomyRule(id, taxonomy) === undefined) { throw new Error(`taxonomy rule has no family: ${id}`); }
  }
  for (const id of configuredRuleIds(oxlint)) {
    if (!knownRules.has(id)) { throw new Error(`enabled Oxlint rule is missing from taxonomy: ${id}`); }
  }
};

const validateConfig = (config, taxonomy, oxlint) => {
  if (config.schema_version !== REQUIRED_SCHEMA_VERSION) {
    throw new Error("quality-hardening config schema version is unsupported");
  }
  if (config.policy_version !== taxonomy.taxonomy_version) {
    throw new Error("config and taxonomy versions must match");
  }
  nonEmptyStrings(config.source_scope.roots, "source_scope.roots");
  nonEmptyStrings(config.source_scope.extensions, "source_scope.extensions");
  nonEmptyStrings(config.profiles.repo, "profiles.repo");
  validateThresholds(config.thresholds);
  validateVerification(config);
  validateTaxonomy(taxonomy, oxlint);
};

const loadPolicy = async (repositoryRoot = process.cwd()) => {
  const root = resolve(repositoryRoot);
  /** @type {QualityConfig} */
  const config = await readJson(resolve(root, CONFIG_NAME));
  /** @type {TaxonomyConfig} */
  const taxonomy = await readJson(resolve(root, RULES_NAME));
  /** @type {OxlintPolicy} */
  const oxlint = await readJson(resolve(root, OXLINT_NAME));
  /** @type {OxlintPolicy} */
  const scriptOxlint = await readJson(resolve(root, SCRIPT_OXLINT_NAME));
  validateConfig(config, taxonomy, oxlint);
  validateTaxonomy(taxonomy, scriptOxlint);
  const nativeConfigPaths = new Set([OXLINT_NAME, SCRIPT_OXLINT_NAME, config.analyzers.cccc.native_config]),
    nativeConfigHashes = {};
  for (const path of nativeConfigPaths) {
    nativeConfigHashes[path] = hashText(await readFile(resolve(root, path), "utf8"));
  }
  return {
    config,
    configHash: hashText(JSON.stringify(config)),
    nativeConfigHashes,
    oxlint,
    repositoryRoot: root,
    taxonomy,
    taxonomyHash: hashText(JSON.stringify(taxonomy)),
  };
};

export {
  configuredRuleIds,
  hashText,
  loadPolicy,
  normalizeRuleId,
  resolvedTaxonomyRule,
  validateConfig,
  validateTaxonomy,
};
