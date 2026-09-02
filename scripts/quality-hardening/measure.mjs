import { collectChangedSourceFiles, collectSourceFiles } from "./source-units.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { hashText } from "./config.mjs";
import { resolve } from "node:path";
import { runCccc } from "./adapters/cccc.mjs";
import { runCodeMultivitals } from "./adapters/code-multivitals.mjs";
import { runCrap } from "./adapters/crap.mjs";
import { runOxlint } from "./adapters/oxlint.mjs";

/** @typedef {Record<string, unknown>} JsonObject */
/** @typedef {Readonly<{coverage: Readonly<{crap: number|null, percent?: number, state: string}>, kind: string, line?: number, metrics: Readonly<Record<string, Readonly<Record<string, number|undefined>>>>, path: string, symbol: string, unit_id: string}>} QualityUnit */
/** @typedef {Readonly<{exclude_directories: readonly string[], exclude_test_files: boolean, extensions: readonly string[], roots: readonly string[]}>} SourceScope */
/** @typedef {Readonly<{analyzers: Readonly<{cccc: Readonly<{command: readonly string[], native_config: string, output_limit_bytes: number, version: string}>, crap: Readonly<{command: readonly string[], output_limit_bytes: number, version: string, working_directory: string}>, oxlint: Readonly<{command: readonly string[], native_config: string, output_limit_bytes: number, version: string}>}>, policy_version: string, schema_version: number, source_scope: SourceScope, thresholds: Readonly<{crap: Readonly<{cluster_ceiling: number}>}>}>} QualityConfig */
/** @typedef {Readonly<{config: QualityConfig, configHash: string, nativeConfigHashes: Readonly<Record<string, string>>, repositoryRoot: string}>} Policy */
/** @typedef {{by_rule: JsonObject, errors: number|null, findings: readonly unknown[], status: string, warnings: number|null}} LintRecord */
/** @typedef {{analyzer: string, message?: string, status: string, units: readonly JsonObject[], warnings: readonly string[]}} MiRecord */
/** @typedef {{units: readonly QualityUnit[], violations: readonly unknown[]}} CcccRecord */
/** @typedef {{analyzer: string, status: string, units: readonly QualityUnit[], violations: readonly QualityUnit[]}} CrapRecord */
/** @typedef {{measurement_id: string, measured_at: string, schema_version: number, policy_version: string, repository: JsonObject, tools: JsonObject, scope: JsonObject, source_files: Readonly<Record<string, string>>, units: readonly QualityUnit[], mi: JsonObject, lint: JsonObject, verification: readonly JsonObject[]}} Measurement */

const EMPTY_PATH_COUNT = 0;

/** @param {string} value */
const runHash = (value) => {
  return createHash("sha256").update(value).digest("hex");
}

/** @param {string} repositoryRoot @param {readonly string[]} paths @returns {Promise<Record<string, string>>} */
const fileHashes = async (repositoryRoot, paths) => {
  /** @type {Promise<[string, string]>[]} */
  const entries = paths.map(async (path) => /** @type {[string, string]} */ ([path, runHash(await readFile(resolve(repositoryRoot, path), "utf8"))]));
  return Object.fromEntries(await Promise.all(entries));
}

/** @param {string} repositoryRoot @returns {Promise<string>} */
const gitHead = async (repositoryRoot) => {
  const { stdout } = await import("node:child_process").then(
    ({ execFile }) =>
      new Promise((resolvePromise, reject) => {
        execFile("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot }, (error, output) => {
          if (error) {
            reject(error);
            return;
          }
          resolvePromise({ stdout: output.trim() });
        });
      }),
  );
  return stdout;
}

/** @param {Readonly<Record<string, string>>} hashes */
const fingerprint = (hashes) => {
  return runHash(
    Object.entries(hashes)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([path, hash]) => `${path}\0${hash}`)
      .join("\n"),
  );
}

/** @param {JsonObject} record */
const measurementId = (record) => {
  const { measured_at: _measuredAt, ...stableRecord } = record;
  return `qh-measure:${hashText(JSON.stringify(stableRecord)).slice(0, 24)}`;
}

/** @param {string} root @param {Measurement} record @param {JsonObject} raw */
const storeMeasurement = async (root, record, raw) => {
  const directory = resolve(root, ".quality-hardening/measurements");
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, `${record.measurement_id.slice("qh-measure:".length)}.json`),
    `${JSON.stringify({ measurement: record, raw }, null, 2)}\n`,
  );
}

/** @param {string} repositoryRoot @param {string} measurementId @returns {Promise<Measurement>} */
const readMeasurement = async (repositoryRoot, measurementId) => {
  const shortId = measurementId.replace(/^qh-measure:/u, "");
  if (!/^[a-f0-9]{24}$/u.test(shortId)) {throw new Error(`invalid measurement ID: ${measurementId}`);}
  const path = resolve(repositoryRoot, ".quality-hardening/measurements", `${shortId}.json`),
   envelope = JSON.parse(await readFile(path, "utf8"));
  if (!envelope || typeof envelope !== "object" || !envelope.measurement) {throw new Error(`measurement is invalid: ${measurementId}`);}
  return envelope.measurement;
}

/** @returns {MiRecord} */
const emptyMiRecord = () => {
  return { analyzer: "code-multivitals", status: "not_selected", units: [], warnings: [] };
}

/** @param {string} repositoryRoot @param {readonly string[]} paths @returns {MiRecord} */
const measureMi = (repositoryRoot, paths) => {
  if (paths.length === 0) {return emptyMiRecord();}
  try {
    return { ...runCodeMultivitals(repositoryRoot, paths), status: "passed" };
  } catch (error) {
    return {
      analyzer: "code-multivitals",
      message: error instanceof Error ? error.message : String(error),
      status: "analyzer_error",
      units: [],
      warnings: [],
    };
  }
}

/** @param {string} repositoryRoot @param {QualityConfig["analyzers"]["oxlint"]} analyzer @param {readonly string[]} paths @returns {Promise<{failure?: string, lint: LintRecord}>} */
const measureLint = async (repositoryRoot, analyzer, paths) => {
  const empty = { by_rule: {}, errors: null, findings: [], status: "not_selected", warnings: null };
  if (paths.length === 0) {return { lint: empty };}
  try {
    const report = await runOxlint(repositoryRoot, analyzer, paths);
    return { lint: { ...report, status: report.errors === 0 && report.warnings === 0 ? "passed" : "failed" } };
  } catch (error) {
    return {
      failure: error instanceof Error ? error.message : String(error),
      lint: { ...empty, status: "analyzer_error" },
    };
  }
}

/** @returns {CrapRecord} */
const emptyCrapRecord = () => {
  return { analyzer: "crap-typescript", status: "not_selected", units: [], violations: [] };
}

/** @param {string} repositoryRoot @param {QualityConfig["analyzers"]["crap"]} analyzer @param {readonly string[]} paths @param {number} threshold @returns {Promise<{failure?: string, crap: CrapRecord}>} */
const measureCrap = async (repositoryRoot, analyzer, paths, threshold) => {
  if (paths.length === 0) {return { crap: emptyCrapRecord() };}
  try {
    const report = await runCrap(repositoryRoot, analyzer, paths, threshold);
    return { crap: { ...report, status: report.violations.length === 0 ? "passed" : "failed" } };
  } catch (error) {
    return {
      crap: { ...emptyCrapRecord(), status: "analyzer_error" },
      failure: error instanceof Error ? error.message : String(error),
    };
  }
}

/** @param {readonly QualityUnit[]} units @param {readonly QualityUnit[]} crapUnits @returns {QualityUnit[]} */
const applyCoverage = (units, crapUnits) => {
  const coverageByUnit = new Map(crapUnits.map((unit) => [`${unit.path}\0${unit.symbol}`, unit.coverage]));
  return units.map((unit) => ({ ...unit, coverage: coverageByUnit.get(`${unit.path}\0${unit.symbol}`) ?? unit.coverage }));
}

/** @param {Policy} policy @param {string} scope @param {readonly string[]} selectedPaths @param {Readonly<Record<string, string>>} hashes @param {CcccRecord} cccc @param {MiRecord} mi @param {LintRecord} lint @param {CrapRecord} crap @param {string|undefined} lintFailure @param {string|undefined} crapFailure */
const createMeasurement = (policy, scope, selectedPaths, hashes, cccc, mi, lint, crap, lintFailure, crapFailure) => {
  const record = {
    crap: {
      analyzer: crap.analyzer,
      measured_units: crap.units.filter((unit) => unit.coverage.state === "measured").length,
      status: crap.status,
      unknown_units: crap.units.filter((unit) => unit.coverage.state !== "measured").length,
      violations: crap.violations.length,
      ...(crapFailure ? { message: crapFailure } : {}),
    },
    lint,
    measured_at: new Date().toISOString(),
    measurement_id: "",
    mi,
    policy_version: policy.config.policy_version,
    repository: {
      head: "",
      root: policy.repositoryRoot,
      worktree_fingerprint: fingerprint(hashes),
    },
    schema_version: policy.config.schema_version,
    scope: { kind: scope, paths: selectedPaths },
    source_files: hashes,
    tools: {
      cccc: {
        analyzer_version: policy.config.analyzers.cccc.version,
        config_sha256: policy.nativeConfigHashes[policy.config.analyzers.cccc.native_config],
      },
      crap_typescript: {
        analyzer_version: policy.config.analyzers.crap.version,
      },
      oxlint: {
        analyzer_version: policy.config.analyzers.oxlint.version,
        config_sha256: policy.nativeConfigHashes[policy.config.analyzers.oxlint.native_config],
      },
    },
    units: applyCoverage(/** @type {QualityUnit[]} */ ([...cccc.units, ...mi.units]), crap.units),
    verification: [
      {
        analyzer: "cccc",
        status: cccc.violations.length === 0 ? "passed" : "failed",
        violations: cccc.violations.length,
      },
      {
        analyzer: "oxlint",
        status: lint.status,
        errors: lint.errors,
        warnings: lint.warnings,
        ...(lintFailure ? { message: lintFailure } : {}),
      },
      {
        analyzer: "crap-typescript",
        status: crap.status,
        violations: crap.violations.length,
        ...(crapFailure ? { message: crapFailure } : {}),
      },
    ],
  };
  return record;
}

/** @param {{policy: Policy, scope?: string, paths?: readonly string[]}} options @returns {Promise<Measurement>} */
const measureRepository = async ({ policy, scope = "repo", paths = [] }) => {
  let selectedPaths;
  if (scope === "changed" && paths.length === EMPTY_PATH_COUNT) {
    selectedPaths = await collectChangedSourceFiles(policy.repositoryRoot, policy.config);
  } else {
    selectedPaths = await collectSourceFiles(policy.repositoryRoot, policy.config, paths);
  }
  if (selectedPaths.length === 0) {
    throw new Error(`measurement scope ${scope} selected no source files`);
  }
  const hashes = await fileHashes(policy.repositoryRoot, selectedPaths),
   cccc = await runCccc(policy.repositoryRoot, policy.config.analyzers.cccc, selectedPaths),
   scriptPaths = selectedPaths.filter((path) => /\.(?:c|m)?[jt]sx?$/u.test(path)),
   crapPaths = selectedPaths.filter((path) => path.startsWith("frontend/") && /\.(?:ts|tsx)$/u.test(path)),
   mi = measureMi(policy.repositoryRoot, scriptPaths),
   [{ failure: lintFailure, lint }, { failure: crapFailure, crap }] = await Promise.all([
    measureLint(policy.repositoryRoot, policy.config.analyzers.oxlint, scriptPaths),
    measureCrap(policy.repositoryRoot, policy.config.analyzers.crap, crapPaths, policy.config.thresholds.crap.cluster_ceiling),
  ]),
   record = createMeasurement(policy, scope, selectedPaths, hashes, cccc, mi, lint, crap, lintFailure, crapFailure);
  record.repository.head = await gitHead(policy.repositoryRoot);
  record.measurement_id = measurementId(record);
  await storeMeasurement(policy.repositoryRoot, record, { cccc, crap });
  return record;
}

export { measureRepository, readMeasurement };
