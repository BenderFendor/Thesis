// @ts-check

import { analyse } from "code-multivitals";
import { sourceUnitId } from "../source-units.mjs";

/** @typedef {Readonly<{coverage: Readonly<{crap: null, state: "unknown"}>, kind: "function", line: number, metrics: Readonly<{code_multivitals: Readonly<{maintainability_index: number}>}>, path: string, symbol: string, unit_id: string}>} MultivitalsUnit */
/** @typedef {Readonly<{analyzer: string, units: readonly MultivitalsUnit[], warnings: readonly string[]}>} MultivitalsReport */

/** @param {string} path @param {string} repositoryRoot */
const normalizePath = (path, repositoryRoot) => {
  const normalized = path.replaceAll("\\", "/"),
   prefix = `${repositoryRoot.replaceAll("\\", "/")}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

/** @param {string} repositoryRoot @param {readonly string[]} paths @returns {MultivitalsReport} */
const runCodeMultivitals = (repositoryRoot, paths) => {
  if (paths.length === 0) {return { analyzer: "code-multivitals", units: [], warnings: [] };}
  const result = analyse(paths.map((path) => `${repositoryRoot}/${path}`), {}),
  /** @type {MultivitalsUnit[]} */
   units = [];
  for (const file of result.files ?? []) {
    const path = normalizePath(file.filePath, repositoryRoot);
    for (const fn of file.functions ?? []) {
      if (!Number.isFinite(fn.maintainabilityIndex)) {continue;}
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
