// @ts-check

import { EXIT_CODES } from "./protocol.mjs";
import { execFile } from "node:child_process";

import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** @param {string | Uint8Array | Error | number | boolean | null | undefined} value @returns {string} */
const outputText = (value) => {
  if (value === null || value === undefined) {return "";}
  if (value instanceof Uint8Array) {return new TextDecoder().decode(value);}
  if (value instanceof Error) {return value.message;}
  if (value?.constructor === String) {return value;}
  const serialized = JSON.stringify(value);
  return serialized ?? "";
};

/** @typedef {Readonly<{command: readonly string[], label: string, output_limit_bytes: number, timeout_ms: number}>} Check */
/** @typedef {Readonly<{duration_ms: number, exit_code?: number|null, label: string, output: string, status: "passed"|"failed"}>} CheckResult */
/** @typedef {Readonly<{profiles: Readonly<Record<string, readonly string[]>>, verification: Readonly<{checks: Readonly<Record<string, Readonly<{command: readonly string[], label: string}>>>, defaults: Readonly<{output_limit_bytes: number, timeout_ms: number}>}>}>} VerificationPolicy */
/** @typedef {Readonly<{checks: readonly CheckResult[], exit_code: number, measurement: Record<string, unknown>, scope: "path"|"task"|"changed"|"repo", tracked_unchanged: boolean}>} VerifyResult */

/** @param {string} repositoryRoot @returns {Promise<string>} */
const trackedStatus = async (repositoryRoot) => {
  const result = await execFileAsync("git", ["status", "--porcelain=v1"], {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 2_000_000,
  });
  return result.stdout;
}

/** @param {Check} check @param {string} repositoryRoot @returns {Promise<CheckResult>} */
const runCheck = async (check, repositoryRoot) => {
  const [executable, ...argumentsList] = check.command,
   started = Date.now(),
   result = await new Promise((resolveResult) => {
    execFile(executable, argumentsList, {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: check.output_limit_bytes,
      timeout: check.timeout_ms,
    }, (error, stdout, stderr) => {
      const numericCode = Number(error?.code);
      resolveResult({
        code: Number.isInteger(numericCode) ? numericCode : null,
        error,
        stderr,
        stdout,
      });
    });
   });
  if (result.error === null) {
    return { duration_ms: Date.now() - started, label: check.label, output: result.stdout.slice(-4000), status: "passed" };
  }
  return {
    duration_ms: Date.now() - started,
    exit_code: result.code,
    label: check.label,
    output: `${outputText(result.stdout)}
${outputText(result.stderr)}`.trim().slice(-4000),
    status: "failed",
  };
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

/** @param {{config: VerificationPolicy, repositoryRoot: string, scope: "path"|"task"|"changed"|"repo", measure: () => Promise<Record<string, unknown>>}} options @returns {Promise<VerifyResult>} */
const verify = async ({ config, repositoryRoot, scope, measure }) => {
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
