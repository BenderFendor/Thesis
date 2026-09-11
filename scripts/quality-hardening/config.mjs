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
/** @typedef {Readonly<{family_defaults: Readonly<Record<string, TaxonomyRuleDefinition>>, overrides: Readonly<Record<string, TaxonomyRuleDefinition>>}>} TaxonomyLookup */
/** @typedef {Readonly<{rules?: Readonly<Record<string, unknown>>}>} OxlintOverride */
/** @typedef {Readonly<{rules?: Readonly<Record<string, unknown>>, overrides?: readonly OxlintOverride[]}>} OxlintPolicy */
/** @typedef {Record<string, unknown>} JsonObject */

/** @param {string} value @returns {string} */
const hashText = (value) => createHash("sha256").update(value).digest("hex");

/** @param {string} path @returns {Promise<JsonObject>} */
const readJson = async (path) => {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value === null || Array.isArray(value) || Object.prototype.toString.call(value) !== "[object Object]") {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value;
};

/** @param {unknown} value @returns {value is JsonObject} */
const isRecord = (value) => value !== null && Object(value) === value && !Array.isArray(value);
/** @param {unknown} value @returns {value is string} */
const isString = (value) => value?.constructor === String;
/** @param {unknown} value @returns {value is readonly string[]} */
const isStringArray = (value) => Array.isArray(value) && value.every(isString);
/** @param {unknown} value @returns {value is boolean} */
const isBoolean = (value) => value?.constructor === Boolean;
/** @param {unknown} value @returns {value is number} */
const isNumber = (value) => value?.constructor === Number;
/** @param {JsonObject} value @param {readonly string[]} names @returns {boolean} */
const hasNumberFields = (value, names) => names.every((name) => isNumber(value[name]));
/** @param {unknown} value @returns {boolean} */
const matchesString = (value) => isString(value);
/** @param {unknown} value @returns {boolean} */
const matchesBoolean = (value) => isBoolean(value);
/** @param {unknown} value @returns {boolean} */
const matchesStringArray = (value) => isStringArray(value);

/** @param {unknown} value @returns {value is CcccConfig} */
const isStandardAnalyzerConfig = (value) => isRecord(value)
  && isString(value.native_config)
  && isString(value.version)
  && isStringArray(value.command)
  && isNumber(value.output_limit_bytes);

/** @param {unknown} value @returns {value is CrapConfig} */
const isCrapAnalyzerConfig = (value) => isRecord(value)
  && isString(value.version)
  && isStringArray(value.command)
  && isNumber(value.output_limit_bytes)
  && isString(value.working_directory);

/** @param {unknown} value @returns {value is SourceScopeConfig} */
const isSourceScopeConfig = (value) => isRecord(value)
  && isStringArray(value.exclude_directories)
  && isBoolean(value.exclude_test_files)
  && isStringArray(value.extensions)
  && isStringArray(value.roots);

/** @param {unknown} value @returns {value is ThresholdConfig} */
const isThresholdConfig = (value) => {
  if (!isRecord(value)) { return false; }
  return isRecord(value.mi)
    && hasNumberFields(value.mi, ["cluster_floor", "final_floor"])
    && isRecord(value.crap)
    && hasNumberFields(value.crap, ["cluster_ceiling", "legacy_observation_line", "target"])
    && isRecord(value.cccc)
    && hasNumberFields(value.cccc, ["cognitive_ceiling", "cyclomatic_ceiling"])
    && isRecord(value.lint)
    && hasNumberFields(value.lint, ["errors", "warnings"])
    && isNumber(value.duplication_percent);
};

/** @param {unknown} value @returns {value is CheckConfig} */
const isCheckConfig = (value) => isRecord(value) && isStringArray(value.command) && isString(value.label);

/** @param {unknown} value @returns {value is VerificationConfig} */
const isVerificationConfig = (value) => {
  if (!isRecord(value) || !isRecord(value.checks) || !isRecord(value.defaults)) { return false; }
  return Object.values(value.checks).every(isCheckConfig)
    && hasNumberFields(value.defaults, ["output_limit_bytes", "timeout_ms"]);
};

/** @param {unknown} value @returns {boolean} */
const hasValidAnalyzerConfig = (value) => {
  if (!isRecord(value)) { return false; }
  return isStandardAnalyzerConfig(value.cccc)
    && isCrapAnalyzerConfig(value.crap)
    && isStandardAnalyzerConfig(value.oxlint);
};

/** @param {unknown} value @returns {boolean} */
const hasValidProfiles = (value) => isRecord(value) && Object.values(value).every(isStringArray);

/** @param {unknown} value @returns {value is QualityConfig} */
const isQualityConfig = (value) => {
  if (!isRecord(value)) { return false; }
  return isNumber(value.schema_version)
    && isString(value.policy_version)
    && isSourceScopeConfig(value.source_scope)
    && hasValidAnalyzerConfig(value.analyzers)
    && isThresholdConfig(value.thresholds)
    && isVerificationConfig(value.verification)
    && hasValidProfiles(value.profiles);
};

/** @type {Map<string, (field: unknown) => boolean>} */
const TAXONOMY_OPTIONAL_FIELDS = new Map([
  ["cluster_key", matchesString],
  ["deterministic_fix", matchesBoolean],
  ["quality_factor", matchesString],
  ["repair_class", matchesString],
  ["required_profiles", matchesStringArray],
  ["temporary_structural_tradeoff", matchesBoolean],
]);

/** @param {JsonObject} value @returns {boolean} */
const hasValidTaxonomyOptionalFields = (value) => {
  for (const [name, guard] of TAXONOMY_OPTIONAL_FIELDS) {
    const field = value[name];
    if (field !== undefined && !guard(field)) { return false; }
  }
  return true;
};

/** @param {unknown} value @returns {value is TaxonomyRuleDefinition} */
const isTaxonomyRuleDefinition = (value) => {
  if (!isRecord(value)) { return false; }
  return hasValidTaxonomyOptionalFields(value);
};

/** @param {unknown} value @returns {value is TaxonomyConfig} */
const isTaxonomyConfig = (value) => {
  if (!isRecord(value) || !isRecord(value.family_defaults) || !isRecord(value.overrides)) { return false; }
  return isNumber(value.schema_version)
    && isString(value.taxonomy_version)
    && isStringArray(value.rule_ids)
    && Object.values(value.family_defaults).every(isTaxonomyRuleDefinition)
    && Object.values(value.overrides).every(isTaxonomyRuleDefinition);
};

/** @param {unknown} value @returns {value is OxlintPolicy} */
const isOxlintPolicy = (value) => {
  if (!isRecord(value)) { return false; }
  if (value.rules !== undefined && !isRecord(value.rules)) { return false; }
  if (value.overrides === undefined) { return true; }
  return Array.isArray(value.overrides)
    && value.overrides.every((override) => isRecord(override) && (override.rules === undefined || isRecord(override.rules)));
};

/** @param {string} id @returns {string} */
const normalizeRuleId = (id) => id.includes("/") ? id : `eslint/${id}`;

/** @param {unknown} setting @returns {boolean} */
const isEnabledRule = (setting) => {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return severity !== "off" && severity !== 0;
};

/** @param {OxlintPolicy} oxlint @returns {Set<string>} */
const configuredRuleIds = (oxlint) => {
  const identifiers = new Set();
  /** @param {Readonly<Record<string, unknown>>|undefined} rules */
  const addRules = (rules) => {
    for (const [id, setting] of Object.entries(rules ?? {})) {
      if (isEnabledRule(setting)) { identifiers.add(normalizeRuleId(id)); }
    }
  };
  addRules(oxlint.rules);
  for (const override of oxlint.overrides ?? []) { addRules(override.rules); }
  return identifiers;
};

/** @param {string} id @param {TaxonomyLookup} taxonomy @returns {string|undefined} */
const familyForRule = (id, taxonomy) => Object.keys(taxonomy.family_defaults)
  .toSorted((left, right) => right.length - left.length)
  .find((prefix) => id.startsWith(prefix));

/** @param {string} id @param {TaxonomyLookup} taxonomy @returns {ResolvedTaxonomyRule|undefined} */
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

/** @param {readonly unknown[]} value @param {string} name @returns {readonly unknown[]} */
const nonEmptyArray = (value, name) => {
  if (value.length === 0) { throw new Error(`${name} must be a non-empty array`); }
  return value;
};

/** @param {readonly string[]} value @param {string} name @returns {readonly string[]} */
const nonEmptyStrings = (value, name) => {
  nonEmptyArray(value, name);
  if (value.some((item) => item.length === 0)) {
    throw new Error(`${name} must contain non-empty strings`);
  }
  return value;
};

/** @param {ThresholdConfig} thresholds */
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

/** @param {number} value @param {string} name */
const validatePositiveInteger = (value, name) => {
  if (!Number.isInteger(value) || value <= 0) {
    throw new TypeError(`verification default ${name} must be a positive integer`);
  }
};

/** @param {QualityConfig} config */
const validateVerification = (config) => {
  const { checks, defaults } = config.verification;
  nonEmptyArray(Object.keys(checks), "verification.checks");
  for (const [id, check] of Object.entries(checks)) {
    nonEmptyStrings(check.command, `verification.checks.${id}.command`);
    nonEmptyStrings([check.label], `verification.checks.${id}.label`);
  }
  validatePositiveInteger(defaults.output_limit_bytes, "output_limit_bytes");
  validatePositiveInteger(defaults.timeout_ms, "timeout_ms");
  for (const [profile, checkIds] of Object.entries(config.profiles)) {
    nonEmptyStrings(checkIds, `profiles.${profile}`);
    for (const id of checkIds) {
      if (!(id in checks)) { throw new Error(`profile ${profile} references unknown verification check: ${id}`); }
    }
  }
};

/** @param {TaxonomyConfig} taxonomy @param {OxlintPolicy} oxlint */
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

/** @param {QualityConfig} config @param {TaxonomyConfig} taxonomy @param {OxlintPolicy} oxlint */
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
  const config = await readJson(resolve(root, CONFIG_NAME));
  if (!isQualityConfig(config)) { throw new TypeError("quality-hardening config has an invalid shape"); }
  const taxonomy = await readJson(resolve(root, RULES_NAME));
  if (!isTaxonomyConfig(taxonomy)) { throw new TypeError("quality-hardening taxonomy has an invalid shape"); }
  const oxlint = await readJson(resolve(root, OXLINT_NAME));
  const scriptOxlint = await readJson(resolve(root, SCRIPT_OXLINT_NAME));
  if (!isOxlintPolicy(oxlint) || !isOxlintPolicy(scriptOxlint)) { throw new TypeError("Oxlint policy has an invalid shape"); }
  validateConfig(config, taxonomy, oxlint);
  validateTaxonomy(taxonomy, scriptOxlint);
  const nativeConfigPaths = new Set([OXLINT_NAME, SCRIPT_OXLINT_NAME, config.analyzers.cccc.native_config]),
    /** @type {Record<string, string>} */
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
