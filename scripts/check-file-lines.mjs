// 1000-line source file guard: CI + local in one rule.
//   - new/rebuilt files over 1000 lines fail
//   - files listed in scripts/file-lines-debt.json may not GROW past their
//     recorded size; shrinking below 1000 removes the exemption forever
//
// Usage: node scripts/check-file-lines.mjs

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const MAX_LINES = 1000;
const WARN_LINES = 750;

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".py", ".rs"]);
const IGNORED_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "coverage",
  "dist",
  "build",
  "__pycache__",
]);
const IGNORED_PREFIXES = new Set([
  ".agent",
  ".agents",
  ".claude",
  ".codex",
  ".continue",
  ".cursor",
  ".gemini",
  ".opencode",
  ".pi",
  ".roo",
  ".windsurf",
]);

const DEBT_FILE = resolve(ROOT, "scripts", "file-lines-debt.json");
const loadDebt = () => (existsSync(DEBT_FILE) ? JSON.parse(readFileSync(DEBT_FILE, "utf8")) : {});

const countLines = (content) =>
  content.length === 0 ? 0 : content.split("\n").length - (content.endsWith("\n") ? 1 : 0);

function shouldSkipDir(name) {
  return name.startsWith(".") || IGNORED_DIRS.has(name) || IGNORED_PREFIXES.has(name);
}

function collect(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!shouldSkipDir(entry.name)) {found.push(...collect(full));}
      continue;
    }
    if (SOURCE_EXTENSIONS.has(extname(entry.name)) && !full.includes("lib/generated")) {
      found.push(full);
    }
  }
  return found;
}

const debt = loadDebt();
const failed = [];
const warned = [];

for (const file of collect(ROOT)) {
  const rel = relative(ROOT, file);
  const lines = countLines(readFileSync(file, "utf8"));
  const debtCap = debt[rel];

  if (debtCap !== undefined) {
    if (lines > debtCap) {
      failed.push(`${lines}\t${rel} (over debt cap ${debtCap}; shrink, do not grow)`);
    }
    continue;
  }

  if (lines > MAX_LINES) {
    failed.push(`${lines}\t${rel} (max ${MAX_LINES})`);
  } else if (lines >= WARN_LINES) {
    warned.push(`${lines}\t${rel} (approaching ${MAX_LINES})`);
  }
}

if (warned.length > 0) {
  console.error("Files nearing the line limit:");
  for (const w of warned) {console.error(`  ${w}`);}
}
if (failed.length > 0) {
  console.error("Files over the line limit:");
  for (const f of failed) {console.error(`  ${f}`);}
  process.exit(1);
}
console.log(`check-file-lines: checked, ${warned.length} near limit, ${failed.length} over.`);
