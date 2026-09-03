// Groups the repo's named-export declarations into one trailing export
// Statement per kind, satisfying the oxlint `import(group-exports)` rule.
//
// Rule semantics (oxlint 1.80.0, default options; the repo enables the rule
// Through the style category):
//   - A named export is an ExportNamedDeclaration without a module specifier,
//     Whether it wraps a declaration (export const/function/class/interface/
//     Type/enum) or a bare export clause (export { ... }).
//   - Each named export is classified by kind: value for variable, function,
//     Class, enum, and value clauses; type for interface, type-alias, and
//     Type-only clauses. When a kind appears more than once, the rule reports
//     Every statement of that kind ("consolidate all named exports into a
//     Single export declaration").
//   - Re-exports (export { x } from ...), side-effect exports (export * from
//     ...), and export default statements are ignored by the rule and are
//     Never moved by this transform.
//
// Transform behavior:
//   - Every top-level exported variable, function, class, interface,
//     Type-alias, and enum declaration (no default, no declare) has its
//     `export` keyword removed; the declaration stays exactly in place, so
//     Execution order (including call/new/await initializers) and hoisting
//     Are unchanged.
//   - One trailing statement collects the value members in declaration order
//     (`export { a, b };`); a second trailing statement collects the type-only
//     Members (`export type { I, T };`) when the file has any.
//   - A file is left unchanged when no kind has two or more collected
//     Declarations (the rule cannot fire), and on any ambiguity: parse
//     Errors, destructuring declaration names (no single binding name), a
//     Collected name bound more than once at top level (including a second
//     Binding outside the collected statements; function overload groups are
//     The one allowed exception and are deduplicated in the list), a
//     Collected name that appears in any export clause of the same file
//     (already re-exported/exported-locally elsewhere: ambiguity), or a
//     Collected name referenced in a JSDoc comment (brace type group,
//     `{@link ...}`, `@link`, or `@see`; documentation tools may resolve
//     Against the original export surface, so skip rather than guess).
//   - Unhandled exported kinds (namespace/module/declare declarations and
//     Bare export clauses) stay in place; re-exports and side-effect exports
//     Stay in place. Files mixing them with collectable declarations are
//     Transformed for the collectable part only.
//   - Idempotent: the grouped output no longer contains exported
//     Declarations, so a second run changes nothing.
//
// Usage: node scripts/transformations/group-exports.mjs --file <path> [--dry]
import tsModule from "../../frontend/node_modules/typescript/lib/typescript.js";

/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").Node>} TsNode */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").SourceFile>} TsSourceFile */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").Statement>} TsStatement */
/** @typedef {{ start: number; end: number }} EditSpan */
/** @typedef {{ name: string; typeOnly: boolean }} ExportEntry */
/** @typedef {{ dryRun: boolean; filePath: string }} CliOptions */
/** @typedef {Readonly<{ changed: boolean; text: string }>} TransformResult */
/** @typedef {{ entries: ExportEntry[]; names: Map<string, number>; reexportNames: Set<string>; skip: boolean }} ScanResult */

const
  EMPTY_INDEX = 0,
  EXIT_FAILURE = 1,
  FIRST_INDEX = 1,
  GroupExports = {
    /**
     * Analyses one top-level statement into a scan result fragment.
     * @param {TsStatement} statement - Top-level statement.
     * @returns {Partial<ScanResult>} Classified names, entries, and skip flag.
     */
    analyzeStatement(statement) {
      if (ts.isExportDeclaration(statement)) {
        return {reexportNames: GroupExports.clauseNames(statement)};
      }
      if (!GroupExports.isExported(statement) || GroupExports.isExemptExport(statement)) {
        return {names: GroupExports.declaredNames(statement)};
      }
      if (ts.isVariableStatement(statement)) {
        return GroupExports.analyzeVariable(statement);
      }
      if (GroupExports.isNamedDeclaration(statement)) {
        return GroupExports.declarationEntry(statement);
      }
      return {names: GroupExports.declaredNames(statement)};
    },

    /**
     * Analyses one exported variable statement.
     * @param {TsStatement} statement - Exported variable statement.
     * @returns {Partial<ScanResult>} Member entries or a skip marker.
     */
    analyzeVariable(statement) {
      /** @type {string[]} */
      const names = [];
      const declarations = statement.declarationList.declarations;
      for (const declaration of declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.push(declaration.name.text);
          continue;
        }
        return {skip: true};
      }
      if (new Set(names).size !== names.length) {
        return {skip: true};
      }
      return {
        entries: names.map((name) => ({name, typeOnly: false})),
        names,
      };
    },

    /**
     * Applies every removal and the trailing append right-to-left.
     * @param {string} sourceText - Full source text.
     * @param {readonly EditSpan[]} removals - Keyword removal spans.
     * @param {string} suffix - Trailing export statements text.
     * @returns {string} Transformed source text.
     */
    applyEdits(sourceText, removals, suffix) {
      let text = `${sourceText}${suffix}`;
      for (let index = removals.length - FIRST_INDEX; index >= EMPTY_INDEX; index -= FIRST_INDEX) {
        const removal = removals[index];
        text = text.slice(EMPTY_INDEX, removal.start)
          + text.slice(removal.end);
      }
      return text;
    },

    /**
     * Builds the trailing export statements text.
     * @param {readonly string[]} valueNames - Value member names in order.
     * @param {readonly string[]} typeNames - Type-only member names in order.
     * @param {string} sourceText - Full source text.
     * @returns {string} Trailing export statements, or an empty string.
     */
    buildSuffix(valueNames, typeNames, sourceText) {
      const lineBreak = sourceText.endsWith("\n") ? "" : "\n";
      let suffix = lineBreak;
      if (valueNames.length > EMPTY_INDEX) {
        suffix += `export { ${valueNames.join(", ")} };\n`;
      }
      if (typeNames.length > EMPTY_INDEX) {
        suffix += `export type { ${typeNames.join(", ")} };\n`;
      }
      return suffix;
    },

    /**
     * Reports the visible names of one export clause.
     * @param {TsStatement} statement - Export declaration statement.
     * @returns {Set<string>} Clause member names, local and exported.
     */
    clauseNames(statement) {
      /** @type {Set<string>} */
      const names = new Set();
      const clause = statement.exportClause;
      if (clause === undefined) {
        return names;
      }
      for (const element of clause.elements) {
        names.add(element.name.text);
        if (element.exported !== undefined && element.exported !== element.name) {
          names.add(element.exported.text);
        }
      }
      return names;
    },

    /**
     * Collects the JSDoc comment ranges of one source file tree.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @returns {readonly EditSpan[]} JSDoc comment text ranges.
     */
    collectJsDocRanges(parsed) {
      /** @type {EditSpan[]} */
      const ranges = [];
      /** @type {TsNode[]} */
      const stack = [parsed];
      while (stack.length > EMPTY_INDEX) {
        const node = stack.pop();
        for (const doc of node.jsDoc ?? []) {
          ranges.push({start: doc.getStart(parsed), end: doc.getEnd()});
        }
        ts.forEachChild(node, (child) => {
          stack.push(child);
        });
      }
      return ranges;
    },

    /**
     * Returns a scan result for one single-name exported declaration.
     * @param {TsStatement} statement - Exported declaration statement.
     * @returns {Partial<ScanResult>} One entry or a skip marker.
     */
    declarationEntry(statement) {
      const name = statement.name === undefined ? "" : statement.name.text;
      if (name.length === EMPTY_INDEX) {
        return {skip: true};
      }
      return {
        entries: [{name, typeOnly: GroupExports.isTypeOnlyDeclaration(statement)}],
        names: [name],
      };
    },

    /**
     * Returns the top-level binding names declared by one statement.
     * @param {TsStatement} statement - Top-level statement.
     * @returns {string[]} Declared binding names.
     */
    declaredNames(statement) {
      if (ts.isVariableStatement(statement)) {
        /** @type {string[]} */
        const names = [];
        for (const declaration of statement.declarationList.declarations) {
          names.push(...GroupExports.patternNames(declaration.name));
        }
        return names;
      }
      if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)
        || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)
        || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) {
        return statement.name === undefined ? [] : [statement.name.text];
      }
      return [];
    },

    /**
     * Applies or reports the transform result for one file.
     * @param {TransformResult} result - Transform result.
     * @param {string} filePath - File path.
     * @param {boolean} dryRun - Whether to skip writing.
     * @returns {void} Always ends after handling the result.
     */
    emitResult(result, filePath, dryRun) {
      if (dryRun) {
        GroupExports.reportDry(result, filePath);
        return;
      }
      if (result.changed) {
        ts.sys.writeFile(filePath, result.text);
      }
      GroupExports.reportApplied(result, filePath);
    },

    /**
     * Returns the unique names of one export entry list in source order.
     * @param {readonly ExportEntry[]} entries - Collected entries.
     * @param {boolean} typeOnly - Filter kind.
     * @returns {string[]} Deduplicated member names.
     */
    entriesNames(entries, typeOnly) {
      /** @type {string[]} */
      const names = [];
      for (const entry of entries) {
        if (entry.typeOnly === typeOnly && !names.includes(entry.name)) {
          names.push(entry.name);
        }
      }
      return names;
    },

    /**
     * Escapes one identifier for use inside a regular expression.
     * @param {string} name - Identifier text.
     * @returns {string} Regex-safe text.
     */
    escapeRegex(name) {
      return name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    },

    /**
     * Transforms one source file and returns its result.
     * @param {string} sourceText - Source text to transform.
     * @param {string} filePath - Source file path (used for script kind).
     * @returns {TransformResult} Transformed text plus changed flag.
     */
    fileTransform(sourceText, filePath) {
      const parsed = GroupExports.parseSource(sourceText, filePath);
      if (parsed.parseDiagnostics.length > EMPTY_INDEX) {
        return GroupExports.unchangedResult(sourceText);
      }
      const scan = GroupExports.plan(parsed, sourceText);
      const valueNames = GroupExports.entriesNames(scan.entries, false);
      const typeNames = GroupExports.entriesNames(scan.entries, true);
      if (!GroupExports.hasGroup(scan.entries)) {
        return GroupExports.unchangedResult(sourceText);
      }
      if (GroupExports.hasAmbiguity(scan, scan.entries)) {
        return GroupExports.unchangedResult(sourceText);
      }
      if (GroupExports.hasJsDocReference(parsed, sourceText, [
        ...valueNames, ...typeNames])) {
        return GroupExports.unchangedResult(sourceText);
      }
      const suffix = GroupExports.buildSuffix(valueNames, typeNames, sourceText);
      return {changed: true, text: GroupExports.applyEdits(sourceText, scan.removals, suffix)};
    },

    /**
     * Reports whether a file plan has any ambiguity marker.
     * @param {ScanResult} scan - File scan result.
     * @param {readonly ExportEntry[]} entries - Collected entries.
     * @returns {boolean} True when the file must stay unchanged.
     */
    hasAmbiguity(scan, entries) {
      if (scan.skip) {
        return true;
      }
      const collectedCounts = GroupExports.nameCounts(entries.map((entry) => entry.name));
      for (const [name, count] of collectedCounts) {
        const total = scan.names.get(name) ?? EMPTY_INDEX;
        if (total > count) {
          return true;
        }
        if (scan.reexportNames.has(name)) {
          return true;
        }
      }
      return false;
    },

    /**
     * Reports whether any exported kind appears in multiple statements.
     * @param {readonly ExportEntry[]} entries - Collected entries.
     * @returns {boolean} True when a group transformation is needed.
     */
    hasGroup(entries) {
      let values = 0;
      let types = 0;
      for (const entry of entries) {
        if (entry.typeOnly) {
          types += FIRST_INDEX;
        } else {
          values += FIRST_INDEX;
        }
      }
      return values >= MIN_GROUP_SIZE || types >= MIN_GROUP_SIZE;
    },

    /**
     * Reports whether a JSDoc comment references any export name.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @param {readonly string[]} names - Collected export names.
     * @returns {boolean} True when a JSDoc group or link tag mentions one.
     */
    hasJsDocReference(parsed, sourceText, names) {
      const ranges = GroupExports.collectJsDocRanges(parsed);
      for (const range of ranges) {
        const text = sourceText.slice(range.start, range.end);
        if (GroupExports.someReferencedName(text, names)) {
          return true;
        }
      }
      return false;
    },

    /**
     * Reports whether one export statement is exempt from collection.
     * @param {TsStatement} statement - Exported top-level statement.
     * @returns {boolean} True for default or declare exports.
     */
    isExemptExport(statement) {
      return (statement.modifiers ?? []).some((modifier) =>
        modifier.kind === ts.SyntaxKind.DefaultKeyword
        || modifier.kind === ts.SyntaxKind.DeclareKeyword);
    },

    /**
     * Reports whether one statement carries an export modifier.
     * @param {TsStatement} statement - Top-level statement.
     * @returns {boolean} True when the statement is exported.
     */
    isExported(statement) {
      return (statement.modifiers ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    },

    /**
     * Reports whether one statement is a collectable declaration kind.
     * @param {TsStatement} statement - Exported top-level statement.
     * @returns {boolean} True for function, class, enum, interface, type.
     */
    isNamedDeclaration(statement) {
      return ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)
        || ts.isEnumDeclaration(statement) || ts.isInterfaceDeclaration(statement)
        || ts.isTypeAliasDeclaration(statement);
    },

    /**
     * Reports whether one declaration exports only a type.
     * @param {TsStatement} statement - Exported declaration statement.
     * @returns {boolean} True for interface and type-alias declarations.
     */
    isTypeOnlyDeclaration(statement) {
      return ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement);
    },

    /**
     * Runs the transform CLI over one target file.
     * @returns {void} Always ends after the file is processed.
     */
    main() {
      const {dryRun, filePath} = GroupExports.parseCliArgs(ts.sys.args);
      const sourceText = GroupExports.readTarget(filePath);
      if (sourceText === UNCHANGED) {
        return;
      }
      const result = GroupExports.fileTransform(sourceText, filePath);
      GroupExports.emitResult(result, filePath, dryRun);
    },

    /**
     * Returns the counted occurrences of one name list.
     * @param {readonly string[]} names - Name list.
     * @returns {Map<string, number>} Name occurrence counts.
     */
    nameCounts(names) {
      /** @type {Map<string, number>} */
      const counts = new Map();
      for (const name of names) {
        counts.set(name, (counts.get(name) ?? EMPTY_INDEX) + FIRST_INDEX);
      }
      return counts;
    },

    /**
     * Parses CLI arguments for the transform.
     * @param {readonly string[]} args - Process arguments after the script name.
     * @returns {CliOptions} Parsed CLI options.
     */
    parseCliArgs(args) {
      let dryRun = false;
      let filePath = "";
      for (let index = EMPTY_INDEX; index < args.length; index += FIRST_INDEX) {
        const arg = args[index];
        if (arg === "--dry") {
          dryRun = true;
        }
        if (arg === "--file" && index < args.length - FIRST_INDEX) {
          filePath = args[index + FIRST_INDEX];
          index += FIRST_INDEX;
        }
      }
      return {dryRun, filePath};
    },

    /**
     * Parses one source file with the TypeScript AST.
     * @param {string} sourceText - Source text.
     * @param {string} filePath - Source file path.
     * @returns {TsSourceFile} Parsed source file.
     */
    parseSource(sourceText, filePath) {
      return ts.createSourceFile(
        filePath, sourceText, ts.ScriptTarget.Latest, true, GroupExports.scriptKindFor(filePath));
    },

    /**
     * Returns the binding names of one declaration pattern.
     * @param {TsNode} pattern - Declaration name pattern.
     * @returns {string[]} Binding names.
     */
    patternNames(pattern) {
      if (ts.isIdentifier(pattern)) {
        return [pattern.text];
      }
      /** @type {string[]} */
      const names = [];
      for (const element of pattern.elements) {
        names.push(...GroupExports.patternNames(element.name));
      }
      return names;
    },

    /**
     * Returns the file scan state in declaration order of the export members.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @returns {ScanResult} Scan state with entries, removals, and skip flag.
     */
    plan(parsed, sourceText) {
      const state = GroupExports.scanState();
      for (const statement of parsed.statements) {
        GroupExports.planStatement(state, statement, parsed, sourceText);
      }
      return state;
    },

    /**
     * Merges one statement's analysis into the file scan state.
     * @param {ScanResult} state - File scan state to update.
     * @param {TsStatement} statement - Top-level statement.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @returns {void} Always ends after updating the state.
     */
    planStatement(state, statement, parsed, sourceText) {
      const analysis = GroupExports.analyzeStatement(statement);
      if (analysis.skip) {
        state.skip = true;
      }
      for (const name of analysis.names ?? []) {
        state.names.set(name, (state.names.get(name) ?? EMPTY_INDEX) + FIRST_INDEX);
      }
      for (const name of analysis.reexportNames ?? []) {
        state.reexportNames.add(name);
      }
      if ((analysis.entries ?? []).length > EMPTY_INDEX) {
        state.entries.push(...analysis.entries);
        state.removals.push(GroupExports.removalSpan(statement, parsed, sourceText));
      }
    },

    /**
     * Reads and validates one CLI target file.
     * @param {string} filePath - Target file path.
     * @returns {string} File text, or the UNCHANGED sentinel on failure.
     */
    readTarget(filePath) {
      if (filePath.length === EMPTY_INDEX) {
        console.error("Usage: node scripts/transformations/group-exports.mjs --file <path> [--dry]");
        ts.sys.exit(EXIT_FAILURE);
        return UNCHANGED;
      }
      const sourceText = ts.sys.readFile(filePath);
      if (sourceText === undefined) {
        console.error(`Missing file: ${filePath}`);
        ts.sys.exit(EXIT_FAILURE);
        return UNCHANGED;
      }
      return sourceText;
    },

    /**
     * Builds the export-keyword removal span of one statement.
     * @param {TsStatement} statement - Exported declaration statement.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @returns {EditSpan} Removal span including the following whitespace.
     */
    removalSpan(statement, parsed, sourceText) {
      const exportKeyword = (statement.modifiers ?? [])
        .find((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
      if (exportKeyword === undefined) {
        return {start: EMPTY_INDEX, end: EMPTY_INDEX};
      }
      let end = exportKeyword.getEnd();
      while (end < sourceText.length && /\s/u.test(sourceText[end])) {
        end += FIRST_INDEX;
      }
      return {end, start: exportKeyword.getStart(parsed)};
    },

    /**
     * Reports the outcome of an applied transform.
     * @param {TransformResult} result - Transform result.
     * @param {string} filePath - File path.
     * @returns {void} Always ends after reporting.
     */
    reportApplied(result, filePath) {
      if (result.changed) {
        console.log(`Updated: ${filePath}`);
        return;
      }
      console.log(`Unchanged: ${filePath}`);
    },

    /**
     * Reports the outcome of a dry-run report.
     * @param {TransformResult} result - Transform result.
     * @param {string} filePath - File path.
     * @returns {void} Always ends after reporting.
     */
    reportDry(result, filePath) {
      if (result.changed) {
        console.log(`Would change: ${filePath}`);
        return;
      }
      console.log(`Unchanged: ${filePath}`);
    },

    /**
     * Returns an empty file scan state.
     * @returns {ScanResult} Empty scan state.
     */
    scanState() {
      return {
        entries: [],
        names: new Map(),
        reexportNames: new Set(),
        removals: [],
        skip: false,
      };
    },

    /**
     * Returns the TypeScript script kind matching one file path.
     * @param {string} filePath - Source file path.
     * @returns {number} TypeScript script kind.
     */
    scriptKindFor(filePath) {
      if (filePath.endsWith(".tsx") || filePath.endsWith(".jsx")) {
        return ts.ScriptKind.TSX;
      }
      return ts.ScriptKind.TS;
    },

    /**
     * Reports whether a JSDoc body matches any name in a link or type group.
     * @param {string} text - JSDoc comment text.
     * @param {readonly string[]} names - Collected export names.
     * @returns {boolean} True when any name is referenced.
     */
    someReferencedName(text, names) {
      for (const name of names) {
        const escaped = GroupExports.escapeRegex(name);
        if (new RegExp(`\\{[^}]*\\b${escaped}\\b[^}]*\\}`, "u").test(text)) {
          return true;
        }
        if (new RegExp(`@(?:link|see)\\s+\\b${escaped}\\b`, "u").test(text)) {
          return true;
        }
      }
      return false;
    },

    /**
     * Returns an unchanged transform result.
     * @param {string} text - Source text.
     * @returns {TransformResult} Unchanged result.
     */
    unchangedResult(text) {
      return {changed: false, text};
    },
  },
  MIN_GROUP_SIZE = 2,
  UNCHANGED = "",
  runTransform = (sourceText, filePath = "x.ts") => GroupExports.fileTransform(sourceText, filePath),
  ts = (
    /** @type {typeof import("../../frontend/node_modules/typescript/lib/typescript.js")} */
    tsModule
  );

if (ts.sys.args.includes("--file") || ts.sys.args.includes("--dry")) {
  GroupExports.main();
}

export {runTransform};
