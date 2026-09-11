import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { collectOwnedFrontendFiles } from "./quality-source-files.mjs";

const repositoryRoot = resolve(import.meta.dirname, ".."),
  frontendRoot = resolve(repositoryRoot, "frontend"),
  executable = resolve(frontendRoot, "node_modules/.bin/crap-typescript"),
  threshold = process.env.THESIS_CRAP_THRESHOLD ?? "30";

const sourceFiles = collectOwnedFrontendFiles(
  repositoryRoot,
  new Set([".ts", ".tsx"]),
).map((path) => path.replace(/^frontend\//u, ""));

const run = (command, argumentsList, options) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(command, argumentsList, options),
    stdout = [],
    stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  child.on("error", rejectRun);
  child.on("close", (code) => resolveRun({
    code: code ?? 1,
    stderr: Buffer.concat(stderr).toString("utf8"),
    stdout: Buffer.concat(stdout).toString("utf8"),
  }));
});

const parseReport = (text) => {
  try {
    const report = JSON.parse(text);
    if (!Array.isArray(report?.methods) || report.methods.length === 0) {
      throw new Error("CRAP check produced no method measurements for owned frontend source.");
    }
    return report;
  } catch (error) {
    throw new Error(`CRAP check returned an unreadable JSON report: ${String(error)}`, { cause: error });
  }
};

const main = async () => {
  if (sourceFiles.length === 0) {
    throw new Error("CRAP check found no owned frontend source files.");
  }
  const result = await run(executable, [
    ...sourceFiles,
    "--threshold", threshold,
    "--package-manager", "npm",
    "--test-runner", "jest",
    "--format", "json",
    "--failures-only=false",
  ], {
    cwd: frontendRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.stderr) { process.stderr.write(result.stderr); }
  if (result.stdout) { process.stdout.write(result.stdout); }
  if (![0, 2].includes(result.code)) { return result.code; }
  return parseReport(result.stdout).status === "failed" ? 1 : 0;
};

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
