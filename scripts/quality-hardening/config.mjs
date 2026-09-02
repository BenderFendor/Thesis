// @ts-check

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const CONFIG_NAME = "quality-hardening.config.json",
 RULES_NAME = "quality-hardening.rules.json",
 OXLINT_NAME = ".oxlintrc.json",
 REQUIRED_SCHEMA_VERSION = 1,
 /** @type {Readonly<{validate: (config: QualityConfig) => void}>} */
 verification = {
   validate: (config) => {
     const checks = asObject(asObject(config.verification).checks),
       defaults = asObject(asObject(config.verification).defaults),
       validators = {
         checks: () => {
           if (Object.keys(checks).at(0) === undefined) {
             throw new Error("verification.checks must contain at least one check");
           }
           for (const [id, value] of Object.entries(checks)) {
             const check = asObject(value);
             stringArray(check.command, `verification.checks.${id}.command`);
             const [label] = stringArray([check.label], `verification.checks.${id}.label`);
             if (label === "") {
               throw new TypeError(`verification.checks.${id}.label must be a non-empty string`);
             }
           }
         },
         defaults: () => {
           for (const name of ["output_limit_bytes", "timeout_ms"]) {
             const value = defaults[name];
             if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
               throw new TypeError(`verification default ${name} must be a positive integer`);
             }
           }
         },
         profiles: () => {
           for (const [profile, value] of Object.entries(config.profiles)) {
             const checkIds = stringArray(value, `profiles.${profile}`);
             for (const id of checkIds) {
               if (!(id in checks)) {
                 throw new Error(`profile ${profile} references unknown verification check: ${id}`);
               }
             }
           }
         },
       };
     validators.checks(); validators.defaults(); validators.profiles();
   },
 };

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {Readonly<{native_config: string, version: string, command: readonly string[], output_limit_bytes: number}>} CcccConfig */
/** @typedef {Readonly<{native_config: string, version: string, command: readonly string[], output_limit_bytes: number}>} OxlintConfig */
/** @typedef {Readonly<{version: string, command: readonly string[], output_limit_bytes: number, working_directory: string}>} CrapConfig */
/** @typedef {Readonly<{command: readonly string[], label: string}>} CheckConfig */
/** @typedef {Readonly<{checks: Readonly<Record<string, CheckConfig>>, defaults: Readonly<{output_limit_bytes: number, timeout_ms: number}>}>} VerificationConfig */
/** @typedef {Readonly<{exclude_directories: readonly string[], exclude_test_files: boolean, extensions: readonly string[], roots: readonly string[]}>} SourceScopeConfig */
/** @typedef {Readonly<{cccc: CcccConfig, crap: CrapConfig, oxlint: OxlintConfig}>} AnalyzerConfig */
/** @typedef {Readonly<{mi: Readonly<{cluster_floor: number, final_floor: number}>, crap: Readonly<{cluster_ceiling: number, legacy_observation_line: number, target: number}>, cccc: Readonly<{cognitive_ceiling: number, cyclomatic_ceiling: number}>, lint: Readonly<{errors: number, warnings: number}>, duplication_percent: number}>} ThresholdConfig */
/** @typedef {Readonly<{analyzers: AnalyzerConfig, policy_version: string, profiles: Readonly<Record<string, readonly string[]>>, schema_version: number, source_scope: SourceScopeConfig, thresholds: ThresholdConfig, verification: VerificationConfig}>} QualityConfig */

/** @param {string} path @returns {Promise<JsonObject>} */
const readJson = async (path) => {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must contain a JSON object`);
  }
  return value;
}

/** @param {string} value */
const hashText = (value) => {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {unknown} value */
const isEnabledRule = (value) => {
  const severity = Array.isArray(value) ? value[0] : value;
  return severity !== "off" && severity !== 0;
}

/** @param {unknown} value @returns {JsonObject} */
function asObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? /** @type {JsonObject} */ (value)
    : {};
}

/** @param {JsonObject} oxlint */
const configuredRuleIds = (oxlint) => {
  /** @type {Set<string>} */
  const ids = new Set(),
  /** @type {(rules: unknown) => void} */
   addRules = (rules) => {
    if (rules === null || typeof rules !== "object" || Array.isArray(rules)) {
      return;
    }
    for (const [id, value] of Object.entries(rules ?? {})) {
      if (isEnabledRule(value)) {
        ids.add(normalizeRuleId(id));
      }
    }
  };
  addRules(oxlint.rules);
  const overrides = Array.isArray(oxlint.overrides) ? oxlint.overrides : [];
  for (const override of overrides) {
    if (override === null || typeof override !== "object" || Array.isArray(override)) {
      continue;
    }
    addRules(override.rules);
  }
  return ids;
}

/** @param {string} id */
function normalizeRuleId(id) {
  return id.includes("/") ? id : `eslint/${id}`;
}

/** @param {string} id @param {JsonObject} taxonomy */
const familyForRule = (id, taxonomy) => {
  const familyDefaults = taxonomy.family_defaults,
   families = Object.keys(
    familyDefaults !== null && typeof familyDefaults === "object" && !Array.isArray(familyDefaults)
      ? familyDefaults
      : {},
  ).sort(
    (left, right) => right.length - left.length,
  );
  return families.find((prefix) => id.startsWith(prefix));
}

/** @param {string} id @param {JsonObject} taxonomy @returns {(JsonObject & {id: string})|undefined} */
const resolvedTaxonomyRule = (id, taxonomy) => {
  const family = familyForRule(id, taxonomy);
  if (family === undefined) {
    return;
  }
  return {
    id,
    ...asObject(asObject(taxonomy.family_defaults)[family]),
    ...asObject(asObject(taxonomy.overrides)[id]),
  };
}

/** @param {unknown} value @param {string} name */
const assertArray = (value, name) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${name} must be a non-empty array`);
  }
}

/** @param {unknown} value @param {string} name @returns {string[]} */
function stringArray(value, name) {
  if (!Array.isArray(value) || value.length === 0 || !value.every((item) => typeof item === "string")) {
    throw new Error(`${name} must contain strings`);
  }
  return (value);
}

/** @param {JsonObject} thresholds */
const validateThresholds = (thresholds) => {
  const cccc = /** @type {JsonObject} */ (thresholds.cccc ?? {}),
    crap = /** @type {JsonObject} */ (thresholds.crap ?? {}),
    mi = /** @type {JsonObject} */ (thresholds.mi ?? {}),
   required = [
    ["mi.cluster_floor", mi.cluster_floor],
    ["mi.final_floor", mi.final_floor],
    ["crap.cluster_ceiling", crap.cluster_ceiling],
    ["cccc.cyclomatic_ceiling", cccc.cyclomatic_ceiling],
    ["cccc.cognitive_ceiling", cccc.cognitive_ceiling],
  ];
  for (const [name, value] of required) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new TypeError(`threshold ${name} must be a finite number`);
    }
  }
  const clusterFloor = mi.cluster_floor,
    finalFloor = mi.final_floor;
  if (typeof finalFloor === "number" && typeof clusterFloor === "number" && finalFloor < clusterFloor) {
    throw new Error("threshold mi.final_floor must be >= mi.cluster_floor");
  }
}

/** @param {JsonObject} taxonomy @param {JsonObject} oxlint */
const validateTaxonomy = (taxonomy, oxlint) => {
  if (taxonomy.schema_version !== REQUIRED_SCHEMA_VERSION) {
    throw new Error("quality-hardening taxonomy schema version is unsupported");
  }
  const ruleIds = stringArray(taxonomy.rule_ids, "taxonomy.rule_ids"),
   uniqueRuleIds = new Set(ruleIds);
  if (uniqueRuleIds.size !== ruleIds.length) {
    throw new Error("taxonomy.rule_ids contains duplicates");
  }
  for (const id of ruleIds) {
    if (resolvedTaxonomyRule(id, taxonomy) === undefined) {
      throw new Error(`taxonomy rule has no family: ${id}`);
    }
  }
  for (const id of configuredRuleIds(oxlint)) {
    if (!uniqueRuleIds.has(id)) {
      throw new Error(`enabled Oxlint rule is missing from taxonomy: ${id}`);
    }
  }
}

/** @param {QualityConfig} config @param {JsonObject} taxonomy @param {JsonObject} oxlint */
const validateConfig = (config, taxonomy, oxlint) => {
  if (config.schema_version !== REQUIRED_SCHEMA_VERSION) {
    throw new Error("quality-hardening config schema version is unsupported");
  }
  if (config.policy_version !== taxonomy.taxonomy_version) {
    throw new Error("config and taxonomy versions must match");
  }
  assertArray(config.source_scope?.roots, "source_scope.roots");
  assertArray(config.source_scope?.extensions, "source_scope.extensions");
  assertArray(asObject(config.profiles).repo, "profiles.repo");
  validateThresholds(config.thresholds);
  validateTaxonomy(taxonomy, oxlint);
  verification.validate(config);
}

/** @param {string} [repositoryRoot] @returns {Promise<Readonly<{config: QualityConfig, configHash: string, nativeConfigHashes: Record<string, string>, oxlint: JsonObject, repositoryRoot: string, taxonomy: JsonObject, taxonomyHash: string}>>} */
const loadPolicy = async (repositoryRoot = process.cwd()) => {
  const root = resolve(repositoryRoot),
   config = /** @type {QualityConfig} */ (await readJson(resolve(root, CONFIG_NAME))),
   taxonomy = await readJson(resolve(root, RULES_NAME)),
   oxlint = await readJson(resolve(root, OXLINT_NAME));
  validateConfig(config, taxonomy, oxlint);
  const nativeConfigPaths = new Set([
    OXLINT_NAME,
    config.analyzers.cccc.native_config,
  ]),
  /** @type {Record<string, string>} */
   nativeConfigHashes = {};
  for (const path of nativeConfigPaths) {
    const text = await readFile(resolve(root, path), "utf8");
    nativeConfigHashes[path] = hashText(text);
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
}

export {
  configuredRuleIds,
  hashText,
  loadPolicy,
  normalizeRuleId,
  resolvedTaxonomyRule,
  validateConfig,
  validateTaxonomy,
};
