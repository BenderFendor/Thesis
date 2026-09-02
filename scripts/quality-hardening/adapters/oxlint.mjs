// @ts-check

import { delimiter, resolve } from "node:path";
import { execFile } from "node:child_process";

/** @typedef {Readonly<{code?: string, level?: string, line?: number, message: string, path: string, rule: string}>} OxlintFinding */
/** @typedef {Readonly<{command: readonly string[], output_limit_bytes: number, version: string}>} OxlintAnalyzer */
/** @typedef {Readonly<{analyzer: string, findings: readonly OxlintFinding[], by_rule: Readonly<Record<string, Readonly<{errors: number, warnings: number}>>>, errors: number, warnings: number}>} OxlintReport */

const FINDINGS_EXIT = 1,
  SUCCESS_EXIT = 0;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {string} fallback */
function stringValue(value, fallback) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** @param {unknown} value @returns {"warning"|"error"} */
function severityFor(value) {
  const severity = stringValue(value, "error").toLowerCase();
  return severity.startsWith("warn") ? "warning" : "error";
}

/** @param {unknown} value @param {string} repositoryRoot */
function parseFinding(value, repositoryRoot) {
  if (!isObject(value)) {
    return;
  }
  const labels = Array.isArray(value.labels) ? value.labels : [],
   firstLabel = isObject(labels[0]) ? labels[0] : {},
   span = isObject(firstLabel.span) ? firstLabel.span : {},
   path = stringValue(firstLabel.file, stringValue(value.filename, stringValue(value.path, "<unknown>"))),
   normalizedPath = path.startsWith(`${repositoryRoot}/`) ? path.slice(repositoryRoot.length + 1) : path,
   rule = stringValue(value.code, stringValue(value.rule, stringValue(value.ruleId, "unknown"))).replace(/^(?<namespace>[^()]+)\((?<rule>[^()]+)\)$/u, "$<namespace>/$<rule>"),
   severity = severityFor(value.severity);
  return {
    code: typeof value.code === "string" ? value.code : undefined,
    level: severity === "warning" ? "w" : "e",
    line: typeof span.line === "number" ? span.line : undefined,
    message: stringValue(value.message, "Oxlint finding"),
    path: normalizedPath,
    rule,
  };
}

/** @param {string} text @param {string} repositoryRoot */
function parseReport(text, repositoryRoot) {
  const diagnostics = [],
   parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    for (const entry of parsed) {
      if (isObject(entry) && Array.isArray(entry.warnings)) {diagnostics.push(...entry.warnings);}
    }
  } else if (isObject(parsed) && Array.isArray(parsed.diagnostics)) {
    diagnostics.push(...parsed.diagnostics);
  }
  const findings = diagnostics.map((value) => parseFinding(value, repositoryRoot)).filter((value) => value !== undefined),
  /** @type {Record<string, {errors: number, warnings: number}>} */
   byRule = {};
  for (const finding of findings) {
    const counts = byRule[finding.rule] ?? { errors: 0, warnings: 0 };
    counts[finding.level === "w" ? "warnings" : "errors"] += 1;
    byRule[finding.rule] = counts;
  }
  return {
    analyzer: "oxlint",
    by_rule: byRule,
    errors: findings.filter((finding) => finding.level === "e").length,
    findings,
    warnings: findings.filter((finding) => finding.level === "w").length,
  };
}

/** @param {string} executable @param {readonly string[]} argumentsList @param {string} cwd @param {number} maxBuffer @returns {Promise<Readonly<{code: number, stderr: string, stdout: string}>>} */
function runProcess(executable, argumentsList, cwd, maxBuffer) {
  return new Promise((resolvePromise, reject) => {
    const localBin = resolve(cwd, "frontend", "node_modules", ".bin"),
      nodePath = [localBin, process.env.PATH ?? ""].filter(Boolean).join(delimiter),
      processEnvironment = { ...process.env, PATH: nodePath };
    execFile(executable, [...argumentsList], { cwd, encoding: "utf8", env: processEnvironment, maxBuffer }, (error, stdout, stderr) => {
      if (error && typeof error.code !== "number") {
        reject(error);
        return;
      }
      resolvePromise({
        code: typeof error?.code === "number" ? error.code : SUCCESS_EXIT,
        stderr: String(stderr),
        stdout: String(stdout),
      });
    });
  });
}

/** @param {string} repositoryRoot @param {Readonly<OxlintAnalyzer>} analyzer @param {readonly string[]} [paths] @returns {Promise<OxlintReport>} */
async function runOxlint(repositoryRoot, analyzer, paths = []) {
  const [executable, ...baseArguments] = analyzer.command,
   result = await runProcess(executable, [...baseArguments, ...paths], repositoryRoot, analyzer.output_limit_bytes);
  if (result.code !== SUCCESS_EXIT && result.code !== FINDINGS_EXIT) {
    throw new Error(`oxlint failed with exit ${result.code}: ${result.stderr.slice(0, 400)}`);
  }
  return parseReport(result.stdout, repositoryRoot);
}

export { parseReport, runOxlint };
