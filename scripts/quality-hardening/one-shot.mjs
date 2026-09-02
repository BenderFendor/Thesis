// @ts-check
/**
 * One-shot per-file quality plan: gathers EVERY gate signal for one file
 * (oxlint by rule + per-function CI metrics + nearest tests) into a single
 * JSON artifact, so a repair can close all of them in one cohesive pass.
 *
 * Usage:
 *   node scripts/quality-hardening/one-shot.mjs <file> [--json]
 *   (exit 0 = gates clean; 1 = findings remain; 2 = usage/config error)
 *
 * The plan is evidence, not a rewrite: structural repair first (it removes
 * the correlated lint symptoms), then per-rule mechanical, then tests.
 * Every gate must be 0/clean before the file is done.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PARSE_ERRORS = new Set([
 "parser/parse-error",
 "not-jsdoc",
 "jsdoc/require-param",
]);

/**
 * @param {string} command
 * @param {string[]} args
 * @returns {{ code: number, stdout: string }}
 */
const REPO_TOOL_ENV = {
 ...process.env,
 PATH: `${join(ROOT, "frontend", "node_modules", ".bin")}:${process.env.PATH ?? ""}`,
};

function runSync(command, args) {
 try {
  return {
   code: 0,
   stdout: execFileSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    env: REPO_TOOL_ENV,
    maxBuffer: 8_000_000,
    timeout: 180_000,
   }),
  };
 } catch (error) {
  /** @type {Record<string, unknown>} */
  const record = /** @type {Record<string, unknown>} */ (error);
  return {
   code: typeof record.code === "number" ? /** @type {number} */ (record.code) : 1,
   stdout: `${String(record.stdout ?? "")}\n${String(record.stderr ?? "")}`,
  };
 }
}

/** @param {string} output @returns {{ byRule: Record<string, number>, total: number, parseErrors: number }} */
function oxlintStats(output) {
 const byRule = {};
 let total = 0;
 let parseErrors = 0;
 for (const line of output.split("\n")) {
  const marker = line.split("[Error/")[1] ?? line.split("[Warning/")[1];
  if (!marker) { continue; }
  const rule = marker.split("]")[0];
  byRule[rule] = (byRule[rule] ?? 0) + 1;
  total += 1;
  if (PARSE_ERRORS.has(rule)) { parseErrors += 1; }
 }
 return { byRule, parseErrors, total };
}

/** @param {string} file @returns {string | null} */
function nearestTestFile(file) {
 const base = file.replace(/\.tsx?$/u, "");
 const candidates = [
  join(ROOT, "frontend", "__tests__", `${base.split("/").pop()}.test.ts`),
  join(ROOT, "frontend", "__tests__", `${base.split("/").pop()}.test.tsx`),
  join(ROOT, "frontend", "__tests__", `${base.split("/").pop()}.spec.tsx`),
 ];
 for (const candidate of candidates) {
  if (existsSync(candidate)) { return candidate; }
 }
 return null;
}

/** @param {string} file @returns {Promise<Record<string, unknown>>} */
export async function oneShotPlan(file) {
 const oxlint = runSync(
  join(ROOT, "frontend", "node_modules", ".bin", "oxlint"),
  ["-c", ".oxlintrc.json", "--format", "unix", file],
 );
 const metric = runSync(
  process.platform === "win32" ? "python" : "python3",
  ["/home/bender/.codex/hooks/quality_metrics.py", "pre", "--file", file, "--cwd", ROOT],
 );
 const bytes = (await import("node:fs/promises")).readFile(join(ROOT, file));
 const lines = (await bytes).toString().split("\n").length;
 return {
  file,
  lines,
  oxlint: oxlintStats(oxlint.stdout),
  metrics: extractMetricSummary(metric.stdout),
  test: nearestTestFile(file),
  clean:
   oxlintStats(oxlint.stdout).total === 0 &&
   extractMetricSummary(metric.stdout).minMi >= 50,
 };
}

/** @param {string} text @returns {{ cc: number, cognitive: number, minMi: number, worst: string }} */
function extractMetricSummary(text) {
 let cc = -1;
 let cognitive = -1;
 let minMi = -1;
 let worst = "";
 const head = text.match(/CC ([0-9]+) cog ([0-9]+)/u);
 if (head) {
  cc = Number(head[1]);
  cognitive = Number(head[2]);
 }
 const mi = text.match(/MI ([0-9]+)/u);
 if (mi) { minMi = Number(mi[1]); }
 const worstLine = text.match(/@L?([0-9]+) MI ([0-9.]+)</u);
 if (worstLine) { worst = `L${worstLine[1]} MI ${worstLine[2]}`; }
 return { cc, cognitive, minMi, worst };
}

/** @param {string[]} args @returns {Promise<number>} */
export async function main(args) {
 const file = args.find((arg) => !arg.startsWith("--"));
 if (!file || !existsSync(join(ROOT, file))) {
  console.error("usage: node scripts/quality-hardening/one-shot.mjs <file> [--json]");
  return 2;
 }
 const plan = await oneShotPlan(file);
 const json = args.includes("--json");
 if (json) {
  console.log(JSON.stringify(plan, undefined, 2));
 } else {
  console.error(
   `${file}: oxlint ${plan.oxlint.total} (${Object.entries(plan.oxlint.byRule).slice(0, 6).map(([rule, count]) => `${rule}:${count}`).join(", ")}${Object.entries(plan.oxlint.byRule).length > 6 ? ", ..." : ""}) | CC ${plan.metrics.cc} cog ${plan.metrics.cognitive} MI min ${plan.metrics.minMi}`,
  );
  if (plan.test) { console.error(`test: ${plan.test}`); }
 }
 return plan.clean ? 0 : 1;
}

if (process.argv[1] && process.argv[1].includes("one-shot.mjs")) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(String(error));
    process.exitCode = 2;
  });
}
