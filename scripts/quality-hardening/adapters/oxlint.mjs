// @ts-check

import { execFile } from "node:child_process";

const acceptedExitCodes = new Set([0, 1]);

const isRecord = (value) => value !== null && Object(value) === value && !Array.isArray(value);
const isString = (value) => Object.prototype.toString.call(value) === "[object String]";
const stringValue = (value, fallback) => isString(value) && value.length > 0 ? value : fallback;
const severityFor = (value) => stringValue(value, "error").toLowerCase().startsWith("warn") ? "warning" : "error";

const parseFinding = (value, repositoryRoot) => {
  if (!isRecord(value)) { return undefined; }
  const labels = Array.isArray(value.labels) ? value.labels : [],
    firstLabel = isRecord(labels[0]) ? labels[0] : {},
    span = isRecord(firstLabel.span) ? firstLabel.span : {},
    path = stringValue(firstLabel.file, stringValue(value.filename, stringValue(value.path, "<unknown>"))),
    normalizedPath = path.startsWith(`${repositoryRoot}/`) ? path.slice(repositoryRoot.length + 1) : path,
    rule = stringValue(value.code, stringValue(value.rule, stringValue(value.ruleId, "unknown")))
      .replace(/^(?<namespace>[^()]+)\((?<rule>[^()]+)\)$/u, "$<namespace>/$<rule>"),
    severity = severityFor(value.severity);
  return {
    code: isString(value.code) ? value.code : undefined,
    level: severity === "warning" ? "w" : "e",
    line: Number.isFinite(span.line) ? Number(span.line) : undefined,
    message: stringValue(value.message, "Oxlint finding"),
    path: normalizedPath,
    rule,
  };
};

const parseReport = (text, repositoryRoot) => {
  const parsed = JSON.parse(text),
    diagnostics = Array.isArray(parsed)
      ? parsed.flatMap((entry) => isRecord(entry) && Array.isArray(entry.warnings) ? entry.warnings : [])
      : isRecord(parsed) && Array.isArray(parsed.diagnostics) ? parsed.diagnostics : [],
    findings = diagnostics.map((value) => parseFinding(value, repositoryRoot)).filter(Boolean),
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
};

const runProcess = (argumentsList, cwd, maxBuffer) => new Promise((resolveRun, rejectRun) => {
  execFile(process.execPath, argumentsList, { cwd, encoding: "utf8", env: process.env, maxBuffer }, (error, stdout, stderr) => {
    const code = error ? Number(error.code) : 0;
    if (!acceptedExitCodes.has(code)) {
      rejectRun(new Error(`Oxlint runner failed with exit ${code}: ${stderr.slice(0, 400)}`));
      return;
    }
    resolveRun({ code, stderr, stdout });
  });
});

const runOxlint = async (repositoryRoot, analyzer, paths = []) => {
  const result = await runProcess(["scripts/run-oxlint.mjs", "--json", ...paths], repositoryRoot, analyzer.output_limit_bytes);
  return parseReport(result.stdout, repositoryRoot);
};

export { parseReport, runOxlint };
