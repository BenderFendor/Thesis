// Maintainability index gate for the Thesis repo.
// Uses code-multivitals to measure per-function MI (0-100); fails when
// functions fall below the configured MI thresholds.
//
// Usage: node scripts/check-maintainability.mjs [--json] [--strict] [<file|dir> ...]
//   Defaults to analysing frontend/** (ts, tsx). Directories are globbed.
// Thresholds (env overrides):
//   THESIS_MI_CAP=50  functions below this MI fail the gate
//   THESIS_MI_ERROR=60 functions in [cap, error) are reported as warns
// cccc.toml remains the complexity policy; this is the MI/health gate.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { analyse } from "code-multivitals";

const args = process.argv.slice(2);
const json = args.includes("--json");
const strict = args.includes("--strict");
const patterns = args.filter((a) => !a.startsWith("--"));

const miCap = Number(process.env.THESIS_MI_CAP ?? 50);
const miError = Number(process.env.THESIS_MI_ERROR ?? 60);

const EXCLUDED = new Set(["node_modules", ".next", "coverage", "generated", "target", ".venv", "__pycache__"]);

function collectFiles(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
  }
}

function expand(pattern) {
  const p = resolve(pattern);
  if (statSync(p).isFile()) return [p];
  const files = [];
  collectFiles(p, files);
  return files;
}

let files = [];
for (const pattern of patterns.length > 0 ? patterns : ["frontend"]) {
  files = files.concat(expand(pattern))
}
files = [...new Set(files)];

const result = analyse(files, {});
const rows = [];
for (const file of result.files) {
  for (const fn of file.functions ?? []) {
    const metrics = Object.fromEntries((fn.metrics ?? []).map((m) => [m.name, m.value]));
    const miScore = fn.mi ?? fn.maintainabilityIndex;
    if (miScore === undefined || miScore === null) continue;
    rows.push({
      file: file.filePath,
      line: fn.startLine,
      name: fn.name,
      cc: metrics.cyclomaticComplexity ?? 0,
      mi: typeof miScore === "number" ? miScore : miScore.score,
    });
  }
}
rows.sort((a, b) => a.mi - b.mi);

const fails = rows.filter((r) => r.mi < miCap);
const warns = rows.filter((r) => r.mi >= miCap && r.mi < miError);

if (json) {
  console.log(JSON.stringify({ capAt: miCap, errorAt: miError, fails, warns, total: rows.length }));
}

console.log(`Maintainability check: ${rows.length} functions, ${fails.length} fails (MI < ${miCap}), ${warns.length} warns (MI < ${miError})`);
for (const r of fails.slice(0, 40)) console.log(`  FAIL ${r.file}:${r.line} ${r.name} MI=${r.mi} CC=${r.cc}`);
if (fails.length > 40) console.log(`  ... ${fails.length - 40} more fails`);

if (strict) process.exit(fails.length > 0 ? 1 : 0);
process.exit(0);
