// @ts-check

import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

const ACTIVE_TASK_FILE = ".quality-hardening/active-task.json",
 CLAIM_FILE = ".quality-hardening/locks/writer.json";

/** @param {string} repositoryRoot */
function claimPath(repositoryRoot) {
  return resolve(repositoryRoot, CLAIM_FILE);
}

/** @param {string} repositoryRoot */
function activeTaskPath(repositoryRoot) {
  return resolve(repositoryRoot, ACTIVE_TASK_FILE);
}

/** @param {string} repositoryRoot @param {readonly string[]} paths */
function normalizePaths(repositoryRoot, paths) {
  return [...new Set(paths.map((path) => {
    const resolvedPath = resolve(repositoryRoot, path),
     relativePath = relative(resolve(repositoryRoot), resolvedPath);
    if (!relativePath || relativePath === ".." || relativePath.startsWith("../")) {
      throw new Error(`claim path is outside the repository: ${path}`);
    }
    return relativePath.split("\\").join("/");
  }))].sort((left, right) => left.localeCompare(right));
}

/** @param {string} repositoryRoot @param {{sessionId: string, taskId: string, paths: readonly string[]}} claim */
async function claimWriter(repositoryRoot, claim) {
  const path = claimPath(repositoryRoot);
  await mkdir(resolve(repositoryRoot, ".quality-hardening/locks"), { recursive: true });
  const payload = {
    claimed_at: new Date().toISOString(),
    paths: normalizePaths(repositoryRoot, claim.paths),
    session_id: claim.sessionId,
    task_id: claim.taskId,
  };
  try {
    const handle = await open(path, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(payload, undefined, 2)}\n`, "utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
      throw new Error(`writer claim already exists at ${path}`, { cause: error });
    }
    throw error;
  }
  return payload;
}

/** @param {string} repositoryRoot @returns {Promise<Record<string, unknown> | null>} */
async function readWriterClaim(repositoryRoot) {
  try {
    return JSON.parse(await readFile(claimPath(repositoryRoot), "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {return null;}
    throw error;
  }
}

/** @param {string} repositoryRoot @param {Readonly<Record<string, unknown>>} task */
async function writeActiveTask(repositoryRoot, task) {
  const path = activeTaskPath(repositoryRoot),
   temporary = `${path}.tmp-${process.pid}`;
  await mkdir(resolve(repositoryRoot, ".quality-hardening"), { recursive: true });
  await writeFile(temporary, `${JSON.stringify(task, undefined, 2)}\n`, "utf8");
  await rename(temporary, path);
}

/** @param {string} repositoryRoot @param {string} sessionId @param {string} taskId @param {string} path @returns {Promise<Record<string, unknown>>} */
async function expandWriterClaim(repositoryRoot, sessionId, taskId, path) {
  const claim = await readWriterClaim(repositoryRoot);
  if (!claim) {throw new Error("writer claim is required for scope expansion");}
  if (claim.session_id !== sessionId || claim.task_id !== taskId) {throw new Error("writer claim belongs to another task or session");}
  const claimFile = claimPath(repositoryRoot),
   expanded = { ...claim, paths: normalizePaths(repositoryRoot, [...(Array.isArray(claim.paths) ? claim.paths : []), path]) },
   temporary = `${claimFile}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, `${JSON.stringify(expanded, undefined, 2)}\n`, "utf8");
    await rename(temporary, claimFile);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
  return expanded;
}

/** @param {string} repositoryRoot @param {string} sessionId @param {string} taskId */
async function clearActiveTask(repositoryRoot, sessionId, taskId) {
  try {
    const task = JSON.parse(await readFile(activeTaskPath(repositoryRoot), "utf8"));
    if (task.session_id !== sessionId || task.task_id !== taskId) {return false;}
    await unlink(activeTaskPath(repositoryRoot));
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {return false;}
    throw error;
  }
}

/** @param {string} repositoryRoot @param {string} sessionId @param {boolean} allowStale */
async function releaseWriter(repositoryRoot, sessionId, allowStale = false) {
  const claim = await readWriterClaim(repositoryRoot);
  if (!claim) {return false;}
  if (!allowStale && claim.session_id !== sessionId) {
    throw new Error("writer claim belongs to another session");
  }
  await unlink(claimPath(repositoryRoot));
  return true;
}

export { activeTaskPath, claimWriter, claimPath, clearActiveTask, expandWriterClaim, normalizePaths, readWriterClaim, releaseWriter, writeActiveTask };
