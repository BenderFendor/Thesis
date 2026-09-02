// @ts-check

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { EXIT_CODES } from "./protocol.mjs";

const execFileAsync = promisify(execFile);

/** @typedef {Readonly<{command: readonly string[], label: string, output_limit_bytes: number, timeout_ms: number}>} Check */
/** @typedef {Readonly<{profiles: Readonly<Record<string, readonly string[]>>, verification: Readonly<{checks: Readonly<Record<string, Readonly<{command: readonly string[], label: string}>>>, defaults: Readonly<{output_limit_bytes: number, timeout_ms: number}>}>}>} VerificationPolicy */

/** @param {string} repositoryRoot @returns {Promise<string>} */
async function trackedStatus(repositoryRoot) {
  const result = await execFileAsync("git", ["status", "--porcelain=v1"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 2_000_000,
  });
  return result.stdout;
}

/** @param {Check} check @param {string} repositoryRoot @returns {Promise<Record<string, unknown>>} */
async function runCheck(check, repositoryRoot) {
  const [executable, ...argumentsList] = check.command,
   started = Date.now();
  try {
    const result = await execFileAsync(executable, argumentsList, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: check.output_limit_bytes,
      timeout: check.timeout_ms,
    });
    return { duration_ms: Date.now() - started, label: check.label, output: result.stdout.slice(-4000), status: "passed" };
  } catch (error) {
    const result = error && typeof error === "object"
      ? /** @type {Record<string, unknown>} */ (error)
      : {};
    return {
      duration_ms: Date.now() - started,
      exit_code: typeof result.code === "number" ? result.code : null,
      label: check.label,
      output: `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`.trim().slice(-4000),
      status: "failed",
    };
  }
}

/** @param {"path"|"task"|"changed"|"repo"} scope @param {VerificationPolicy} config @returns {Check[]} */
const checksForScope = (scope, config) => config.profiles[scope].map((id) => {
  const definition = config.verification.checks[id];
  return {
    command: definition.command,
    label: definition.label,
    output_limit_bytes: config.verification.defaults.output_limit_bytes,
    timeout_ms: config.verification.defaults.timeout_ms,
  };
});

/** @param {{config: VerificationPolicy, repositoryRoot: string, scope: "path"|"task"|"changed"|"repo", measure: () => Promise<Record<string, unknown>>}} options @returns {Promise<Record<string, unknown>>} */
async function verify({ config, repositoryRoot, scope, measure }) {
  const trackedBefore = await trackedStatus(repositoryRoot);
  let measurement;
  try {
    const record = await measure(),
     verification = Array.isArray(record.verification) ? record.verification : [],
     failed = verification.some((item) => item.status !== "passed" && item.status !== "not_selected");
    measurement = { ...record, status: failed ? "failed" : "passed" };
  } catch (error) {
    measurement = { message: error instanceof Error ? error.message : String(error), status: "analyzer_error" };
  }
  const checks = [];
  for (const check of checksForScope(scope, config)) {checks.push(await runCheck(check, repositoryRoot));}
  const trackedAfter = await trackedStatus(repositoryRoot),
   checksPassed = checks.every((check) => check.status === "passed"),
   worktreeClean = trackedBefore === trackedAfter;
  return {
    checks,
    exit_code: checksPassed && measurement.status === "passed" && worktreeClean ? EXIT_CODES.ok : EXIT_CODES.quality,
    measurement,
    scope,
    tracked_unchanged: worktreeClean,
  };
}

export { checksForScope, execFileAsync, runCheck, trackedStatus, verify };
