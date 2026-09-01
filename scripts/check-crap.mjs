import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectOwnedFrontendFiles } from "./quality-source-files.mjs";

const scriptDirectory = import.meta.dirname,
 repositoryRoot = resolve(scriptDirectory, ".."),
 frontendRoot = resolve(repositoryRoot, "frontend"),
 sourceFiles = collectOwnedFrontendFiles(
  repositoryRoot,
  new Set([".ts", ".tsx"]),
).map((path) => path.replace(/^frontend\//u, ""));

if (sourceFiles.length === 0) {
  console.error("CRAP check found no owned frontend source files.");
  process.exit(1);
}

const threshold = process.env.THESIS_CRAP_THRESHOLD ?? "30",
 executable = resolve(frontendRoot, "node_modules/.bin/crap-typescript"),
 result = spawnSync(
  executable,
  [
    ...sourceFiles,
    "--threshold",
    threshold,
    "--package-manager",
    "npm",
    "--test-runner",
    "jest",
    "--format",
    "json",
    "--failures-only=false",
  ],
  {
    cwd: frontendRoot,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 50 * 1024 * 1024,
  },
);

if (result.stderr.length > 0) {
  process.stderr.write(result.stderr);
}
if (result.stdout.length > 0) {
  process.stdout.write(result.stdout);
}

if (result.status === null) {
  console.error(`CRAP check could not start: ${result.error?.message ?? "unknown error"}`);
  process.exit(1);
}

let report;
if (result.status === 0 || result.status === 2) {
  try {
    report = JSON.parse(result.stdout);
    if (!Array.isArray(report.methods) || report.methods.length === 0) {
      console.error("CRAP check produced no method measurements for owned frontend source.");
      process.exit(1);
    }
  } catch (error) {
    console.error(`CRAP check returned an unreadable JSON report: ${String(error)}`);
    process.exit(1);
  }
}

if (report?.status === "failed") {
  process.exit(1);
}

process.exit(result.status);
