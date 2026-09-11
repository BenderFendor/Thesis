import { access, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const frontendRoot = resolve("frontend"),
  excludedDirectories = new Set(["node_modules", ".next", "coverage", "generated", "tools"]),
  fileExtensions = [".ts", ".tsx", ".js", ".jsx"],
  sourcePattern = /\.(?:ts|tsx|js|jsx)$/u,
  importPattern = /(?:from\s+|import\s*\(\s*|require\(\s*)["'](@\/[^"']+)["']/gu,
  fix = process.argv.includes("--fix");

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const collectFiles = async (directory) => {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const groups = await Promise.all(entries.map(async (entry) => {
    if (excludedDirectories.has(entry.name)) { return []; }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { return collectFiles(path); }
    return sourcePattern.test(entry.name) ? [path] : [];
  }));
  return groups.flat();
};

const resolvesAt = async (relativePath) => {
  if (await exists(join(frontendRoot, relativePath))) { return true; }
  const candidates = fileExtensions.flatMap((extension) => [
    join(frontendRoot, `${relativePath}${extension}`),
    join(frontendRoot, relativePath, `index${extension}`),
  ]);
  return (await Promise.all(candidates.map(exists))).some(Boolean);
};

const kebabCaseSegment = (segment) => {
  const stem = segment.replace(/\.(?:ts|tsx|js|jsx)$/u, ""),
    suffix = segment.slice(stem.length);
  return `${stem.replaceAll(/([a-z0-9])([A-Z])/gu, "$1-$2").toLowerCase()}${suffix}`;
};

const resolveSegmentTransform = async (specifier, transform) => {
  const segments = specifier.split("/");
  for (let index = 1; index < segments.length; index += 1) {
    const candidate = segments.map((segment, segmentIndex) =>
      segmentIndex === index ? transform(segment) : segment).join("/");
    if (candidate !== specifier && await resolvesAt(candidate.slice(2))) { return candidate; }
  }
  return undefined;
};

const findBrokenImports = async (files) => {
  const broken = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (!await resolvesAt(specifier.slice(2))) {
        broken.push({ file: file.slice(frontendRoot.length + 1), specifier });
      }
    }
  }
  return [...new Map(broken.map((item) => [`${item.file}:${item.specifier}`, item])).values()];
};

const aliases = new Map([
  ["@/hooks/useDebugMode", "@/hooks/use-debug-mode"],
  ["@/hooks/useInlineDefinition", "@/hooks/use-inline-definition"],
  ["@/hooks/useLikedArticles", "@/hooks/use-liked-articles"],
  ["@/hooks/useLiveNewsPreferences", "@/hooks/use-live-news-preferences"],
  ["@/hooks/useScrollPersonalization", "@/hooks/use-scroll-personalization"],
  ["@/hooks/useSourceFilter", "@/hooks/use-source-filter"],
  ["@/lib/suource-groups", "@/lib/source-groups"],
  ["@/lib/sutorage", "@/lib/storage"],
]);

const repairSpecifier = async (specifier) => {
  const alias = aliases.get(specifier);
  if (alias && await resolvesAt(alias.slice(2))) { return alias; }
  const typoFix = await resolveSegmentTransform(specifier, (segment) => segment.replace(/^(\w)u+/u, "$1"));
  return typoFix ?? resolveSegmentTransform(specifier, kebabCaseSegment);
};

const repairBrokenImports = async (broken) => {
  let repaired = 0;
  for (const item of broken) {
    const replacement = await repairSpecifier(item.specifier);
    if (!replacement) { continue; }
    const path = join(frontendRoot, item.file),
      source = await readFile(path, "utf8");
    await writeFile(path, source.replaceAll(item.specifier, replacement));
    repaired += 1;
  }
  return repaired;
};

const main = async () => {
  const files = await collectFiles(frontendRoot),
    broken = await findBrokenImports(files);
  if (broken.length === 0) {
    console.log(`import check: ${files.length} files, all @/ imports resolve`);
    return 0;
  }
  console.error(`import check FAILED: ${broken.length} unresolved @/ imports in ${new Set(broken.map((item) => item.file)).size} files`);
  for (const item of broken.slice(0, 50)) { console.error(`  ${item.file}: "${item.specifier}"`); }
  if (!fix) { return 1; }
  const repaired = await repairBrokenImports(broken);
  console.log(`repaired ${repaired} of ${broken.length} unresolved imports`);
  return repaired === broken.length ? 0 : 1;
};

process.exitCode = await main();
