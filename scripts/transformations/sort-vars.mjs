// TDZ-aware member sorter for ESLint's `sort-vars` rule: reorders the members
// Of a single variable declaration chain (`const A = x, B = y, C = z;`) into
// The rule's ascending order.
//
// Ordering key: the member's local binding name, case-sensitive, stable,
// Matching the repo's convention in scripts/transformations/sort-imports.mjs.
//
// Safety: a chain is reordered only when the move cannot create a
// Use-before-initialization error. A member is treated as referencing a
// Sibling when its type annotation or initializer contains that sibling's
// Binding name as a value or type reference. Property-name positions (object
// Literal keys, member-access names, class and method names) do not count;
// Shorthand properties, computed keys, parameters, and nested declarations
// Keep their reference semantics. On any forward reference - in the source
// Order or in the sorted order - the whole chain is left untouched. Chains
// Are never merged across statements, never mixed across declaration kinds,
// And members with destructuring patterns are not reordered. Comments inside
// A chain skip it, matching the sort-imports transform behavior.
//
// Usage: node scripts/transformations/sort-vars.mjs --file <path> [--dry]
import tsModule from "../../frontend/node_modules/typescript/lib/typescript.js";

/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").Node>} TsNode */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").SourceFile>} TsSourceFile */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").Statement>} TsStatement */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").VariableDeclaration>} TsVariableDeclaration */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").VariableStatement>} TsVariableStatement */
/** @typedef {{ end: number; rebuilt: string; start: number }} ChainReplacement */
/** @typedef {{ index: number; name: string }} SortedMember */
/** @typedef {{ dryRun: boolean; filePath: string }} CliOptions */
/** @typedef {Readonly<{ changed: boolean; text: string }>} TransformResult */

const
  COMPARE_EQUAL = 0,
  COMPARE_GREATER = 1,
  COMPARE_LESS = -1,
  EMPTY_INDEX = 0,
  EXIT_FAILURE = 1,
  FIRST_INDEX = 1,
  MIN_MEMBER_COUNT = 2,
  SortVars = {
    analyzeChain(statement, parsed, sourceText) {
      const {declarationList: {declarations}} = statement;
      const nameTexts = SortVars.chainNames(declarations);
      const sorted = SortVars.sortedOrder(nameTexts);
      if (nameTexts.length === EMPTY_INDEX
        || SortVars.isAlreadyOrdered(sorted)
        || SortVars.hasChainComment(statement, declarations, parsed, sourceText)) {
        return [];
      }
      if (SortVars.hasExecutingInitializer(declarations)) {
        return [];
      }
      const refsPerMember = SortVars.chainRefs(declarations, nameTexts);
      if (SortVars.hasViolation(refsPerMember, nameTexts, sorted)) {
        return [];
      }
      return [SortVars.chainReplacement(statement, declarations, sorted, parsed, sourceText)];
    },

    /**
     * Applies replacement spans from last to first into the source text.
     * @param {string} sourceText - Full source text.
     * @param {readonly ChainReplacement[]} replacements - Replacement plans.
     * @returns {string} Source text with every replaced span.
     */
    applyReplacements(sourceText, replacements) {
      let text = sourceText;
      for (let index = replacements.length - FIRST_INDEX; index >= EMPTY_INDEX; index -= FIRST_INDEX) {
        const replacement = replacements[index];
        text = text.slice(EMPTY_INDEX, replacement.start) + replacement.rebuilt + text.slice(replacement.end);
      }
      return text;
    },

    /**
     * Validates the member names of one chain and returns them.
     * @param {readonly TsVariableDeclaration[]} declarations - Chain members.
     * @returns {string[]} Member names, or none when not sortable.
     */
    chainNames(declarations) {
      if (declarations.length < MIN_MEMBER_COUNT) {
        return [];
      }
      if (!declarations.every((declaration) => ts.isIdentifier(declaration.name))) {
        return [];
      }
      const names = declarations.map((declaration) => declaration.name.text);
      if (new Set(names).size !== names.length) {
        return [];
      }
      return names;
    },

    /**
     * Collects the sibling references of every chain member.
     * @param {readonly TsVariableDeclaration[]} declarations - Chain members.
     * @param {readonly string[]} nameTexts - Member names in source order.
     * @returns {readonly ReadonlySet<string>[]} References per member.
     */
    chainRefs(declarations, nameTexts) {
      const memberNames = new Set(nameTexts);
      return declarations.map((declaration) =>
        SortVars.collectReferences(declaration, declaration.name.text, memberNames));
    },

    /**
     * Builds the replacement text for one sorted chain.
     * @param {TsVariableStatement} statement - Variable statement.
     * @param {readonly TsVariableDeclaration[]} declarations - Chain members in source order.
     * @param {readonly SortedMember[]} sorted - Members in rule order.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @returns {ChainReplacement} Replacement text and span.
     */
    chainReplacement(statement, declarations, sorted, parsed, sourceText) {
      const memberTexts = declarations.map((declaration) =>
        sourceText.slice(declaration.getStart(parsed), declaration.getEnd()));
      const separators = [];
      for (let index = EMPTY_INDEX; index < declarations.length - FIRST_INDEX; index += FIRST_INDEX) {
        separators.push(
          sourceText.slice(declarations[index].getEnd(), declarations[index + FIRST_INDEX].getStart(parsed)));
      }
      const head = sourceText.slice(statement.getStart(parsed), declarations[EMPTY_INDEX].getStart(parsed));
      const tail = sourceText.slice(
        declarations[declarations.length - FIRST_INDEX].getEnd(), statement.getEnd());
      const membersText = SortVars.joinedMembers(memberTexts, sorted, separators);
      return {
        end: statement.getEnd(),
        rebuilt: `${head}${membersText}${tail}`,
        start: statement.getStart(parsed),
      };
    },

    /**
     * Collects every replacement plan of one parsed source file.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @returns {ChainReplacement[]} Replacement plans in source order.
     */
    chainReplacements(parsed, sourceText) {
      /** @type {TsVariableStatement[]} */
      const statements = [];
      SortVars.collectVariableStatements(parsed, statements);
      /** @type {ChainReplacement[]} */
      const replacements = [];
      for (const statement of statements) {
        const replacement = SortVars.analyzeChain(statement, parsed, sourceText);
        if (replacement.length > EMPTY_INDEX) {
          replacements.push(...replacement);
        }
      }
      return replacements;
    },

    /**
     * Collects sibling binding names referenced by one member subtree.
     * @param {TsNode} root - Member declaration subtree root.
     * @param {string} ownName - The member's own binding name.
     * @param {ReadonlySet<string>} memberNames - All chain member names.
     * @returns {ReadonlySet<string>} Referenced sibling names.
     */
    collectReferences(root, ownName, memberNames) {
      /** @type {Set<string>} */
      const refs = new Set();
      const visit = (node) => {
        if (node === undefined) {
          return;
        }
        if (!ts.isIdentifier(node)) {
          SortVars.visitChildren(node, visit);
          return;
        }
        if (node.text !== ownName && memberNames.has(node.text)) {
          refs.add(node.text);
        }
      };
      visit(root);
      return refs;
    },

    /**
     * Collects every variable statement of one tree in source order.
     * @param {TsNode} node - AST node.
     * @param {TsVariableStatement[]} out - Collected statements.
     * @returns {void} Appends statements to the output array.
     */
    collectVariableStatements(node, out) {
      if (ts.isVariableStatement(node)) {
        out.push(node);
      }
      ts.forEachChild(node, (child) => {
        SortVars.collectVariableStatements(child, out);
      });
    },

    /**
     * Compares two binding names with the rule's case-sensitive ordering.
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
        SortVars.reportDry(result, filePath);
        return;
      }
      if (result.changed) {
        ts.sys.writeFile(filePath, result.text);
      }
      SortVars.reportApplied(result, filePath);
    },

    /**
     * Transforms one source file and returns its result.
     * @param {string} sourceText - Source text to transform.
     * @param {string} filePath - Source file path (used for script kind).
     * @returns {TransformResult} Transformed text plus changed flag.
     */
    fileTransform(sourceText, filePath) {
      const parsed = SortVars.parseSource(sourceText, filePath);
      if (parsed.parseDiagnostics.length > EMPTY_INDEX) {
        return SortVars.unchangedResult(sourceText);
      }
      const replacements = SortVars.chainReplacements(parsed, sourceText);
      if (replacements.length === EMPTY_INDEX) {
        return SortVars.unchangedResult(sourceText);
      }
      return {changed: true, text: SortVars.applyReplacements(sourceText, replacements)};
    },

    /**
     * Reports whether a comment appears inside the chain region.
     * @param {TsVariableStatement} statement - Variable statement.
     * @param {readonly TsVariableDeclaration[]} declarations - Chain members.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @returns {boolean} True when a comment sits between chain tokens.
     */
    hasChainComment(statement, declarations, parsed, sourceText) {
      /** @type {Array<readonly [number, number]>} */
      const regions = [[statement.getStart(parsed), declarations[EMPTY_INDEX].getStart(parsed)]];
      for (let index = EMPTY_INDEX; index < declarations.length - FIRST_INDEX; index += FIRST_INDEX) {
        regions.push([declarations[index].getEnd(), declarations[index + FIRST_INDEX].getStart(parsed)]);
      }
      regions.push([declarations[declarations.length - FIRST_INDEX].getEnd(), statement.getEnd()]);
      return regions.some(([regionStart, regionEnd]) =>
        /\/(?:\/|\*)/u.test(sourceText.slice(regionStart, regionEnd)));
    },

    /**
     * Analyses one declaration chain and returns its replacement plan.
     * @param {TsVariableStatement} statement - Variable statement.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @returns {ChainReplacement[]} Replacement plan list, or none.
     */
    /**
     * Reports whether any member initializer executes at initialization time
     * (call, construction, or await). Reordering such members changes
     * evaluation order (network/timing, subscription order), so the whole
     * chain stays untouched - the safety contract is reference-only plus
     * no-execution-order change.
     * @param {readonly TsVariableDeclaration[]} declarations - Chain members.
     * @returns {boolean} True when any initializer executes.
     */
    hasExecutingInitializer(declarations) {
      return declarations.some((declaration) => {
        const initializer = declaration.initializer;
        if (initializer === undefined) {
          return false;
        }
        if (ts.isCallExpression(initializer) || ts.isNewExpression(initializer)) {
          return true;
        }
        return ts.isAwaitExpression(initializer);
      });
    },

    /**
     * Reports whether a sorted order breaks a source-referenced member.
     * @param {readonly ReadonlySet<string>[]} refsPerMember - References per member.
     * @param {readonly string[]} nameTexts - Member names in source order.
     * @param {readonly SortedMember[]} sorted - Members in rule order.
     * @returns {boolean} True when a forward reference appears in the sorted order.
     */
    hasSortedViolation(refsPerMember, nameTexts, sorted) {
      const sortedIndexByName = new Map(sorted.map((member, index) => [member.name, index]));
      for (let index = EMPTY_INDEX; index < refsPerMember.length; index += FIRST_INDEX) {
        for (const refName of refsPerMember[index]) {
          if (sortedIndexByName.get(refName) > sortedIndexByName.get(nameTexts[index])) {
            return true;
          }
        }
      }
      return false;
    },

    /**
     * Reports whether the source order already breaks a member reference.
     * @param {readonly ReadonlySet<string>[]} refsPerMember - References per member.
     * @param {readonly string[]} nameTexts - Member names in source order.
     * @returns {boolean} True when a forward reference exists in the source.
     */
    hasSourceViolation(refsPerMember, nameTexts) {
      const indexByName = new Map(nameTexts.map((name, index) => [name, index]));
      for (let index = EMPTY_INDEX; index < refsPerMember.length; index += FIRST_INDEX) {
        for (const refName of refsPerMember[index]) {
          if (indexByName.get(refName) > index) {
            return true;
          }
        }
      }
      return false;
    },

    /**
     * Reports whether either order breaks a member reference.
     * @param {readonly ReadonlySet<string>[]} refsPerMember - References per member.
     * @param {readonly string[]} nameTexts - Member names in source order.
     * @param {readonly SortedMember[]} sorted - Members in rule order.
     * @returns {boolean} True when the source or the sorted order is unsafe.
     */
    hasViolation(refsPerMember, nameTexts, sorted) {
      return SortVars.hasSourceViolation(refsPerMember, nameTexts)
        || SortVars.hasSortedViolation(refsPerMember, nameTexts, sorted);
    },

    /**
     * Reports whether a sorted order equals the current member order.
     * @param {readonly SortedMember[]} sorted - Members in rule order.
     * @returns {boolean} True when every member is already in place.
     */
    isAlreadyOrdered(sorted) {
      return sorted.every((member, index) => member.index === index);
    },

    /**
     * Joins sorted member texts with their original separator slots.
     * @param {readonly string[]} memberTexts - Member texts in source order.
     * @param {readonly SortedMember[]} sorted - Members in rule order.
     * @param {readonly string[]} separators - Separator texts in position order.
     * @returns {string} Joined member list text.
     */
    joinedMembers(memberTexts, sorted, separators) {
      let text = "";
      for (let position = EMPTY_INDEX; position < memberTexts.length; position += FIRST_INDEX) {
        text += memberTexts[sorted[position].index];
        if (position < separators.length) {
          text += separators[position];
        }
      }
      return text;
    },

    /**
     * Runs the transform CLI over one target file.
     * @returns {void} Always ends after the file is processed.
     */
    main() {
      const {dryRun, filePath} = SortVars.parseCliArgs(ts.sys.args);
      const sourceText = SortVars.readTarget(filePath);
      if (sourceText === UNCHANGED) {
        return;
      }
      const result = SortVars.fileTransform(sourceText, filePath);
      SortVars.emitResult(result, filePath, dryRun);
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
      return ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, SortVars.scriptKindFor(filePath));
    },

    /**
     * Reads and validates one CLI target file.
     * @param {string} filePath - Target file path.
     * @returns {string} File text, or the UNCHANGED sentinel on failure.
     */
    readTarget(filePath) {
      if (filePath.length === EMPTY_INDEX) {
        console.error("Usage: node scripts/transformations/sort-vars.mjs --file <path> [--dry]");
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
     * Returns the lazily built child picker map of every reference node kind.
     * @returns {Map<number, (node: TsNode) => readonly TsNode[]>} Picker map.
     */
    referenceChildRules() {
      if (SortVars.childRules === undefined) {
        SortVars.childRules = new Map(REFERENCE_CHILD_RULES);
      }
      return SortVars.childRules;
    },

    /**
     * Returns the reference-bearing children for one AST node kind.
     * @param {TsNode} node - AST node.
     * @returns {readonly TsNode[] | undefined} Picked children, or default.
     */
    referenceChildren(node) {
      return SortVars.referenceChildRules().get(node.kind)?.(node);
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
     * Returns the member names sorted by the rule order.
     * @param {readonly string[]} nameTexts - Member names in source order.
     * @returns {SortedMember[]} Members in rule order with source indices.
     */
    sortedOrder(nameTexts) {
      return nameTexts
        .map((name, index) => ({index, name}))
        .toSorted((left, right) => SortVars.compareNames(left.name, right.name));
    },

    /**
     * Returns an unchanged transform result.
     * @param {string} text - Source text.
     * @returns {TransformResult} Unchanged result.
     */
    unchangedResult(text) {
      return {changed: false, text};
    },

    /**
     * Visits the reference children of one non-identifier node.
     * @param {TsNode} node - AST node.
     * @param {(node: TsNode) => void} visit - Child visitor.
     * @returns {void} Always ends after visiting the children.
     */
    visitChildren(node, visit) {
      const picked = SortVars.referenceChildren(node);
      if (picked !== undefined) {
        for (const child of picked) {
          visit(child);
        }
        return;
      }
      ts.forEachChild(node, (child) => {
        visit(child);
      });
    },
  },
  UNCHANGED = "",
  /**
   * Returns the reference-bearing children of one class-like node.
   * @param {TsNode} node - Class-like AST node.
   * @returns {readonly TsNode[]} Reference-bearing children.
   */
  classChildren = (node) => definedNodes([
    ...(node.typeParameters ?? []), ...(node.heritageClauses ?? []), ...(node.members ?? [])]),
  /**
   * Returns the computed name of one member, or an empty list.
   * @param {TsNode} node - Keyed member AST node.
   * @returns {readonly TsNode[]} Computed name wrap, or none.
   */
  computedName = (node) => {
    if (ts.isComputedPropertyName(node.name)) {
      return [node.name];
    }
    return [];
  },
  /**
   * Returns the type and initializer children of one declaration-like node.
   * @param {TsNode} node - Declaration-like AST node.
   * @returns {readonly TsNode[]} Reference-bearing children.
   */
  declarationChildren = (node) => definedNodes([node.type, node.initializer]),
  /**
   * Filters undefined children out of one node candidate list.
   * @param {readonly (TsNode | undefined)[]} children - Candidate nodes.
   * @returns {readonly TsNode[]} Present children.
   */
  definedNodes = (children) => children.filter((child) => child !== undefined),
  /**
   * Returns the reference-bearing children of one function-like node.
   * @param {TsNode} node - Function-like AST node.
   * @returns {readonly TsNode[]} Reference-bearing children.
   */
  functionChildren = (node) => definedNodes([
    ...(node.typeParameters ?? []), ...node.parameters, node.type, node.body]),
  /**
   * Returns the reference-bearing children of one index-signature node.
   * @param {TsNode} node - Index-signature AST node.
   * @returns {readonly TsNode[]} Reference-bearing children.
   */
  indexSignatureChildren = (node) => definedNodes([...node.parameters, node.type]),
  /**
   * Returns the reference-bearing children of one keyed member node.
   * @param {TsNode} node - Keyed member AST node.
   * @param {readonly TsNode[]} rest - Remaining candidate children.
   * @returns {readonly TsNode[]} Reference-bearing children.
   */
  keyedChildren = (node, rest) => definedNodes([...computedName(node), ...rest]),
  ts = (
    /** @type {typeof import("../../frontend/node_modules/typescript/lib/typescript.js")} */
    tsModule
  ),
  /**
   * Returns the reference-bearing children of one type-parameter node.
   * @param {TsNode} node - Type-parameter AST node.
   * @returns {readonly TsNode[]} Reference-bearing children.
   */
  typeParameterChildren = (node) => definedNodes([node.constraint, node.default]);

/** @type {ReadonlyArray<readonly [number, (node: TsNode) => readonly TsNode[]]>} */
const REFERENCE_CHILD_RULES = [
  [ts.SyntaxKind.ArrowFunction, functionChildren],
  [ts.SyntaxKind.BindingElement, declarationChildren],
  [ts.SyntaxKind.ClassDeclaration, classChildren],
  [ts.SyntaxKind.ClassExpression, classChildren],
  [ts.SyntaxKind.ComputedPropertyName, (node) => [node.expression]],
  [ts.SyntaxKind.FunctionDeclaration, functionChildren],
  [ts.SyntaxKind.FunctionExpression, functionChildren],
  [ts.SyntaxKind.GetAccessor, (node) => keyedChildren(node, [...node.parameters, node.type, node.body])],
  [ts.SyntaxKind.IndexSignature, indexSignatureChildren],
  [ts.SyntaxKind.MethodDeclaration, (node) => keyedChildren(node, [
    ...(node.typeParameters ?? []), ...node.parameters, node.type, node.body])],
  [ts.SyntaxKind.MethodSignature, (node) => keyedChildren(node, [
    ...(node.typeParameters ?? []), ...node.parameters, node.type])],
  [ts.SyntaxKind.Parameter, declarationChildren],
  [ts.SyntaxKind.PropertyAccessExpression, (node) => [node.expression]],
  [ts.SyntaxKind.PropertyAssignment, (node) => keyedChildren(node, [node.initializer])],
  [ts.SyntaxKind.PropertyDeclaration, (node) => keyedChildren(node, [
    node.type, node.initializer])],
  [ts.SyntaxKind.PropertySignature, (node) => keyedChildren(node, [node.type])],
  [ts.SyntaxKind.QualifiedName, (node) => [node.left]],
  [ts.SyntaxKind.SetAccessor, (node) => keyedChildren(node, [...node.parameters, node.type, node.body])],
  [ts.SyntaxKind.ShorthandPropertyAssignment, (node) => [node.name]],
  [ts.SyntaxKind.TypeParameter, typeParameterChildren],
  [ts.SyntaxKind.TypeQuery, (node) => [node.exprName]],
  [ts.SyntaxKind.TypeReference, (node) => [node.typeName]],
  [ts.SyntaxKind.VariableDeclaration, declarationChildren],
],
  runTransform = (sourceText, filePath = "x.ts") => SortVars.fileTransform(sourceText, filePath);

if (ts.sys.args.includes("--file") || ts.sys.args.includes("--dry")) {
  SortVars.main();
}

export {runTransform};
