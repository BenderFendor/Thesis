// @ts-check

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** @param {string} path @returns {Promise<string>} */
const snapshotPath = async (path) => {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink()) { return `symlink:${await readlink(path)}`; }
    if (!info.isFile()) { return info.isDirectory() ? "directory" : `mode:${info.mode}`; }
    return `file:${createHash("sha256").update(await readFile(path)).digest("hex")}`;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") { return "missing"; }
    throw error;
  }
};

/** @param {string} repositoryRoot @returns {Promise<string>} */
const trackedStatus = async (repositoryRoot) => {
  const [status, index] = await Promise.all([
    execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all", "--no-renames", "-z"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16_000_000,
    }),
    execFileAsync("git", ["ls-files", "--stage", "-z"], {
      cwd: repositoryRoot,
      encoding: "utf8",
      maxBuffer: 16_000_000,
    }),
  ]);
  const contents = await Promise.all(status.stdout.split("\0").filter(Boolean).map(async (entry) => {
    const path = entry.slice(3);
    return [path, await snapshotPath(resolve(repositoryRoot, path))];
  }));
  return JSON.stringify({ status: status.stdout, index: index.stdout, contents });
};

export { trackedStatus };
