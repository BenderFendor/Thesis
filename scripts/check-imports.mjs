// Verify that every "@/…" path-mapped import in frontend resolves to an
// existing file. TS 5.9 + moduleResolution=bundler silently skips TS2307
// for missing path-mapped modules, so builds pass with broken imports.
//
// Usage: node scripts/check-imports.mjs [--fix]
import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function kebab(seg) {
  const stem = seg.replace(/\.(ts|tsx|js|jsx)$/, "");
  return stem.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase() + (seg !== stem ? seg.slice(stem.length) : "");
}

const root = resolve("frontend");
const args = process.argv.slice(2);
const fix = args.includes("--fix");

const EXCLUDED = new Set(["node_modules", ".next", "coverage", "generated", "tools"]);

function collect(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (EXCLUDED.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(p);
  }
}

const files = [];
collect(root, files);

const FILE_EXTS = [".ts", ".tsx", ".js", ".jsx"];

function resolvesAt(rel) {
  if (existsSync(join(root, rel))) return true;
  for (const e of FILE_EXTS) if (existsSync(join(root, rel + e))) return true;
  for (const e of FILE_EXTS) if (existsSync(join(root, rel, "index" + e))) return true;
  return false;
}

const bad = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const re = /(?:from\s+|import\s*\(\s*|require\(\s*)["'](@\/[^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1];
    if (!resolvesAt(spec.slice(2))) bad.push({ file: file.slice(root.length + 1), spec });
  }
}

if (bad.length === 0) {
  console.log(`import check: ${files.length} files, all @/ imports resolve`);
  process.exit(0);
}

console.log(`import check FAILED: ${bad.length} unresolved @/ imports in ${new Set(bad.map((b) => b.file)).size} files`);
const unique = [...new Map(bad.map((b) => [b.file + ":" + b.spec, b])).values()];
for (const b of unique.slice(0, 50)) console.log(`  ${b.file}: "${b.spec}"`);

if (fix) {
  const ALIAS = {
    "@/lib/sutorage": "@/lib/storage",
    "@/lib/suource-groups": "@/lib/source-groups",
    "@/hooks/useSourceFilter": "@/hooks/use-source-filter",
    "@/hooks/useLikedArticles": "@/hooks/use-liked-articles",
    "@/hooks/useDebugMode": "@/hooks/use-debug-mode",
    "@/hooks/useInlineDefinition": "@/hooks/use-inline-definition",
    "@/hooks/useLiveNewsPreferences": "@/hooks/use-live-news-preferences",
    "@/hooks/useScrollPersonalization": "@/hooks/use-scroll-personalization",
  };
  let repaired = 0;
  for (const b of unique) {
    let target = ALIAS[b.spec];
    // systematic typo: extra "u" inserted after first char of the path segment
    if (!target) {
      const segs = b.spec.split("/");
      for (let i = 1; i < segs.length; i++) {
        const fixed = segs.map((s, j) => (j === i ? s.replace(/^(\w)u+/, "$1") : s));
        const cand = fixed.join("/");
        if (cand !== b.spec && resolvesAt(cand.slice(2))) { target = cand; break; }
      }
    }
    // systematic kebab-case: camelCase segment -> kebab-case
    if (!target) {
      const segs = b.spec.split("/");
      for (let i = 1; i < segs.length; i++) {
        const fixed = segs.map((s, j) => (j === i ? kebab(s) : s));
        const cand = fixed.join("/");
        if (cand !== b.spec && resolvesAt(cand.slice(2))) { target = cand; break; }
      }
    }
    if (target && resolvesAt(target.slice(2))) {
      const p = join(root, b.file);
      writeFileSync(p, readFileSync(p, "utf8").replaceAll(b.spec, target));
      repaired++;
    }
  }
  console.log(`repaired ${repaired} of ${bad.length} (autofix covers typo + kebab families)`);
  process.exit(repaired >= bad.length ? 0 : 1);
}
process.exit(1);
