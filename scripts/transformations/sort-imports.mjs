// Deterministic sorter matching the repo's oxlint `eslint(sort-imports)` rule.
//
// Rule semantics (oxlint 1.80.0, default options; the repo config does not
// Override what is captured here):
//   - Only the leading import run (contiguous top-level import statements) is
//     Checked by the rule, so only that run is reordered. Files whose first
//     Statement is not an import (for example "use client" directives) contain
//     No checked imports and stay unchanged.
//   - Declaration order key: (member-syntax group index, first member's local
//     Binding name), case-sensitive, stable. Default group order is
//     None, all, multiple, single. Group classification by specifier count:
//     Zero specifiers -> none; one namespace -> all; one other -> single;
//     Two or more -> multiple.
//   - Member order key: local binding name (`x as y` sorts as `y`),
//     Case-sensitive, stable. Only named (`{ ... }`) members are reordered.
//   - Text between imports (blank lines and comments) is preserved
//     Byte-for-byte: imports move through fixed slots, trivia never moves.
//   - Member reordering is skipped when a comment appears inside the import
//     Specifier list, matching the rule's own fixer behavior.
//
// Semantics: reordering imports never changes evaluation (imports are hoisted)
// And no code outside the leading import run is touched.
//
// Usage: node scripts/transformations/sort-imports.mjs --file <path> [--dry]
import tsModule from "../../frontend/node_modules/typescript/lib/typescript.js";

/** @typedef {import("../../frontend/node_modules/typescript/lib/typescript.js").Identifier | import("../../frontend/node_modules/typescript/lib/typescript.js").ImportSpecifier | import("../../frontend/node_modules/typescript/lib/typescript.js").NamespaceImport} SpecifierNode */
/** @typedef {import("../../frontend/node_modules/typescript/lib/typescript.js").NamedImports | import("../../frontend/node_modules/typescript/lib/typescript.js").NamespaceImport} NamedBindings */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").ImportClause>} TsImportClause */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").ImportDeclaration>} TsImportDeclaration */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").SourceFile>} TsSourceFile */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").Statement>} TsStatement */
/** @typedef {{ index: number; local: string; node: SpecifierNode; role: string }} MemberEntry */
/** @typedef {{ bracesEnd: number; declaration: TsImportDeclaration; entries: readonly MemberEntry[]; firstName: string; groupIndex: number }} ImportAnalysis */
/** @typedef {{ analysis: ImportAnalysis; text: string }} AnalyzedImport */
/** @typedef {{ analysis: ImportAnalysis; index: number }} ImportPlacement */
/** @typedef {{ entry: MemberEntry; index: number }} MemberPlacement */
/** @typedef {{ head: string; membersText: string; tail: string }} MemberPieces */
/** @typedef {{ currentRegion: string; imports: readonly TsImportDeclaration[]; rebuiltRegion: string }} RegionInfo */
/** @typedef {{ dryRun: boolean; filePath: string }} CliOptions */
/** @typedef {Readonly<{ changed: boolean; text: string }>} TransformResult */

const
  ALL_GROUP_INDEX = 1,
  COMPARE_EQUAL = 0,
  COMPARE_GREATER = 1,
  COMPARE_LESS = -1,
  EMPTY_INDEX = 0,
  EXIT_FAILURE = 1,
  FIRST_INDEX = 1,
  MIN_MEMBER_COUNT = 2,
  MULTIPLE_GROUP_INDEX = 2,
  NONE_GROUP_INDEX = 0,
  SINGLE_GROUP_INDEX = 3,
  SortImports = {
    /**
     * Analyses one import declaration into rule sort keys.
     * @param {TsImportDeclaration} declaration - Import declaration.
     * @returns {ImportAnalysis} Sort keys and specifier metadata.
     */
    analyzeDeclaration(declaration) {
      const entries = SortImports.collectSpecifiers(declaration);
      return {
        bracesEnd: SortImports.bracesEndOffset(declaration),
        declaration,
        entries,
        firstName: SortImports.firstMemberName(entries),
        groupIndex: SortImports.groupIndexOf(SortImports.classifyKind(entries)),
      };
    },

    /**
     * Analyzes one candidate leading statement.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {TsStatement} statement - Candidate statement.
     * @param {string} sourceText - Full source text.
     * @returns {AnalyzedImport[]} One analyzed import, or none.
     */
    analyzedImport(parsed, statement, sourceText) {
      if (!ts.isImportDeclaration(statement)) {
        return [];
      }
      const analysis = SortImports.analyzeDeclaration(statement);
      const text = SortImports.memberOrStatementText(parsed, analysis, sourceText);
      return [{analysis, text}];
    },

    /**
     * Analyzes and sorts each leading import statement.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {readonly TsStatement[]} statements - Top-level statements.
     * @param {string} sourceText - Full source text.
     * @param {number} runLength - Number of leading import statements.
     * @returns {AnalyzedImport[]} Per-import analysis and text.
     */
    analyzedImports(parsed, statements, sourceText, runLength) {
      /** @type {AnalyzedImport[]} */
      const items = [];
      for (let index = EMPTY_INDEX; index < runLength; index += FIRST_INDEX) {
        items.push(...SortImports.analyzedImport(parsed, statements[index], sourceText));
      }
      return items;
    },

    /**
     * Converts one named bindings node into its member entries.
     * @param {NamedBindings} bindings - Named bindings node.
     * @returns {MemberEntry[]} Member entries in source order.
     */
    bindingsEntries(bindings) {
      if (ts.isNamespaceImport(bindings)) {
        return [SortImports.memberEntry(bindings.name, "namespace")];
      }
      return bindings.elements.map((element) => SortImports.memberEntry(element, "named"));
    },

    /**
     * Returns the end offset of the named binding list.
     * @param {TsImportDeclaration} declaration - Import declaration.
     * @returns {number} End offset of the named binding list.
     */
    bracesEndOffset(declaration) {
      const bindings = declaration.importClause?.namedBindings;
      if (bindings === undefined) {
        return declaration.getEnd();
      }
      return bindings.getEnd();
    },

    /**
     * Classifies specifier count into the rule's syntax group.
     * @param {readonly MemberEntry[]} entries - Declaration specifiers.
     * @returns {string} Group name: none, all, multiple, or single.
     */
    classifyKind(entries) {
      if (entries.length === EMPTY_INDEX) {
        return "none";
      }
      if (entries.length === FIRST_INDEX) {
        if (entries[EMPTY_INDEX].role === "namespace") {
          return "all";
        }
        return "single";
      }
      return "multiple";
    },

    /**
     * Collects the specifiers of one import declaration in source order.
     * @param {TsImportDeclaration} declaration - Import declaration.
     * @returns {MemberEntry[]} Member entries in source order.
     */
    collectSpecifiers(declaration) {
      const {importClause} = declaration;
      if (importClause === undefined) {
        return [];
      }
      return SortImports.memberEntries(importClause);
    },

    /**
     * Compares two import analyses for declaration ordering.
     * @param {ImportAnalysis} left - Left analysis.
     * @param {ImportAnalysis} right - Right analysis.
     * @returns {number} Negative, zero, or positive comparison result.
     */
    compareDeclarations(left, right) {
      if (left.groupIndex !== right.groupIndex) {
        return left.groupIndex - right.groupIndex;
      }
      return SortImports.compareNames(left.firstName, right.firstName);
    },

    /**
     * Compares two names with the rule's case-sensitive ordering.
     * @param {string} left - Left name.
     * @param {string} right - Right name.
     * @returns {number} Negative, zero, or positive comparison result.
     */
    compareNames(left, right) {
      if (left < right) {
        return COMPARE_LESS;
      }
      if (left > right) {
        return COMPARE_GREATER;
      }
      return COMPARE_EQUAL;
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
        SortImports.reportDry(result, filePath);
        return;
      }
      if (result.changed) {
        ts.sys.writeFile(filePath, result.text);
      }
      SortImports.reportApplied(result, filePath);
    },

    /**
     * Transforms one source file and returns its result.
     * @param {string} sourceText - Source text to transform.
     * @param {string} filePath - Source file path (used for script kind).
     * @returns {TransformResult} Transformed text plus changed flag.
     */
    fileTransform(sourceText, filePath) {
      const parsed = SortImports.parseSource(sourceText, filePath);
      const runLength = SortImports.leadingImportLength(parsed.statements);
      if (runLength === EMPTY_INDEX || parsed.parseDiagnostics.length > EMPTY_INDEX) {
        return SortImports.unchangedResult(sourceText);
      }
      const transformed = SortImports.sortedImportRegion(parsed, parsed.statements, sourceText, runLength);
      if (transformed === UNCHANGED) {
        return SortImports.unchangedResult(sourceText);
      }
      return {changed: true, text: transformed};
    },

    /**
     * Returns the local binding name of the first specifier.
     * @param {readonly MemberEntry[]} entries - Declaration specifiers.
     * @returns {string} First local name, or empty for side-effect imports.
     */
    firstMemberName(entries) {
      if (entries.length === EMPTY_INDEX) {
        return "";
      }
      return entries[EMPTY_INDEX].local;
    },

    /**
     * Maps a syntax group name to its default rule index.
     * @param {string} kind - Group name.
     * @returns {number} Group index in the default sort order.
     */
    groupIndexOf(kind) {
      if (kind === "all") {
        return ALL_GROUP_INDEX;
      }
      if (kind === "multiple") {
        return MULTIPLE_GROUP_INDEX;
      }
      if (kind === "single") {
        return SINGLE_GROUP_INDEX;
      }
      return NONE_GROUP_INDEX;
    },

    /**
     * Reports whether a comment marker appears inside a source span.
     * @param {string} source - Full source text.
     * @param {number} start - Span start offset.
     * @param {number} end - Span end offset.
     * @returns {boolean} True when the span contains a comment.
     */
    hasSpecifierComment(source, start, end) {
      const block = source.slice(start, end);
      return /\/(?:\/|\*)/u.test(block);
    },

    /**
     * Computes the trivia slots between import statements.
     * @param {readonly TsImportDeclaration[]} imports - Leading import statements.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} source - Full source text.
     * @returns {string[]} Slot texts in original position order.
     */
    importSlots(imports, parsed, source) {
      /** @type {string[]} */
      const slots = [];
      for (let index = EMPTY_INDEX; index < imports.length - FIRST_INDEX; index += FIRST_INDEX) {
        slots.push(source.slice(imports[index].getEnd(), imports[index + FIRST_INDEX].getStart(parsed)));
      }
      return slots;
    },

    /**
     * Joins sorted import statements with their original separator slots.
     * @param {readonly ImportPlacement[]} ordered - Sorted placements.
     * @param {readonly string[]} texts - Per-original-index statement texts.
     * @param {readonly string[]} slots - Slot texts in position order.
     * @returns {string} Joined import region text.
     */
    joinImports(ordered, texts, slots) {
      let text = "";
      for (let index = EMPTY_INDEX; index < ordered.length; index += FIRST_INDEX) {
        text += texts[ordered[index].index];
        if (index < slots.length) {
          text += slots[index];
        }
      }
      return text;
    },

    /**
     * Joins sorted member texts with their original separator slots.
     * @param {readonly MemberPlacement[]} sorted - Sorted placements.
     * @param {readonly MemberEntry[]} named - Original named entries.
     * @param {string} source - Full source text.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @returns {string} Joined member list text.
     */
    joinMemberText(sorted, named, source, parsed) {
      let text = "";
      for (let index = EMPTY_INDEX; index < sorted.length; index += FIRST_INDEX) {
        text += source.slice(sorted[index].entry.node.getStart(parsed), sorted[index].entry.node.getEnd());
        if (index < sorted.length - FIRST_INDEX) {
          text += source.slice(named[index].node.getEnd(), named[index + FIRST_INDEX].node.getStart(parsed));
        }
      }
      return text;
    },

    /**
     * Counts the contiguous leading import statements of a file.
     * @param {readonly TsStatement[]} statements - Top-level statements.
     * @returns {number} Number of leading import statements.
     */
    isDirectiveStatement(statement) {
      return ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression);
    },

    /**
     * Counts the contiguous import statements that begin after optional
     * "use strict"/"use client"-style directives and JSDoc preceding them.
     * @param {readonly TsStatement[]} statements - Top-level statements.
     * @returns {number} Number of import statements in the first run.
     */
    leadingImportLength(statements) {
      let index = EMPTY_INDEX;
      while (index < statements.length && SortImports.isDirectiveStatement(statements[index])) {
        index += FIRST_INDEX;
      }
      let length = EMPTY_INDEX;
      while (index < statements.length && ts.isImportDeclaration(statements[index])) {
        length += FIRST_INDEX;
        index += FIRST_INDEX;
      }
      return length;
    },

    /**
     * Runs the transform CLI over one target file.
     * @returns {void} Always ends after the file is processed.
     */
    main() {
      const {dryRun, filePath} = SortImports.parseCliArgs(ts.sys.args);
      const sourceText = SortImports.readTarget(filePath);
      if (sourceText === UNCHANGED) {
        return;
      }
      const result = SortImports.fileTransform(sourceText, filePath);
      SortImports.emitResult(result, filePath, dryRun);
    },

    /**
     * Converts one import clause into its member entries.
     * @param {TsImportClause} importClause - Import clause.
     * @returns {MemberEntry[]} Member entries in source order.
     */
    memberEntries(importClause) {
      /** @type {MemberEntry[]} */
      const entries = [];
      if (importClause.name !== undefined) {
        entries.push(SortImports.memberEntry(importClause.name, "default"));
      }
      if (importClause.namedBindings !== undefined) {
        entries.push(...SortImports.bindingsEntries(importClause.namedBindings));
      }
      return entries;
    },

    /**
     * Converts one AST specifier node into a member entry.
     * @param {SpecifierNode} node - Specifier or binding node.
     * @param {string} role - Specifier role: named, namespace, or default.
     * @returns {MemberEntry} Member entry metadata.
     */
    memberEntry(node, role) {
      return {index: EMPTY_INDEX, local: SortImports.memberLocalName(node), node, role};
    },

    /**
     * Returns the head and tail text of one import statement.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {ImportAnalysis} analysis - Import analysis.
     * @param {string} source - Full source text.
     * @param {readonly MemberEntry[]} named - Named member entries.
     * @returns {Readonly<{head: string; tail: string}>} Head and tail text.
     */
    memberHeadTail(parsed, analysis, source, named) {
      const membersStart = named[EMPTY_INDEX].node.getStart(parsed);
      const membersEnd = named[named.length - FIRST_INDEX].node.getEnd();
      const head = source.slice(analysis.declaration.getStart(parsed), membersStart);
      const tail = source.slice(membersEnd, analysis.declaration.getEnd());
      return {head, tail};
    },

    /**
     * Returns the local binding name of one specifier node.
     * @param {SpecifierNode} node - Specifier node.
     * @returns {string} Local binding name.
     */
    memberLocalName(node) {
      if (ts.isIdentifier(node)) {
        return node.text;
      }
      return node.name.text;
    },

    /**
     * Returns the member-sorted import text or the original statement text.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {ImportAnalysis} analysis - Import analysis.
     * @param {string} sourceText - Full source text.
     * @returns {string} Statement text with sorted members when applicable.
     */
    memberOrStatementText(parsed, analysis, sourceText) {
      const memberText = SortImports.rebuiltMemberText(parsed, analysis, sourceText);
      if (memberText === UNCHANGED) {
        return SortImports.statementText(parsed, analysis, sourceText);
      }
      return memberText;
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
      return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, SortImports.scriptKindFor(filePath));
    },

    /**
     * Reads and validates one CLI target file.
     * @param {string} filePath - Target file path.
     * @returns {string} File text, or the UNCHANGED sentinel on failure.
     */
    readTarget(filePath) {
      if (filePath.length === EMPTY_INDEX) {
        console.error("Usage: node scripts/transformations/sort-imports.mjs --file <path> [--dry]");
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
     * Rebuilds the whole sorted import region text.
     * @param {readonly AnalyzedImport[]} items - Per-import analysis and text.
     * @param {readonly TsImportDeclaration[]} imports - Leading import statements.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} source - Full source text.
     * @returns {string} Rebuilt import region text.
     */
    rebuildImportRegion(items, imports, parsed, source) {
      const slots = SortImports.importSlots(imports, parsed, source);
      const texts = items.map((item) => item.text);
      const ordered = items
        .map((item, index) => ({analysis: item.analysis, index}))
        .toSorted((left, right) => SortImports.compareDeclarations(left.analysis, right.analysis));
      return SortImports.joinImports(ordered, texts, slots);
    },

    /**
     * Builds the head, member list, and tail of one member-sorted import.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {ImportAnalysis} analysis - Import analysis.
     * @param {string} source - Full source text.
     * @param {readonly MemberEntry[]} named - Named member entries.
     * @returns {MemberPieces} Statement pieces.
     */
    rebuiltMemberPieces(parsed, analysis, source, named) {
      const sorted = named
        .map((entry, index) => ({entry, index}))
        .toSorted((left, right) => SortImports.compareNames(left.entry.local, right.entry.local));
      const {head, tail} = SortImports.memberHeadTail(parsed, analysis, source, named);
      const membersText = SortImports.joinMemberText(sorted, named, source, parsed);
      return {head, membersText, tail};
    },

    /**
     * Sorts the named members of one import and returns its rebuilt text.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {ImportAnalysis} analysis - Import analysis.
     * @param {string} source - Full source text.
     * @returns {string} Rebuilt statement text, or the UNCHANGED sentinel.
     */
    rebuiltMemberText(parsed, analysis, source) {
      const named = analysis.entries.filter((entry) => entry.role === "named");
      if (named.length < MIN_MEMBER_COUNT) {
        return UNCHANGED;
      }
      if (SortImports.hasSpecifierComment(source, analysis.declaration.getStart(parsed), analysis.bracesEnd)) {
        return UNCHANGED;
      }
      const sorted = named
        .map((entry, index) => ({entry, index}))
        .toSorted((left, right) => SortImports.compareNames(left.entry.local, right.entry.local));
      if (sorted.every((placement, index) => placement.index === index)) {
        return UNCHANGED;
      }
      const pieces = SortImports.rebuiltMemberPieces(parsed, analysis, source, named);
      return `${pieces.head}${pieces.membersText}${pieces.tail}`;
    },

    /**
     * Computes the leading import region bounds.
     * @param {readonly TsImportDeclaration[]} imports - Leading import statements.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @returns {Readonly<{regionEnd: number; regionStart: number}>} Region offsets.
     */
    regionBounds(imports, parsed) {
      const regionEnd = imports[imports.length - FIRST_INDEX].getEnd();
      const regionStart = imports[EMPTY_INDEX].getStart(parsed);
      return {regionEnd, regionStart};
    },

    /**
     * Builds the region comparison data for a sorted import block.
     * @param {readonly AnalyzedImport[]} items - Per-import analysis and text.
     * @param {readonly TsImportDeclaration[]} imports - Leading import statements.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} source - Full source text.
     * @returns {RegionInfo} Current and rebuilt region texts.
     */
    regionInfo(items, imports, parsed, source) {
      const rebuiltRegion = SortImports.rebuildImportRegion(items, imports, parsed, source);
      const {regionEnd, regionStart} = SortImports.regionBounds(imports, parsed);
      const currentRegion = source.slice(regionStart, regionEnd);
      return {currentRegion, imports, rebuiltRegion};
    },

    /**
     * Replaces the leading import region with its sorted text.
     * @param {string} sourceText - Full source text.
     * @param {readonly TsImportDeclaration[]} imports - Leading import statements.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} rebuiltRegion - Rebuilt import region text.
     * @returns {string} Source text with the sorted region.
     */
    replacedSource(sourceText, imports, parsed, rebuiltRegion) {
      const {regionEnd, regionStart} = SortImports.regionBounds(imports, parsed);
      return sourceText.slice(EMPTY_INDEX, regionStart) + rebuiltRegion + sourceText.slice(regionEnd);
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
     * Computes the transformed text for the leading import region.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {readonly TsStatement[]} statements - Top-level statements.
     * @param {string} sourceText - Full source text.
     * @param {number} runLength - Number of leading import statements.
     * @returns {string} Full transformed text, or the UNCHANGED sentinel.
     */
    sortedImportRegion(parsed, statements, sourceText, runLength) {
      const items = SortImports.analyzedImports(parsed, statements, sourceText, runLength);
      const imports = items.map((item) => item.analysis.declaration);
      const {currentRegion, rebuiltRegion} = SortImports.regionInfo(items, imports, parsed, sourceText);
      if (rebuiltRegion === currentRegion) {
        return UNCHANGED;
      }
      return SortImports.replacedSource(sourceText, imports, parsed, rebuiltRegion);
    },

    /**
     * Returns the original source text of one import statement.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {ImportAnalysis} analysis - Import analysis.
     * @param {string} source - Full source text.
     * @returns {string} Full statement text.
     */
    statementText(parsed, analysis, source) {
      return source.slice(analysis.declaration.getStart(parsed), analysis.declaration.getEnd());
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
  UNCHANGED = "",
  ts = (
    /** @type {typeof import("../../frontend/node_modules/typescript/lib/typescript.js")} */
    tsModule
  );

const
  INVOKED_AS_MAIN = ts.sys.args.includes("--file") || ts.sys.args.includes("--dry"),
  runTransform = (sourceText, filePath = "x.ts") => SortImports.fileTransform(sourceText, filePath);

if (INVOKED_AS_MAIN) {
  SortImports.main();
}

export {runTransform};
