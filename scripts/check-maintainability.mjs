import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { analyse } from "code-multivitals";
import { collectOwnedFrontendFiles } from "./quality-source-files.mjs";

const excludedDirectories = new Set(["node_modules", ".next", "coverage", "generated", "target", ".venv", "__pycache__"]),
  argumentsList = process.argv.slice(2),
  json = argumentsList.includes("--json"),
  strict = argumentsList.includes("--strict"),
  minimum = Number(process.env.THESIS_MI_CAP ?? 50),
  warningMinimum = Number(process.env.THESIS_MI_ERROR ?? 60),
  paths = argumentsList.filter((argument) => !argument.startsWith("--"));

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true }),
    groups = await Promise.all(entries.map(async (entry) => {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) { return []; }
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { return collectFiles(path); }
      return /\.(?:ts|tsx|js|jsx)$/u.test(entry.name) ? [path] : [];
    }));
  return groups.flat();
};

const expandPath = async (path) => {
  const absolute = resolve(path),
    information = await stat(absolute);
  return information.isFile() ? [absolute] : collectFiles(absolute);
};

const metricRows = (files) => {
  const rows = [];
  for (const file of analyse(files, {}).files) {
    for (const item of file.functions ?? []) {
      const score = item.mi ?? item.maintainabilityIndex;
      if (score === undefined || score === null) { continue; }
      const metrics = Object.fromEntries((item.metrics ?? []).map((metric) => [metric.name, metric.value]));
      rows.push({
        cc: metrics.cyclomaticComplexity ?? 0,
        file: file.filePath,
        line: item.startLine,
        mi: Number.isFinite(score) ? Number(score) : score.score,
        name: item.name,
      });
    }
  }
  return rows.toSorted((left, right) => left.mi - right.mi);
};

const main = async () => {
  const files = paths.length === 0
    ? collectOwnedFrontendFiles(process.cwd())
    : [...new Set((await Promise.all(paths.map(expandPath))).flat())];
  if (files.length === 0) { throw new Error("Maintainability check found no source files."); }
  const rows = metricRows(files),
    failures = rows.filter((row) => row.mi < minimum),
    warnings = rows.filter((row) => row.mi >= minimum && row.mi < warningMinimum);
  if (json) {
    console.log(JSON.stringify({ capAt: minimum, errorAt: warningMinimum, fails: failures, total: rows.length, warns: warnings }));
  }
  console.log(`Maintainability check: ${rows.length} functions, ${failures.length} fails (MI < ${minimum}), ${warnings.length} warns (MI < ${warningMinimum})`);
  for (const row of failures.slice(0, 40)) {
    console.log(`  FAIL ${row.file}:${row.line} ${row.name} MI=${row.mi} CC=${row.cc}`);
  }
  if (failures.length > 40) { console.log(`  ... ${failures.length - 40} more fails`); }
  return strict && failures.length > 0 ? 1 : 0;
};

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
