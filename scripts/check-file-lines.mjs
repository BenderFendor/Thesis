import { access, readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, ".."),
  debtFile = resolve(root, "scripts/file-lines-debt.json"),
  maximumLines = 1_000,
  warningLines = 750,
  sourceExtensions = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".rs"]),
  ignoredDirectories = new Set(["node_modules", ".next", ".git", "coverage", "dist", "build", "__pycache__"]),
  ignoredPrefixes = [".agent", ".agents", ".claude", ".codex", ".continue", ".cursor", ".gemini", ".opencode", ".pi", ".roo", ".windsurf"];

const shouldSkipDirectory = (name) =>
  name.startsWith(".") || ignoredDirectories.has(name) || ignoredPrefixes.includes(name);

const collectFiles = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true }),
    groups = await Promise.all(entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return shouldSkipDirectory(entry.name) ? [] : collectFiles(path);
      }
      return sourceExtensions.has(extname(entry.name)) && !path.includes("lib/generated") ? [path] : [];
    }));
  return groups.flat();
};

const countLines = (content) => {
  if (content.length === 0) { return 0; }
  return content.split("\n").length - (content.endsWith("\n") ? 1 : 0);
};

const loadDebt = async () => {
  try {
    await access(debtFile);
    return JSON.parse(await readFile(debtFile, "utf8"));
  } catch {
    return {};
  }
};

const main = async () => {
  const [debt, files] = await Promise.all([loadDebt(), collectFiles(root)]),
    failed = [],
    warned = [];
  for (const file of files) {
    const path = relative(root, file),
      lines = countLines(await readFile(file, "utf8")),
      debtCap = debt[path];
    if (debtCap !== undefined) {
      if (lines > debtCap) { failed.push(`${lines}\t${path} (over debt cap ${debtCap}; shrink, do not grow)`); }
    } else if (lines > maximumLines) {
      failed.push(`${lines}\t${path} (max ${maximumLines})`);
    } else if (lines >= warningLines) {
      warned.push(`${lines}\t${path} (approaching ${maximumLines})`);
    }
  }
  if (warned.length > 0) {
    console.error("Files nearing the line limit:");
    for (const warning of warned) { console.error(`  ${warning}`); }
  }
  if (failed.length > 0) {
    console.error("Files over the line limit:");
    for (const failure of failed) { console.error(`  ${failure}`); }
  }
  console.log(`check-file-lines: checked ${files.length}, ${warned.length} near limit, ${failed.length} over.`);
  return failed.length === 0 ? 0 : 1;
};

process.exitCode = await main();
