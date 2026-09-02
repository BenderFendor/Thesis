// @ts-check

import { execFile } from "node:child_process";
import { sourceUnitId } from "../source-units.mjs";

/** @typedef {Readonly<{cc?: number, crap?: number, cov?: number, lineEnd?: number, lineStart?: number, method?: string, src?: string, status?: string}>} CrapMethod */
/** @typedef {Readonly<{methods?: readonly CrapMethod[], status?: string}>} CrapReport */
/** @typedef {Readonly<{command: readonly string[], output_limit_bytes: number, version: string, working_directory: string}>} CrapAnalyzer */
/** @typedef {Readonly<{coverage: Readonly<{crap: number|null, percent?: number, state: string}>, kind: string, line?: number, metrics: Readonly<{crap_typescript: Readonly<{cyclomatic?: number, crap?: number}>}>, path: string, symbol: string, unit_id: string}>} CrapUnit */
/** @typedef {Readonly<{analyzer: string, methods: readonly CrapMethod[], units: readonly CrapUnit[], violations: readonly CrapUnit[]}>} CrapNormalizedReport */

const FINDINGS_EXIT = 1,
 REPORT_EXIT = 2,
 SUCCESS_EXIT = 0;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {string} path @param {string} repositoryRoot */
function repositoryPath(path, repositoryRoot) {
  const normalized = path.replaceAll("\\", "/");
  return normalized.startsWith(`${repositoryRoot}/`) ? normalized.slice(repositoryRoot.length + 1) : `frontend/${normalized}`;
}

/** @param {string} path @param {string} repositoryRoot @param {CrapMethod} method */
function normalizeMethod(path, repositoryRoot, method) {
  const coverage = typeof method.cov === "number" && Number.isFinite(method.cov) ? method.cov : undefined,
   crap = typeof method.crap === "number" && Number.isFinite(method.crap) && coverage !== undefined ? method.crap : null,
   relativePath = repositoryPath(path, repositoryRoot),
   symbol = method.method ?? "<anonymous>";
  return {
    coverage: { crap, ...(coverage === undefined ? {} : { percent: coverage }), state: coverage === undefined ? "unmapped" : "measured" },
    kind: "function",
    line: method.lineStart,
    metrics: { crap_typescript: { crap: method.crap, cyclomatic: method.cc } },
    path: relativePath,
    symbol,
    unit_id: sourceUnitId({ kind: "function", language: "typescript", path: relativePath, symbol }),
  };
}

/** @param {string} text @returns {CrapReport} */
function parseReport(text) {
  const value = JSON.parse(text);
  if (!isObject(value) || !Array.isArray(value.methods)) {throw new Error("crap-typescript returned an invalid report envelope");}
  return /** @type {CrapReport} */ (value);
}

/** @param {CrapReport} report @param {string} repositoryRoot @returns {CrapNormalizedReport} */
function normalizeReport(report, repositoryRoot) {
  const methods = report.methods ?? [],
   units = methods.map((method) => normalizeMethod(method.src ?? "", repositoryRoot, method));
  return {
    analyzer: "crap-typescript",
    methods,
    units,
    violations: units.filter((unit) => typeof unit.coverage.crap === "number" && unit.coverage.crap > 8),
  };
}

/** @param {string} repositoryRoot @param {Readonly<CrapAnalyzer>} analyzer @param {readonly string[]} paths @returns {Promise<CrapNormalizedReport>} */
/** @param {string} repositoryRoot @param {Readonly<CrapAnalyzer>} analyzer @param {readonly string[]} paths @param {number} threshold @returns {Promise<CrapNormalizedReport>} */
async function runCrap(repositoryRoot, analyzer, paths, threshold = 8) {
  const frontendPaths = paths.map((path) => path.replace(/^frontend\//u, "")),
   [executable, ...baseArguments] = analyzer.command,
   result = await new Promise((resolvePromise, rejectPromise) => {
    execFile(executable, [...baseArguments, ...frontendPaths, "--threshold", String(threshold), "--package-manager", "npm", "--test-runner", "jest", "--format", "json", "--failures-only=false"], {
      cwd: `${repositoryRoot}/${analyzer.working_directory}`,
      encoding: "utf8",
      maxBuffer: analyzer.output_limit_bytes,
      timeout: 300_000,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        rejectPromise(error);
        return;
      }
      resolvePromise({ code: typeof error?.code === "number" ? error.code : SUCCESS_EXIT, stderr: String(stderr), stdout: String(stdout) });
    });
  });
  if (![SUCCESS_EXIT, FINDINGS_EXIT, REPORT_EXIT].includes(result.code)) {throw new Error(`crap-typescript failed with exit ${result.code}: ${result.stderr.slice(0, 400)}`);}
  return normalizeReport(parseReport(result.stdout), repositoryRoot);
}

export { normalizeReport, parseReport, repositoryPath, runCrap };
