// @ts-check

import { extname, relative, resolve, sep } from "node:path";
import { readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileAsync } from "./verify.mjs";

/** @typedef {readonly [excludedDirectories: readonly string[], excludeTestFiles: boolean, extensions: readonly string[]]} SourceScope */
/** @typedef {Readonly<{source_scope: Readonly<{exclude_directories: readonly string[], exclude_test_files: boolean, extensions: readonly string[], roots: readonly string[]}>}>} Policy */
/** @typedef {Readonly<{asRepositoryPath: (path: string) => string, collectChangedSourceFiles: (repositoryRoot: string, policy: Readonly<Policy>) => Promise<string[]>, collectFile: (path: string, root: string, scope: SourceScope) => string[], collectPath: (path: string, root: string, scope: SourceScope) => Promise<string[]>, collectSourceFiles: (repositoryRoot: string, policy: Readonly<Policy>, paths?: readonly string[]) => Promise<string[]>, createScope: (policy: Readonly<Policy>) => SourceScope, gitChangedPaths: (repositoryRoot: string) => Promise<string[]>, isExcluded: (path: string, excludedDirectories: readonly string[]) => boolean, isInsideRoot: (root: string, path: string) => boolean, runGit: (repositoryRoot: string, argumentsList: readonly string[]) => Promise<string>, selectedRoots: (paths: readonly string[], policy: Readonly<Policy>) => readonly string[], selectChangedSourcePaths: (paths: readonly string[], policy: Readonly<Policy>) => string[], shouldIncludeFile: (path: string, scope: SourceScope) => boolean, sortUniquePaths: (groups: readonly (readonly string[])[]) => string[], sourceUnitId: (input: Readonly<Readonly<{kind: string, language: string, path: string, symbol: string}>>) => string, visitEntry: (entry: Readonly<import("node:fs").Dirent>, directory: string, root: string, scope: SourceScope) => Promise<string[]>, visitEntries: (entries: readonly Readonly<import("node:fs").Dirent>[], directory: string, root: string, scope: SourceScope) => Promise<string[]>, walk: (directory: string, root: string, scope: SourceScope) => Promise<string[]>}>} SourceHelpers */

const EMPTY_COUNT = 0,
  EMPTY_PATH = "",
  EXCLUDED_DIRECTORIES_INDEX = 0,
  GIT_PATH_SEPARATOR = "\0",
  HASH_START = 0,
  PARENT_PATH = "..",
  TEST_FILE_PATTERN = /(?:^|\.)(?:spec|test)\.[cm]?[jt]sx?$/u,
  UNIT_ID_LENGTH = 24,
  /** @type {SourceHelpers} */
  sourceHelpers = {
    asRepositoryPath: (path) => path.split(sep).join("/"),
    collectChangedSourceFiles: async (repositoryRoot, policy) => {
      const changedPaths = sourceHelpers.selectChangedSourcePaths(await sourceHelpers.gitChangedPaths(repositoryRoot), policy);
      return sourceHelpers.collectSourceFiles(repositoryRoot, policy, changedPaths);
    },
    collectFile: (path, root, scope) => {
      if (!sourceHelpers.shouldIncludeFile(path, scope)) {
        return [];
      }
      return [sourceHelpers.asRepositoryPath(relative(root, path))];
    },
    collectPath: async (path, root, scope) => {
      if (!sourceHelpers.isInsideRoot(root, path)) {
        throw new Error(`source path is outside the repository: ${path}`);
      }
      const information = await stat(path);
      if (information.isDirectory()) {
        return sourceHelpers.walk(path, root, scope);
      }
      return sourceHelpers.collectFile(path, root, scope);
    },
    collectSourceFiles: (repositoryRoot, policy, paths = []) => {
      const root = resolve(repositoryRoot),
        roots = sourceHelpers.selectedRoots(paths, policy),
        scope = sourceHelpers.createScope(policy);
      return Promise.all(roots.map((path) => sourceHelpers.collectPath(resolve(root, path), root, scope))).then(sourceHelpers.sortUniquePaths);
    },
    createScope: (policy) => [
      policy.source_scope.exclude_directories,
      policy.source_scope.exclude_test_files,
      policy.source_scope.extensions,
    ],
    gitChangedPaths: async (repositoryRoot) => {
      const outputs = await Promise.all([
        sourceHelpers.runGit(repositoryRoot, ["diff", "--name-only", "-z", "--diff-filter=ACMR", "HEAD"]),
        sourceHelpers.runGit(repositoryRoot, ["ls-files", "--others", "--exclude-standard", "-z"]),
      ]);
      return outputs.flatMap((output) => output.split(GIT_PATH_SEPARATOR)).filter(Boolean);
    },
    isExcluded: (path, excludedDirectories) => path.split(sep).some((part) => excludedDirectories.includes(part)),
    isInsideRoot: (root, path) => {
      const relativePath = relative(root, path);
      return relativePath !== EMPTY_PATH && !relativePath.startsWith(`${PARENT_PATH}${sep}`) && relativePath !== PARENT_PATH;
    },
    runGit: async (repositoryRoot, argumentsList) => {
      const result = await execFileAsync("git", argumentsList, { cwd: repositoryRoot, encoding: "utf8" });
      return result.stdout;
    },
    selectChangedSourcePaths: (paths, policy) => {
      const roots = policy.source_scope.roots.map((root) => `${root}/`),
        scope = sourceHelpers.createScope(policy);
      return paths.filter((path) => roots.some((root) => path.startsWith(root)) && sourceHelpers.shouldIncludeFile(path, scope));
    },
    selectedRoots: (paths, policy) => {
      if (paths.length > EMPTY_COUNT) {
        return paths;
      }
      return policy.source_scope.roots;
    },
    shouldIncludeFile: (path, scope) => {
      const [excludedDirectories, excludeTestFiles, extensions] = scope;
      return extensions.includes(extname(path)) && !sourceHelpers.isExcluded(path, excludedDirectories) && (!excludeTestFiles || !TEST_FILE_PATTERN.test(path));
    },
    sortUniquePaths: (groups) => [...new Set(groups.flat())].toSorted((left, right) => left.localeCompare(right)),
    sourceUnitId: (input) => {
      const { kind, language, path, symbol } = input,
        identity = [language, path, kind, symbol].join("\0");
      return `qh-unit:${createHash("sha256").update(identity).digest("hex").slice(HASH_START, UNIT_ID_LENGTH)}`;
    },
    visitEntries: async (entries, directory, root, scope) => {
      const pending = [];
      for (const entry of entries) {
        pending.push(sourceHelpers.visitEntry(entry, directory, root, scope));
      }
      {
        const groups = await Promise.all(pending);
        return groups.flat();
      }
    },
    visitEntry: (entry, directory, root, scope) => {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return sourceHelpers.walk(path, root, scope);
      }
      if (!sourceHelpers.shouldIncludeFile(path, scope)) {
        return Promise.resolve([]);
      }
      return Promise.resolve([sourceHelpers.asRepositoryPath(relative(root, path))]);
    },
  walk: async (directory, root, scope) => {
      if (sourceHelpers.isExcluded(directory, scope[EXCLUDED_DIRECTORIES_INDEX])) {
        return [];
      }
      return sourceHelpers.visitEntries(await readdir(directory, { withFileTypes: true }), directory, root, scope);
    },
  },
  { collectChangedSourceFiles, collectSourceFiles, selectChangedSourcePaths, sourceUnitId } = sourceHelpers;

export { collectChangedSourceFiles, collectSourceFiles, selectChangedSourcePaths, sourceUnitId };
