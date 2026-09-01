import { readdirSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

const FRONTEND_SOURCE_ROOTS = ["app", "components", "features", "hooks", "lib"],
 EXCLUDED_DIRECTORIES = new Set([
  ".next",
  "__mocks__",
  "__tests__",
  "coverage",
  "generated",
  "node_modules",
  "tools",
]),
 TEST_FILE_PATTERN = /(?:^|\.)(?:spec|test)\.[cm]?[jt]sx?$/u,

 collectFiles = (directory, extensions, output) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      collectFiles(path, extensions, output);
      continue;
    }
    if (extensions.has(extname(entry.name)) && !TEST_FILE_PATTERN.test(entry.name)) {
      output.push(path);
    }
  }
},

 collectOwnedFrontendFiles = (
  repositoryRoot,
  extensions = new Set([".js", ".jsx", ".ts", ".tsx"]),
) => {
  const frontendRoot = resolve(repositoryRoot, "frontend"),
   files = [];
  for (const sourceRoot of FRONTEND_SOURCE_ROOTS) {
    collectFiles(resolve(frontendRoot, sourceRoot), extensions, files);
  }
  return files
    .map((path) => relative(repositoryRoot, path).split(sep).join("/"))
    .sort();
};

export { collectOwnedFrontendFiles };
