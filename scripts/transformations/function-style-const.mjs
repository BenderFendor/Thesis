// Converts hoist-safe top-level module `function Name() {...}` declarations to
// Const bindings: arrow functions for clean bodies, function expressions when
// The body uses dynamic `this`, `arguments`, or `new.target`, and `function*`
// Expressions for generator declarations (generators cannot be arrows). The
// Rewrite satisfies ESLint `func-style` (prefer const arrow/fn-expression) and
// `react/function-component-definition` (named components as arrow functions).
//
// Safety: a declaration is converted only when the const binding cannot be
// Read before it initializes. Any value reference to the function name inside
// An earlier top-level statement disables the conversion - function
// Declarations are hoisted, const bindings are temporal-dead-zone guarded. A
// Reference inside the function's own body is fine: the binding initializes
// Before any body can execute, so recursion stays valid. Exported
// Declarations (export/default), body-less declarations (overload signatures,
// Ambient), and names bound elsewhere in the module (overloads, namespace
// Merges, variables) are left untouched.
//
// Form lock: arrows capture lexical `this` and never receive `arguments`, so
// A body using those (or `new.target`, or a `this` parameter) converts to a
// Function expression, preserving the same runtime semantics. `new Name()`
// Call sites require a constructable value - arrows are not constructable - so
// They also force the expression form. Generic declarations convert to
// Function expressions because a module-level generic arrow parses as JSX in
// `.tsx` files.
//
// Usage: node scripts/transformations/function-style-const.mjs --file <path> [--dry]
import tsModule from "../../frontend/node_modules/typescript/lib/typescript.js";

/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").Node>} TsNode */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").SourceFile>} TsSourceFile */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").Statement>} TsStatement */
/** @typedef {Readonly<import("../../frontend/node_modules/typescript/lib/typescript.js").FunctionDeclaration>} TsFunctionDeclaration */
/** @typedef {{ declaration: TsFunctionDeclaration; index: number; nameText: string }} Candidate */
/** @typedef {{ dryRun: boolean; filePath: string }} CliOptions */
/** @typedef {{ end: number; rebuilt: string; start: number }} Replacement */
/** @typedef {Readonly<{ changed: boolean; text: string }>} TransformResult */

const
  EMPTY_INDEX = 0,
  EXIT_FAILURE = 1,
  FIRST_INDEX = 1,
  FunctionStyleConst = {
    /**
     * Applies replacement spans from last to first into the source text.
     * @param {string} sourceText - Full source text.
     * @param {readonly Replacement[]} replacements - Replacement plans.
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
     * Returns the async keyword prefix of one declaration, if any.
     * @param {TsFunctionDeclaration} declaration - Function declaration.
     * @returns {string} "async " for async declarations, empty otherwise.
     */
    asyncPrefix(declaration) {
      if ((declaration.modifiers ?? []).some((modifier) =>
        modifier.kind === ts.SyntaxKind.AsyncKeyword)) {
        return "async ";
      }
      return "";
    },

    /**
     * Builds the binding count map of one module.
     * @param {readonly TsStatement[]} statements - Module statements.
     * @returns {Map<string, number>} Binding counts per value-space name.
     */
    bindingCounts(statements) {
      /** @type {Map<string, number>} */
      const counts = new Map();
      for (const statement of statements) {
        for (const name of FunctionStyleConst.bindingNames(statement)) {
          counts.set(name, (counts.get(name) ?? EMPTY_INDEX) + FIRST_INDEX);
        }
      }
      return counts;
    },

    /**
     * Collects the binding identifiers of one binding pattern.
     * @param {TsNode} node - Identifier or binding pattern.
     * @returns {string[]} Binding names of the pattern.
     */
    bindingIdentifiers(node) {
      if (ts.isIdentifier(node)) {
        return [node.text];
      }
      if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
        /** @type {string[]} */
        const names = [];
        for (const element of node.elements) {
          if (ts.isBindingElement(element)) {
            names.push(...FunctionStyleConst.bindingIdentifiers(element.name));
          }
        }
        return names;
      }
      return [];
    },

    /**
     * Collects the value-space binding names of one top-level statement.
     * @param {TsStatement} statement - Top-level statement.
     * @returns {string[]} Binding names, or none.
     */
    bindingNames(statement) {
      if (ts.isFunctionDeclaration(statement)
        || ts.isClassDeclaration(statement)
        || ts.isEnumDeclaration(statement)
        || ts.isModuleDeclaration(statement)) {
        return FunctionStyleConst.declarationBindingNames(statement);
      }
      if (ts.isVariableStatement(statement)) {
        /** @type {string[]} */
        const names = [];
        for (const declaration of statement.declarationList.declarations) {
          names.push(...FunctionStyleConst.bindingIdentifiers(declaration.name));
        }
        return names;
      }
      if (ts.isImportDeclaration(statement)) {
        return FunctionStyleConst.importBindings(statement);
      }
      return [];
    },

    /**
     * Reports whether one candidate converts under the reference lock.
     * @param {Candidate} candidate - Candidate declaration.
     * @param {readonly TsStatement[]} statements - Module statements.
     * @param {ReadonlyMap<string, number>} bindingCounts - Binding counts per name.
     * @returns {boolean} True when the declaration must stay untouched.
     */
    blocked(candidate, statements, bindingCounts) {
      if ((bindingCounts.get(candidate.nameText) ?? EMPTY_INDEX) > FIRST_INDEX) {
        return true;
      }
      return FunctionStyleConst.hasEarlierReference(candidate, statements);
    },

    /**
     * Builds the replacement plan of one candidate declaration.
     * @param {Candidate} candidate - Candidate declaration.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @param {readonly TsStatement[]} statements - Module statements.
     * @param {ReadonlyMap<string, number>} bindingCounts - Binding counts per name.
     * @returns {Replacement[]} Replacement plan, or none when locked.
     */
    candidateReplacement(candidate, parsed, sourceText, statements, bindingCounts) {
      if (FunctionStyleConst.blocked(candidate, statements, bindingCounts)) {
        return [];
      }
      return [{
        end: candidate.declaration.getEnd(),
        rebuilt: FunctionStyleConst.rebuiltText(candidate, parsed, sourceText),
        start: candidate.declaration.getStart(parsed),
      }];
    },

    /**
     * Collects every candidate declaration of one module.
     * @param {readonly TsStatement[]} statements - Module statements.
     * @returns {Candidate[]} Candidates in source order.
     */
    candidates(statements) {
      /** @type {Candidate[]} */
      const out = [];
      statements.forEach((statement, index) => {
        if (FunctionStyleConst.isFunctionCandidate(statement)) {
          out.push({declaration: statement, index, nameText: statement.name.text});
        }
      });
      return out;
    },

    /**
     * Reports location of `new` constructions of one name in the module.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} nameText - Function name.
     * @returns {boolean} True when `new Name(...)` appears anywhere.
     */
    constructedSomewhere(parsed, nameText) {
      let constructed = false;
      const visit = (node) => {
        if (constructed) {
          return;
        }
        if (ts.isNewExpression(node) && FunctionStyleConst.newCalleeName(node) === nameText) {
          constructed = true;
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(parsed);
      return constructed;
    },

    /**
     * Reports whether one statement subtree references the target name.
     * @param {TsNode} root - Statement subtree root.
     * @param {string} nameText - Function name.
     * @returns {boolean} True when a value reference exists.
     */
    containsValueReference(root, nameText) {
      let found = false;
      const visit = (node) => {
        if (found) {
          return;
        }
        if (ts.isIdentifier(node)
          && node.text === nameText
          && FunctionStyleConst.isValueReference(node)) {
          found = true;
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(root);
      return found;
    },

    /**
     * Reports one declaration's binding name, if it is a plain identifier.
     * @param {TsStatement} statement - Declaration statement.
     * @returns {string[]} Binding names, or none.
     */
    declarationBindingNames(statement) {
      if (statement.name === undefined || !ts.isIdentifier(statement.name)) {
        return [];
      }
      return [statement.name.text];
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
        FunctionStyleConst.reportDry(result, filePath);
        return;
      }
      if (result.changed) {
        ts.sys.writeFile(filePath, result.text);
      }
      FunctionStyleConst.reportApplied(result, filePath);
    },

    /**
     * Reports whether one candidate declaration converts to a function
     * Expression rather than an arrow function.
     * @param {Candidate} candidate - Candidate declaration.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @returns {boolean} True for expression form, false for arrow form.
     */
    expressionForm(candidate, parsed) {
      const declaration = candidate.declaration;
      if (declaration.asteriskToken !== undefined) {
        return true;
      }
      if (FunctionStyleConst.hasDynamicBinding(declaration)) {
        return true;
      }
      if (declaration.typeParameters !== undefined) {
        return true;
      }
      return FunctionStyleConst.constructedSomewhere(parsed, candidate.nameText);
    },

    /**
     * Transforms one source file and returns its result.
     * @param {string} sourceText - Source text to transform.
     * @param {string} filePath - Source file path (used for script kind).
     * @returns {TransformResult} Transformed text plus changed flag.
     */
    fileTransform(sourceText, filePath) {
      const parsed = FunctionStyleConst.parseSource(sourceText, filePath);
      if (parsed.parseDiagnostics.length > EMPTY_INDEX) {
        return FunctionStyleConst.unchangedResult(sourceText);
      }
      const replacements = FunctionStyleConst.moduleReplacements(parsed, sourceText);
      if (replacements.length === EMPTY_INDEX) {
        return FunctionStyleConst.unchangedResult(sourceText);
      }
      return {changed: true, text: FunctionStyleConst.applyReplacements(sourceText, replacements)};
    },

    /**
     * Reports whether one declaration body uses dynamic bindings.
     * @param {TsFunctionDeclaration} declaration - Function declaration.
     * @returns {boolean} True for `this`, `arguments`, or `new.target` usage.
     */
    hasDynamicBinding(declaration) {
      let dynamic = false;
      const visit = (node) => {
        if (dynamic) {
          return;
        }
        if (FunctionStyleConst.isDynamicNode(node)) {
          dynamic = true;
          return;
        }
        ts.forEachChild(node, visit);
      };
      visit(declaration);
      return dynamic;
    },

    /**
     * Reports whether an earlier top-level statement references the name.
     * @param {Candidate} candidate - Candidate declaration.
     * @param {readonly TsStatement[]} statements - Module statements.
     * @returns {boolean} True when a before-declaration reference exists.
     */
    hasEarlierReference(candidate, statements) {
      for (let index = EMPTY_INDEX; index < candidate.index; index += FIRST_INDEX) {
        if (FunctionStyleConst.containsValueReference(statements[index], candidate.nameText)) {
          return true;
        }
      }
      return false;
    },

    /**
     * Returns the value-space binding names of one import declaration.
     * @param {TsStatement} statement - Import declaration statement.
     * @returns {string[]} Local binding names, or none.
     */
    importBindings(statement) {
      const clause = statement.importClause;
      if (clause === undefined) {
        return [];
      }
      /** @type {string[]} */
      const names = [];
      if (clause.name !== undefined) {
        names.push(clause.name.text);
      }
      if (clause.namedBindings !== undefined) {
        const bindings = clause.namedBindings;
        if (ts.isNamespaceImport(bindings)) {
          names.push(bindings.name.text);
        } else if (ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            names.push(element.name.text);
          }
        }
      }
      return names;
    },

    /**
     * Reports whether one node forces the function-expression form.
     * @param {TsNode} node - AST node inside the declaration.
     * @returns {boolean} True for `this`, `new.target`, or odd `arguments`.
     */
    isDynamicNode(node) {
      if (node.kind === ts.SyntaxKind.ThisKeyword) {
        return true;
      }
      if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.NewKeyword) {
        return true;
      }
      if (!ts.isIdentifier(node)) {
        return false;
      }
      if (node.text === "this") {
        return true;
      }
      return node.text === "arguments" && FunctionStyleConst.isValueReference(node);
    },

    /**
     * Reports whether one declaration is exported.
     * @param {TsFunctionDeclaration} declaration - Function declaration.
     * @returns {boolean} True for export or export-default declarations.
     */
    isExported(declaration) {
      return (declaration.modifiers ?? []).some((modifier) =>
        modifier.kind === ts.SyntaxKind.ExportKeyword
        || modifier.kind === ts.SyntaxKind.DefaultKeyword);
    },

    /**
     * Reports whether one module statement is a convertible declaration.
     * @param {TsStatement} statement - Top-level statement.
     * @returns {boolean} True for named, body-bearing, non-exported functions.
     */
    isFunctionCandidate(statement) {
      if (!ts.isFunctionDeclaration(statement)) {
        return false;
      }
      if (statement.name === undefined || !ts.isIdentifier(statement.name)) {
        return false;
      }
      if (statement.body === undefined) {
        return false;
      }
      return !FunctionStyleConst.isExported(statement);
    },

    /**
     * Reports whether one node is a label slot rather than a value.
     * @param {TsNode} parent - Parent node.
     * @param {TsNode} node - Identifier node.
     * @returns {boolean} True for labeled, break, or continue positions.
     */
    isLabelSlot(parent, node) {
      if (parent.kind === ts.SyntaxKind.LabeledStatement && parent.label === node) {
        return true;
      }
      if (parent.kind === ts.SyntaxKind.BreakStatement
        || parent.kind === ts.SyntaxKind.ContinueStatement) {
        return true;
      }
      return false;
    },

    /**
     * Reports whether one node is a member-name slot rather than a value.
     * @param {TsNode} parent - Parent node.
     * @returns {boolean} True for property-access and JSX member names.
     */
    isMemberName(parent) {
      return MEMBER_NAME_KINDS.has(parent.kind);
    },

    /**
     * Reports whether one node sits in a metadata slot rather than a value.
     * @param {TsNode} parent - Parent node.
     * @param {TsNode} node - Identifier node.
     * @returns {boolean} True for export specifiers, JSX namespaces, meta props.
     */
    isMetadataSlot(parent, node) {
      if (METADATA_KINDS.has(parent.kind)) {
        return true;
      }
      return parent.kind === ts.SyntaxKind.BindingElement && parent.propertyName === node;
    },

    /**
     * Reports whether one node uses `.name` as a binding or member slot.
     * @param {TsNode} parent - Parent node.
     * @returns {boolean} True for declaration-like name slots.
     */
    isNameSlot(parent) {
      return NAME_SLOT_KINDS.has(parent.kind) && parent.name !== undefined;
    },

    /**
     * Reports whether one node is a qualified-name member rather than a value.
     * @param {TsNode} parent - Parent node.
     * @returns {boolean} True for the right side of a qualified name.
     */
    isQualifiedMember(parent) {
      return parent.kind === ts.SyntaxKind.QualifiedName;
    },

    /**
     * Reports whether one identifier sits in a value-reference position.
     * @param {TsNode} node - Identifier node.
     * @returns {boolean} True when the identifier reads a value.
     */
    isValueReference(node) {
      const parent = node.parent;
      if (parent === undefined) {
        return false;
      }
      if (parent.kind === ts.SyntaxKind.ShorthandPropertyAssignment) {
        return true;
      }
      if (parent.name === node
        && (FunctionStyleConst.isNameSlot(parent) || FunctionStyleConst.isMemberName(parent))) {
        return false;
      }
      if (FunctionStyleConst.isQualifiedMember(parent) && parent.right === node) {
        return false;
      }
      if (FunctionStyleConst.isLabelSlot(parent, node)
        || FunctionStyleConst.isMetadataSlot(parent, node)) {
        return false;
      }
      return true;
    },

    /**
     * Runs the transform CLI over one target file.
     * @returns {void} Always ends after the file is processed.
     */
    main() {
      const {dryRun, filePath} = FunctionStyleConst.parseCliArgs(ts.sys.args);
      const sourceText = FunctionStyleConst.readTarget(filePath);
      if (sourceText === UNCHANGED) {
        return;
      }
      const result = FunctionStyleConst.fileTransform(sourceText, filePath);
      FunctionStyleConst.emitResult(result, filePath, dryRun);
    },

    /**
     * Collects one module's replacement plans.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @returns {Replacement[]} Replacement plans in source order.
     */
    moduleReplacements(parsed, sourceText) {
      const statements = parsed.statements;
      const bindingCounts = FunctionStyleConst.bindingCounts(statements);
      /** @type {Replacement[]} */
      const replacements = [];
      for (const candidate of FunctionStyleConst.candidates(statements)) {
        replacements.push(...FunctionStyleConst.candidateReplacement(
          candidate, parsed, sourceText, statements, bindingCounts));
      }
      return replacements;
    },

    /**
     * Returns the callee name of one new expression, parenthesized or not.
     * @param {TsNode} node - New expression node.
     * @returns {string} Callee name, or empty when not a plain identifier.
     */
    newCalleeName(node) {
      let callee = node.expression;
      while (ts.isParenthesizedExpression(callee)) {
        callee = callee.expression;
      }
      if (ts.isIdentifier(callee)) {
        return callee.text;
      }
      return "";
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
        filePath, sourceText, ts.ScriptTarget.Latest, true, FunctionStyleConst.scriptKindFor(filePath));
    },

    /**
     * Reads and validates one CLI target file.
     * @param {string} filePath - Target file path.
     * @returns {string} File text, or the UNCHANGED sentinel on failure.
     */
    readTarget(filePath) {
      if (filePath.length === EMPTY_INDEX) {
        console.error("Usage: node scripts/transformations/function-style-const.mjs --file <path> [--dry]");
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
     * Builds the const binding text of one candidate declaration.
     * @param {Candidate} candidate - Candidate declaration.
     * @param {TsSourceFile} parsed - Parsed source file.
     * @param {string} sourceText - Full source text.
     * @returns {string} Replacement text.
     */
    rebuiltText(candidate, parsed, sourceText) {
      const declaration = candidate.declaration;
      const asyncText = FunctionStyleConst.asyncPrefix(declaration);
      const bodyStart = declaration.body.getStart(parsed);
      const signatureEnd = FunctionStyleConst.signatureEnd(declaration);
      const signatureText = sourceText.slice(declaration.name.end, signatureEnd);
      const between = sourceText.slice(signatureEnd, bodyStart);
      const bodyText = sourceText.slice(bodyStart, declaration.body.getEnd());
      const prefix = `const ${candidate.nameText} = `;
      if (FunctionStyleConst.expressionForm(candidate, parsed)) {
        const generatorText = declaration.asteriskToken === undefined ? "" : "*";
        return `${prefix}${asyncText}function${generatorText} ${signatureText}${between}${bodyText}`;
      }
      return `${prefix}${asyncText}${signatureText} =>${between}${bodyText}`;
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
     * Returns the end of one declaration's signature tokens.
     * @param {TsFunctionDeclaration} declaration - Function declaration.
     * @returns {number} End position of the last signature token.
     */
    signatureEnd(declaration) {
      if (declaration.type !== undefined) {
        return declaration.type.getEnd();
      }
      return declaration.parameters.end + FIRST_INDEX;
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
  /**
   * Transforms one source text and returns its result.
   * @param {string} sourceText - Source text to transform.
   * @param {string} filePath - Source file path (used for script kind).
   * @returns {TransformResult} Transformed text plus changed flag.
   */
  runTransform = (sourceText, filePath = "x.ts") =>
    FunctionStyleConst.fileTransform(sourceText, filePath),
  ts = (
    /** @type {typeof import("../../frontend/node_modules/typescript/lib/typescript.js")} */
    tsModule
  );

/** Reference-position kind sets, built once ts is initialized. */
const
  MEMBER_NAME_KINDS = new Set([
    ts.SyntaxKind.PropertyAccessExpression,
    ts.SyntaxKind.JsxAttribute,
    ts.SyntaxKind.JsxMemberExpression,
  ]),
  METADATA_KINDS = new Set([
    ts.SyntaxKind.MetaProperty,
    ts.SyntaxKind.ExportSpecifier,
    ts.SyntaxKind.JsxNamespacedName,
  ]),
  NAME_SLOT_KINDS = new Set([
    ts.SyntaxKind.VariableDeclaration,
    ts.SyntaxKind.Parameter,
    ts.SyntaxKind.FunctionDeclaration,
    ts.SyntaxKind.FunctionExpression,
    ts.SyntaxKind.ArrowFunction,
    ts.SyntaxKind.MethodDeclaration,
    ts.SyntaxKind.MethodSignature,
    ts.SyntaxKind.GetAccessor,
    ts.SyntaxKind.SetAccessor,
    ts.SyntaxKind.Constructor,
    ts.SyntaxKind.PropertyDeclaration,
    ts.SyntaxKind.PropertySignature,
    ts.SyntaxKind.ClassDeclaration,
    ts.SyntaxKind.ClassExpression,
    ts.SyntaxKind.InterfaceDeclaration,
    ts.SyntaxKind.TypeAliasDeclaration,
    ts.SyntaxKind.EnumDeclaration,
    ts.SyntaxKind.EnumMember,
    ts.SyntaxKind.ModuleDeclaration,
    ts.SyntaxKind.TypeParameter,
    ts.SyntaxKind.BindingElement,
    ts.SyntaxKind.ImportSpecifier,
    ts.SyntaxKind.ImportClause,
    ts.SyntaxKind.NamespaceImport,
    ts.SyntaxKind.PropertyAssignment,
    ts.SyntaxKind.JsxAttribute,
  ]);

if (ts.sys.args.includes("--file") || ts.sys.args.includes("--dry")) {
  FunctionStyleConst.main();
}

export {runTransform};
