// @ts-check

import { analyse } from "code-multivitals";
import { sourceUnitId } from "../source-units.mjs";

/** @typedef {Readonly<{functions?: readonly FunctionRecord[], filePath: string}>} FileRecord */
/** @typedef {Readonly<{maintainabilityIndex?: number, name?: string, startLine?: number}>} FunctionRecord */
/** @typedef {Readonly<{analyzer: string, units: readonly Record<string, unknown>[], warnings: readonly string[]}>} MultivitalsReport */

/** @param {string} path @param {string} repositoryRoot */
function normalizePath(path, repositoryRoot) {
  const normalized = path.replaceAll("\\", "/"),
   prefix = `${repositoryRoot.replaceAll("\\", "/")}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

/** @param {string} repositoryRoot @param {readonly string[]} paths @returns {MultivitalsReport} */
function runCodeMultivitals(repositoryRoot, paths) {
  if (paths.length === 0) {return { analyzer: "code-multivitals", units: [], warnings: [] };}
  const result = analyse(paths.map((path) => `${repositoryRoot}/${path}`), {}),
  /** @type {Record<string, unknown>[]} */
   units = [];
  for (const file of /** @type {readonly FileRecord[]} */ (result.files ?? [])) {
    const path = normalizePath(file.filePath, repositoryRoot);
    for (const fn of file.functions ?? []) {
      if (typeof fn.maintainabilityIndex !== "number") {continue;}
      const symbol = fn.name ?? "<anonymous>";
      units.push({
        coverage: { crap: null, state: "unknown" },
        kind: "function",
        line: fn.startLine,
        metrics: { code_multivitals: { maintainability_index: fn.maintainabilityIndex } },
        path,
        symbol,
        unit_id: sourceUnitId({ kind: "function", language: "ecmascript", path, symbol }),
      });
    }
  }
  return { analyzer: "code-multivitals", units, warnings: [] };
}

export { normalizePath, runCodeMultivitals };
