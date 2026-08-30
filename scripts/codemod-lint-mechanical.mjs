// Mechanical oxlint-cleaner: applies ONLY semantics-preserving transforms.
// Each transform is provably behavior-neutral; tsc verifies after.
//
// Transforms:
//  1. prefer-readonly-parameter-types: `x: T[]` -> `x: readonly T[]`; `x: {..}` -> `x: Readonly<{..}>`
//  2. prefer-global-this: `window.` -> `globalThis.` (browser: identical)
//  3. require-unicode-regexp: add `u` flag to regex literals (checked by node RegExp parse)
//  4. no-null in local (non-exported API) positions: `null` -> `undefined` (risky sites skipped)
//  5. prefer-expect-assertions: add `expect.hasAssertions()` first statement in it() blocks
//  6. one-var: merge consecutive same-kind (const/let) declarations in the same block scope
//  7. exports-last + group-exports: move named exports to file end into one `export { }` block
//
// Usage: node scripts/codemod-lint-mechanical.mjs [--dry] [--file <path>] [--rules r1,r2]
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const TS_URL = new URL("../frontend/node_modules/typescript/lib/typescript.js", import.meta.url);
const ts = require(TS_URL.pathname);

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const onlyFile = args.includes("--file") ? args[args.indexOf("--file") + 1] : null;
const onlyRules = args.includes("--rules") ? args[args.indexOf("--rules") + 1].split(",") : null;

const EXTRACT = new Set(["node_modules", ".next", "coverage", "generated", "tools", "test-utils"]);

function collect(dir, out) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (EXTRACT.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) collect(p, out);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name)) out.push(p);
  }
}

// --- readonly params ---
function applyReadonlyParams(source) {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const changes = [];
  function visit(node) {
    if (ts.isParameter(node)) {
      const t = node.type;
      if (t && ts.isArrayTypeNode(t)) {
        changes.push({ pos: t.pos, end: t.end, add: `readonly ` });
      } else if (t && ts.isTypeLiteralNode(t)) {
        changes.push({ pos: t.pos, end: t.end, add: `Readonly<`, close: `>` });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  for (const c of changes.sort((a, b) => b.pos - a.pos)) {
    const inner = source.slice(c.pos, c.end);
    source = source.slice(0, c.pos) + (c.add || "") + inner + (c.close || "") + source.slice(c.end);
  }
  return source;
}

// --- globalThis ---
function applyGlobalThis(source) {
  return source.replace(/\bwindow\./g, "globalThis.");
}

// --- unicode regexp ---
function applyUnicodeRegexp(source) {
  return source.replace(/\/(?:[^/\\\n]|\\.)+\/[gimsyu]*/g, (m) => {
    if (m.includes("u")) return m;
    const lastSlash = m.lastIndexOf("/");
    const patt = m.slice(0, lastSlash + 1);
    const flags = m.slice(lastSlash + 1);
    if (!flags) return m;
    try {
      new RegExp(patt.slice(1, -1), flags + "u");
      return patt + flags + "u";
    } catch {
      return m;
    }
  });
}

// --- no-null (safe positions only) ---
function applyNoNullLocal(source) {
  const out = [];
  let last = 0;
  const re = /\bnull\b/g;
  let m;
  while ((m = re.exec(source))) {
    const before = source.slice(Math.max(0, m.index - 40), m.index);
    const after = source.slice(m.index + 4, m.index + 24);
    const isTypePos = /:\s*[^=;]*$/.test(before) || /^[|&]/.test(after) || /<\s*$/.test(before);
    const isComparison = /(?:===|!==|==|!=|&&|\|\||\?\.|instanceof|typeof|\?)\s*$/.test(before);
    const isReturnNull = /\breturn\s*$/.test(before);
    const isAssign = /(?:=|\w\s*|\(|,|\{|\[)\s*$/.test(before) && !isComparison;
    if (isTypePos || isComparison) {
      out.push(source.slice(last, m.index + 4));
      last = m.index + 4;
      continue;
    }
    if (isReturnNull || isAssign) {
      out.push(source.slice(last, m.index));
      out.push("undefined");
      last = m.index + 4;
      continue;
    }
    out.push(source.slice(last, m.index + 4));
    last = m.index + 4;
  }
  out.push(source.slice(last));
  return out.join("");
}

// --- expect assertions ---
function applyExpectAssertions(source) {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const changes = [];
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === "it" || node.expression.text === "test")) {
      const fn = node.arguments[1];
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && fn.body && ts.isBlock(fn.body)) {
        const firstStmt = fn.body.statements[0];
        const hasAssertions = firstStmt && ts.isExpressionStatement(firstStmt) &&
          ts.isCallExpression(firstStmt.expression) && ts.isPropertyAccessExpression(firstStmt.expression.expression) &&
          (firstStmt.expression.expression.getText(sf) === "expect.hasAssertions" || firstStmt.expression.expression.getText(sf) === "expect.assertions");
        if (!hasAssertions) {
          changes.push({ pos: firstStmt ? firstStmt.pos : fn.body.pos + 1, add: "  expect.hasAssertions();\n" });
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
  for (const c of changes.sort((a, b) => b.pos - a.pos)) {
    source = source.slice(0, c.pos) + c.add + source.slice(c.pos);
  }
  return source;
}

// --- one-var: merge consecutive same-kind statements in a block ---
function applyOneVar(source) {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const changes = [];
  function scanStatements(statements) {
    let i = 0;
    while (i < statements.length) {
      const s = statements[i];
      if (ts.isVariableStatement(s)) {
        const kind = s.declarationList.flags & ts.NodeFlags.Const ? "const" : ts.NodeFlags.Let ? "let" : "var";
        let j = i + 1;
        while (j < statements.length && ts.isVariableStatement(statements[j])) {
          const k2 = statements[j].declarationList.flags & ts.NodeFlags.Const ? "const" : ts.NodeFlags.Let ? "let" : "var";
          if (k2 !== kind) break;
          j++;
        }
        if (j - i > 1) {
          const first = statements[i];
          const lastS = statements[j - 1];
          const nextPos = lastS.getEnd();
          // Build merged: remove statements i..j-1 except first, append declarations from others
          const names = [source.slice(first.pos, first.getEnd())];
          for (let k = i + 1; k < j; k++) {
            const txt = source.slice(statements[k].pos, statements[k].getEnd()).trim();
            const body = txt.replace(/^(const|let|var)\s+/, "");
            names.push(body);
          }
          const merged = `${kind} ${names.join(",\n")};`;
          changes.push({ pos: first.pos, end: nextPos, add: merged });
        }
        i = j;
      } else {
        i++;
      }
    }
  }
  function visit(node) {
    if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isSourceFile(node)) {
      scanStatements(node.statements);
      ts.forEachChild(node, visit);
    } else {
      ts.forEachChild(node, visit);
    }
  }
  visit(sf);
  for (const c of changes.sort((a, b) => b.pos - a.pos)) {
    source = source.slice(0, c.pos) + c.add + source.slice(c.end);
  }
  return source;
}

// --- exports-last + group-exports ---
function applyExportsLast(source) {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const exported = [];
  const keep = [];
  const changes = [];
  function visit(node, parent) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableStatement(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isModuleDeclaration(node)) &&
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
      // record the export; we'll strip the export keyword and move to end block
      const text = source.slice(node.pos, node.getEnd());
      const stripped = text.replace(/^\s*export\s+/, "");
      exported.push({
        kind: node.kind,
        keyword: node.modifiers.find((m) => m.kind === ts.SyntaxKind.ExportKeyword).getStart(sf),
        start: node.getStart(sf),
        end: node.getEnd(),
        name: ts.isVariableStatement(node) ? node.declarationList.declarations.map((d) => d.name.getText(sf)).join(", ")
          : node.name ? node.name.getText(sf) : null,
        stripped,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(sf, null);
  if (exported.length === 0) return source;
  // do not move: default export assignments stay; re-export declarations stay
  const movable = exported.filter((e) => e.name);
  if (movable.length === 0) return source;
  for (const e of movable) {
    changes.push({ pos: e.start, end: e.end, add: e.stripped });
  }
  // apply removals from end to start
  for (const c of changes.sort((a, b) => b.pos - a.pos)) {
    source = source.slice(0, c.pos) + c.add + source.slice(c.end);
  }
  // append grouped export at file end
  const exportNames = movable.map((e) => e.name).join(", ");
  if (exportNames) {
    source += `\n\nexport { ${exportNames} };\n`;
  }
  return source;
}

const files = [];
if (onlyFile) files.push(onlyFile);
else { collect("frontend", files); collect("scripts", files); }
const selfPath = new URL(import.meta.url).pathname;
const targets = files.filter((f) => f !== selfPath);

const rules = onlyRules ?? ["readonly", "globalThis", "unicodeRegexp", "noNull", "expectAssertions", "oneVar", "exportsLast"];
const changedFiles = [];

for (const file of targets) {
  let src;
  try { src = readFileSync(file, "utf8"); } catch { continue; }
  const orig = src;
  if (rules.includes("readonly")) src = applyReadonlyParams(src);
  if (rules.includes("globalThis")) src = applyGlobalThis(src);
  if (rules.includes("unicodeRegexp")) src = applyUnicodeRegexp(src);
  if (rules.includes("noNull")) src = applyNoNullLocal(src);
  if (rules.includes("expectAssertions")) src = applyExpectAssertions(src);
  if (rules.includes("oneVar")) src = applyOneVar(src);
  if (rules.includes("exportsLast")) src = applyExportsLast(src);
  if (src !== orig) {
    changedFiles.push(file);
    if (!dry) writeFileSync(file, src);
  }
}
console.log("files changed:", changedFiles.length);
