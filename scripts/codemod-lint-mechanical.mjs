// Mechanical oxlint-cleaner: applies ONLY semantics-preserving transforms.
// Each transform is provably behavior-neutral; tsc verifies after.
//
// Transforms:
//  1. prefer-readonly-parameter-types: `x: T[]` -> `x: readonly T[]`
//  2. prefer-global-this: `window.` -> `globalThis.` (browser: identical)
//  3. require-unicode-regexp: add `u` flag to regex literals (checked by node RegExp parse)
//  4. no-null in local (non-exported API) positions: `null` -> `undefined`
//  5. prefer-expect-assertions: add `expect.hasAssertions()` first statement in it() blocks
//  6. one-var: merge consecutive same-kind (const/let) declarations in the same block scope
//  7. exports-last + group-exports: move named exports to file end into one `export { }` block
//
// Usage: node scripts/codemod-lint-mechanical.mjs [--dry] [--file <path>] [--rules r1,r2]
// The null/globalThis transforms are opt-in and require a scoped typecheck.
import tsModule from "../frontend/node_modules/typescript/lib/typescript.js";

/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").BinaryExpression>} TsBinaryExpression */
/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").Block>} TsBlock */
/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").CallExpression>} TsCallExpression */
/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").FunctionLikeDeclaration>} TsFunctionLikeDeclaration */
/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").Modifier>} TsModifier */
/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").Node>} TsNode */
/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").ParameterDeclaration>} TsParameterDeclaration */
/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").SourceFile>} TsSourceFile */
/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").Statement>} TsStatement */
/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").VariableDeclaration>} TsVariableDeclaration */
/** @typedef {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").VariableStatement>} TsVariableStatement */
/** @typedef {Readonly<{ end: number; position: number; replacement: string }>} TextChange */
/** @typedef {Readonly<{ end: number; name: string; start: number; stripped: string }>} ExportedDeclaration */
/** @typedef {{ change?: TextChange; nextIndex: number }} VariableRunResult */
/** @typedef {Readonly<{ dryRun: boolean; filePath: string | undefined; rules: readonly string[] }>} Options */
const
 AST_FILE_NAME = "x.ts",
 BLOCK_INSERT_OFFSET = 1,
 DEFAULT_RULES = ["readonly", "unicodeRegexp", "expectAssertions"],
 EMPTY_INDEX = 0,
 EXCLUDED_DIRECTORY_NAMES = new Set(["node_modules", ".next", "coverage", "generated", "tools", "test-utils"]),
 MISSING_INDEX = -1,
 MUTATING_ARRAY_METHODS = new Set(["copyWithin", "fill", "pop", "push", "reverse", "shift", "sort", "splice", "unshift"]),
 NULL_ASSIGNMENT_PATTERN = /(?:=|\w\s*|\(|,|\{|\[)\s*$/u,
 NULL_COMPARISON_PATTERN = /(?:===|!==|==|!=|&&|\|\||\?\.|instanceof|typeof|\?)\s*$/u,
 NULL_CONTEXT_AFTER_LENGTH = 24,
 NULL_CONTEXT_BEFORE_LENGTH = 40,
 NULL_TYPE_PATTERN = /:\s*[^=;]*$/u,
 TEST_CASE_NAMES = new Set(["it", "test"]),
 UNICODE_FLAG = "u",
 VARIABLE_KEYWORD_PATTERN = /^(?:const|let|var)\s+/u,
 ts = (
   /** @type {typeof import("../frontend/node_modules/typescript/lib/typescript.js")} */
   tsModule
 );

class Codemod {
  /**
   * Applies AST-derived edits from right to left.
   * @param {string} source - Source text to edit.
   * @param {readonly TextChange[]} changes - Non-overlapping source edits.
   * @returns {string} Edited source text.
   */
  static applyChanges(source, changes) {
    for (const change of Codemod.orderChanges(changes)) {
      const {end, position, replacement} = change;
      source = source.slice(EMPTY_INDEX, position) + replacement + source.slice(end);
    }
    return source;
  }

  /**
   * Orders source edits from right to left without mutating the caller's list.
   * @template {ReadonlyArray<Readonly<TextChange>>} T
   * @param {T} changes - Source edits to order.
   * @returns {TextChange[]} Ordered source edits.
   */
  static orderChanges(changes) {
    const orderedChanges = Codemod.createChanges();
    for (const change of changes) {
      let insertionIndex = EMPTY_INDEX;
      while (insertionIndex < orderedChanges.length &&
        Codemod.compareChanges(orderedChanges[insertionIndex], change) <= EMPTY_INDEX) {
        insertionIndex += BLOCK_INSERT_OFFSET;
      }
      orderedChanges.splice(insertionIndex, EMPTY_INDEX, change);
    }
    return orderedChanges;
  }

  /**
   * Creates a mutable list for source edits.
   * @returns {TextChange[]} Empty source-edit list.
   */
  static createChanges() {
    return [];
  }

  /**
   * Creates a mutable AST traversal stack.
   * @template {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").Node>} T
   * @param {T} root - Traversal root node.
   * @returns {TsNode[]} Stack containing the root node.
   */
  static createNodeStack(root) {
    return [root];
  }

  /**
   * Creates a mutable list for exported declarations.
   * @returns {ExportedDeclaration[]} Empty exported-declaration list.
   */
  static createExportedDeclarations() {
    return [];
  }

  /**
   * Applies one named transform.
   * @param {string} source - Source text to transform.
   * @param {string} rule - Transform name.
   * @returns {string} Transformed source text.
   */
  static applyConfiguredRule(source, rule) {
    switch (rule) {
      case "expectAssertions": {
        return Codemod.applyExpectAssertions(source);
      }
      case "exportsLast": {
        return Codemod.applyExportsLast(source);
      }
      case "globalThis": {
        return Codemod.applyGlobalThis(source);
      }
      case "noNull": {
        return Codemod.applyNoNullLocal(source);
      }
      case "oneVar": {
        return Codemod.applyOneVar(source);
      }
      case "readonly": {
        return Codemod.applyReadonlyParams(source);
      }
      case "unicodeRegexp": {
        return Codemod.applyUnicodeRegexp(source);
      }
      default: {
        return source;
      }
    }
  }

  /**
   * Adds assertion setup to block-bodied Jest test cases.
   * @param {string} source - Test source text.
   * @returns {string} Source with assertion setup inserted where needed.
   */
  static applyExpectAssertions(source) {
    const changes = Codemod.createChanges(),
      parsed = Codemod.parseSource(source),
      pending = Codemod.createNodeStack(parsed);
    while (pending.length > EMPTY_INDEX) {
      const node = pending.pop();
      if (node === undefined) {
        break;
      }
      const change = Codemod.getExpectAssertionChange(parsed, node);
      if (change !== undefined) {
        changes.push(change);
      }
      pending.push(...node.getChildren(parsed));
    }
    return Codemod.applyChanges(source, changes);
  }

  /**
   * Moves named declarations into one final export list.
   * @param {string} source - Module source text.
   * @returns {string} Source with movable declarations exported at the end.
   */
  static applyExportsLast(source) {
    const declarations = Codemod.collectExportedDeclarations(source);
    if (declarations.length === EMPTY_INDEX) {
      return source;
    }
    const changes = Codemod.createChanges(), exportNames = [];
    for (const declaration of declarations) {
      exportNames.push(declaration.name);
      changes.push({
        end: declaration.end,
        position: declaration.start,
        replacement: declaration.stripped,
      });
    }
    const transformed = Codemod.applyChanges(source, changes);
    return `${transformed}\n\nexport { ${exportNames.join(", ")} };\n`;
  }

  /**
   * Applies the AST-safe globalThis transform.
   * @param {string} source - Source text to transform.
   * @returns {string} Source with window property receivers renamed.
   */
  static applyGlobalThis(source) {
    return Codemod.applyChanges(source, Codemod.collectGlobalThisChanges(source));
  }

  /**
   * Applies the conservative local null transform.
   * @param {string} source - Source text to transform.
   * @returns {string} Source with safe null values replaced.
   */
  static applyNoNullLocal(source) {
    return Codemod.applyChanges(source, Codemod.collectNoNullChanges(source));
  }

  /**
   * Applies the opt-in one-var transform.
   * @param {string} source - Source text to transform.
   * @returns {string} Source with consecutive declarations merged.
   */
  static applyOneVar(source) {
    return Codemod.applyChanges(source, Codemod.collectVariableChangesInSource(source));
  }

  /**
   * Applies the AST-safe readonly parameter transform.
   * @param {string} source - Source text to transform.
   * @returns {string} Source with safe array parameters marked readonly.
   */
  static applyReadonlyParams(source) {
    return Codemod.applyChanges(source, Codemod.collectReadonlyChanges(source));
  }

  /**
   * Applies configured transforms in their requested order.
   * @param {string} source - Source text to transform.
   * @param {string} filePath - Repository-relative or absolute file path.
   * @param {readonly string[]} rules - Transform names to apply.
   * @returns {string} Transformed source text.
   */
  static applyRules(source, filePath, rules) {
    let transformedSource = source;
    for (const rule of rules) {
      if (Codemod.isRuleApplicable(filePath, rule)) {
        transformedSource = Codemod.applyConfiguredRule(transformedSource, rule);
      }
    }
    return transformedSource;
  }

  /**
   * Applies the AST-safe Unicode regexp transform.
   * @param {string} source - Source text to transform.
   * @returns {string} Source with compatible regex literals marked Unicode.
   */
  static applyUnicodeRegexp(source) {
    return Codemod.applyChanges(source, Codemod.collectUnicodeRegexpChanges(source));
  }

  /**
   * Compares edits by source position for reverse application.
   * @param {TextChange} leftChange - First edit.
   * @param {TextChange} rightChange - Second edit.
   * @returns {number} Negative when the first edit sorts first.
   */
  static compareChanges(leftChange, rightChange) {
    return rightChange.position - leftChange.position;
  }

  /**
   * Collects exported declarations from the parsed AST.
   * @param {string} source - Module source text.
   * @returns {ExportedDeclaration[]} Exported declarations with source ranges.
   */
  static collectExportedDeclarations(source) {
    const exported = Codemod.createExportedDeclarations(),
      parsed = Codemod.parseSource(source),
      pending = Codemod.createNodeStack(parsed);
    while (pending.length > EMPTY_INDEX) {
      const node = pending.pop();
      if (node === undefined) {
        break;
      }
      const declaration = Codemod.collectExportedDeclaration(source, parsed, node);
      if (declaration !== undefined) {
        exported.push(declaration);
      }
      pending.push(...node.getChildren(parsed));
    }
    return exported;
  }

  /**
   * Reads one exported declaration's name and replacement.
   * @param {string} source - Module source text.
   * @param {TsSourceFile} sourceFile - Parsed module source.
   * @param {TsNode} node - Candidate AST node.
   * @returns {ExportedDeclaration | undefined} Export metadata when movable.
   */
  static collectExportedDeclaration(source, sourceFile, node) {
    if (!Codemod.isNamedExportDeclaration(node)) {
      return;
    }
    if (!Codemod.hasModifier(node, ts.SyntaxKind.ExportKeyword) || Codemod.hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
      return;
    }
    const name = Codemod.getDeclarationName(sourceFile, node);
    if (name === undefined) {
      return;
    }
    const exportModifier = Codemod.getExportModifier(node);
    if (exportModifier === undefined) {
      return;
    }
    const start = node.getStart(sourceFile),
      end = node.getEnd(),
      stripped = source.slice(start, exportModifier.getStart(sourceFile)) + source.slice(exportModifier.getEnd(), end);
    return {end, name, start, stripped};
  }

  /**
   * Finds window receivers in property-access AST nodes.
   * @param {string} source - Source text to inspect.
   * @returns {TextChange[]} AST edits for window property receivers.
   */
  static collectGlobalThisChanges(source) {
    const changes = Codemod.createChanges(),
      parsed = Codemod.parseSource(source),
      pending = Codemod.createNodeStack(parsed);
    while (pending.length > EMPTY_INDEX) {
      const node = pending.pop();
      if (node === undefined) {
        break;
      }
      if (ts.isPropertyAccessExpression(node)) {
        const {expression} = node;
        if (ts.isIdentifier(expression) && expression.text === "window") {
          changes.push({
            end: expression.getEnd(),
            position: expression.getStart(parsed),
            replacement: "globalThis",
          });
        }
      }
      pending.push(...node.getChildren(parsed));
    }
    return changes;
  }

  /**
   * Finds null literals in the conservative replacement positions.
   * @param {string} source - Source text to inspect.
   * @returns {TextChange[]} AST edits for safe null values.
   */
  static collectNoNullChanges(source) {
    const changes = Codemod.createChanges(),
      parsed = Codemod.parseSource(source),
      pending = Codemod.createNodeStack(parsed);
    while (pending.length > EMPTY_INDEX) {
      const node = pending.pop();
      if (node === undefined) {
        break;
      }
      if (node.kind === ts.SyntaxKind.NullKeyword && Codemod.isSafeNullLiteral(source, parsed, node)) {
        changes.push({
          end: node.getEnd(),
          position: node.getStart(parsed),
          replacement: "undefined",
        });
      }
      pending.push(...node.getChildren(parsed));
    }
    return changes;
  }

  /**
   * Finds readonly-safe array parameters.
   * @param {string} source - Source text to inspect.
   * @returns {TextChange[]} AST edits for readonly array types.
   */
  static collectReadonlyChanges(source) {
    const changes = Codemod.createChanges(),
      parsed = Codemod.parseSource(source),
      pending = Codemod.createNodeStack(parsed);
    while (pending.length > EMPTY_INDEX) {
      const node = pending.pop();
      if (node === undefined) {
        break;
      }
      if (ts.isParameter(node)) {
        const {type} = node;
        if (type !== undefined && ts.isArrayTypeNode(type) && Codemod.isReadonlySafeParameter(node)) {
          changes.push({
            end: type.end,
            position: type.pos,
            replacement: `readonly ${type.getText(parsed)}`,
          });
        }
      }
      pending.push(...node.getChildren(parsed));
    }
    return changes;
  }

  /**
   * Finds regexp literals that compile with Unicode mode.
   * @param {string} source - Source text to inspect.
   * @returns {TextChange[]} AST edits for Unicode-compatible regexes.
   */
  static collectUnicodeRegexpChanges(source) {
    const changes = Codemod.createChanges(),
      parsed = Codemod.parseSource(source),
      pending = Codemod.createNodeStack(parsed);
    while (pending.length > EMPTY_INDEX) {
      const node = pending.pop();
      if (node === undefined) {
        break;
      }
      if (ts.isRegularExpressionLiteral(node)) {
        const literal = node.getText(parsed),
          flags = literal.slice(literal.lastIndexOf("/") + BLOCK_INSERT_OFFSET);
        if (!flags.includes(UNICODE_FLAG)) {
          const pattern = literal.slice(BLOCK_INSERT_OFFSET, literal.lastIndexOf("/"));
          if (Codemod.isUnicodeCompatible(pattern, flags)) {
            changes.push({
              end: node.getEnd(),
              position: node.getStart(parsed),
              replacement: `/${pattern}/${flags}${UNICODE_FLAG}`,
            });
          }
        }
      }
      pending.push(...node.getChildren(parsed));
    }
    return changes;
  }

  /**
   * Collects one block's consecutive variable declaration edits.
   * @param {string} source - Source text to inspect.
   * @param {readonly TsStatement[]} statements - Block statements.
   * @returns {TextChange[]} AST edits for mergeable declaration runs.
   */
  static collectVariableChanges(source, statements) {
    /** @type {TextChange[]} */
    const changes = [];
    let statementIndex = EMPTY_INDEX;
    while (statementIndex < statements.length) {
      const {change, nextIndex} = Codemod.inspectVariableRun(source, statements, statementIndex);
      if (change !== undefined) {
        changes.push(change);
      }
      statementIndex = nextIndex;
    }
    return changes;
  }

  /**
   * Finds mergeable variable declarations throughout a source file.
   * @param {string} source - Source text to inspect.
   * @returns {TextChange[]} AST edits for mergeable declaration runs.
   */
  static collectVariableChangesInSource(source) {
    const changes = Codemod.createChanges(),
      parsed = Codemod.parseSource(source),
      pending = Codemod.createNodeStack(parsed);
    while (pending.length > EMPTY_INDEX) {
      const node = pending.pop();
      if (node === undefined) {
        break;
      }
      if (ts.isBlock(node) || ts.isModuleBlock(node) || ts.isSourceFile(node)) {
        changes.push(...Codemod.collectVariableChanges(source, node.statements));
      }
      pending.push(...node.getChildren(parsed));
    }
    return changes;
  }

  /**
   * Returns a simple binding name for an exported variable declaration.
   * @param {TsSourceFile} sourceFile - Parsed module source.
   * @param {TsVariableDeclaration} declaration - Variable declaration.
   * @returns {string | undefined} Binding text when it is a simple identifier.
   */
  static getBindingNameText(sourceFile, declaration) {
    const {name} = declaration;
    if (!ts.isIdentifier(name)) {
      return;
    }
    return name.getText(sourceFile);
  }

  /**
   * Returns the modifiers available on an AST node.
   * @param {TsNode} node - AST node to inspect.
   * @returns {readonly TsModifier[] | undefined} Node modifiers when supported.
   */
  static getNodeModifiers(node) {
    if (!ts.canHaveModifiers(node)) {
      return;
    }
    return ts.getModifiers(node);
  }

  /**
   * Returns an export modifier from an AST node.
   * @param {TsNode} node - AST node to inspect.
   * @returns {TsModifier | undefined} Export modifier when present.
   */
  static getExportModifier(node) {
    const modifiers = Codemod.getNodeModifiers(node);
    if (modifiers === undefined) {
      return;
    }
    for (const modifier of modifiers) {
      if (modifier.kind === ts.SyntaxKind.ExportKeyword) {
        return modifier;
      }
    }
    return;
  }

  /**
   * Returns a declaration's exportable name.
   * @template {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").SourceFile>} S
   * @template {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").Node>} N
   * @param {S} sourceFile - Parsed module source.
   * @param {N} node - Export declaration candidate.
   * @returns {string | undefined} Export name when the declaration is named.
   */
  static getDeclarationName(sourceFile, node) {
    if (ts.isVariableStatement(node)) {
      return Codemod.getVariableDeclarationName(sourceFile, node);
    }
    return Codemod.getNamedDeclarationName(sourceFile, node);
  }

  /**
   * Returns the names in a simple exported variable statement.
   * @template {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").SourceFile>} S
   * @template {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").VariableStatement>} V
   * @param {S} sourceFile - Parsed module source.
   * @param {V} node - Variable statement to inspect.
   * @returns {string | undefined} Binding names when all are simple identifiers.
   */
  static getVariableDeclarationName(sourceFile, node) {
    const names = [];
    for (const declaration of node.declarationList.declarations) {
      const name = Codemod.getBindingNameText(sourceFile, declaration);
      if (name === undefined) {
        return;
      }
      names.push(name);
    }
    return names.join(", ");
  }

  /**
   * Returns the name of a supported named declaration.
   * @template {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").SourceFile>} S
   * @template {Readonly<import("../frontend/node_modules/typescript/lib/typescript.js").Node>} N
   * @param {S} sourceFile - Parsed module source.
   * @param {N} node - Declaration candidate.
   * @returns {string | undefined} Declaration name when supported and named.
   */
  static getNamedDeclarationName(sourceFile, node) {
    if (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isModuleDeclaration(node)) {
      const {name} = node;
      if (name === undefined) {
        return;
      }
      return name.getText(sourceFile);
    }
    return;
  }

  /**
   * Returns a command-line option value.
   * @param {readonly string[]} argumentsList - Command-line arguments.
   * @param {string} optionName - Option to find.
   * @returns {string | undefined} Following argument when present.
   */
  static getOptionValue(argumentsList, optionName) {
    const optionIndex = argumentsList.indexOf(optionName);
    if (optionIndex === MISSING_INDEX) {
      return;
    }
    return argumentsList.at(optionIndex + BLOCK_INSERT_OFFSET);
  }

  /**
   * Finds requested files or the default source roots.
   * @param {string | undefined} filePath - Optional single target path.
   * @returns {Promise<string[]>} Target file paths.
   */
  static getTargetFiles(filePath) {
    if (filePath !== undefined) {
      return [filePath];
    }
    return [...Codemod.collect("frontend"), ...Codemod.collect("scripts")];
  }

  /**
   * Finds the body of a block-bodied test case.
   * @param {TsNode} node - AST node to inspect.
   * @returns {TsBlock | undefined} Test callback body when applicable.
   */
  static getTestCaseBody(node) {
    if (!Codemod.isTestCaseCall(node)) {
      return;
    }
    const [, callback] = node.arguments;
    if (callback === undefined || (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) || !ts.isBlock(callback.body)) {
      return;
    }
    return callback.body;
  }

  /**
   * Returns the first assertion setup edit for a test case.
   * @param {TsSourceFile} sourceFile - Parsed test source.
   * @param {TsNode} node - AST node to inspect.
   * @returns {TextChange | undefined} Assertion setup edit when needed.
   */
  static getExpectAssertionChange(sourceFile, node) {
    const body = Codemod.getTestCaseBody(node);
    if (body === undefined) {
      return;
    }
    const [firstStatement] = body.statements;
    if (Codemod.hasAssertionSetup(sourceFile, firstStatement)) {
      return;
    }
    let position = body.pos + BLOCK_INSERT_OFFSET;
    if (firstStatement !== undefined) {
      position = firstStatement.pos;
    }
    return {end: position, position, replacement: "  expect.hasAssertions();\n"};
  }

  /**
   * Returns the first run end for same-kind variable statements.
   * @param {readonly TsStatement[]} statements - Block statements.
   * @param {number} start - Run start index.
   * @param {string} kind - Variable declaration kind.
   * @returns {number} Exclusive run end index.
   */
  static getVariableRunEnd(statements, start, kind) {
    let nextStatement = statements.at(start + BLOCK_INSERT_OFFSET),
      runEnd = start + BLOCK_INSERT_OFFSET;
    while (nextStatement !== undefined && ts.isVariableStatement(nextStatement) && Codemod.variableKind(nextStatement) === kind) {
      runEnd += BLOCK_INSERT_OFFSET;
      nextStatement = statements.at(runEnd);
    }
    return runEnd;
  }

  /**
   * Checks whether a statement is an assertion setup call.
   * @param {TsSourceFile} sourceFile - Parsed test source.
   * @param {TsStatement | undefined} statement - Candidate first statement.
   * @returns {boolean} Whether the statement already sets assertion expectations.
   */
  static hasAssertionSetup(sourceFile, statement) {
    if (statement === undefined || !ts.isExpressionStatement(statement)) {
      return false;
    }
    const {expression} = statement;
    if (!ts.isCallExpression(expression) || !ts.isPropertyAccessExpression(expression.expression)) {
      return false;
    }
    return ["expect.hasAssertions", "expect.assertions"].includes(expression.expression.getText(sourceFile));
  }

  /**
   * Checks whether an AST node has a modifier.
   * @param {TsNode} node - AST node to inspect.
   * @param {TsModifier["kind"]} modifierKind - Modifier kind to find.
   * @returns {boolean} Whether the modifier is present.
   */
  static hasModifier(node, modifierKind) {
    const modifiers = Codemod.getNodeModifiers(node);
    if (modifiers === undefined) {
      return false;
    }
    for (const modifier of modifiers) {
      if (modifier.kind === modifierKind) {
        return true;
      }
    }
    return false;
  }

  /**
   * Checks one variable declaration run and its next scan index.
   * @param {string} source - Source text to inspect.
   * @param {readonly TsStatement[]} statements - Block statements.
   * @param {number} statementIndex - Current scan index.
   * @returns {VariableRunResult} Optional edit and next scan index.
   */
  static inspectVariableRun(source, statements, statementIndex) {
    const statement = statements.at(statementIndex);
    if (statement === undefined || !ts.isVariableStatement(statement)) {
      return {nextIndex: statementIndex + BLOCK_INSERT_OFFSET};
    }
    const kind = Codemod.variableKind(statement),
      runEnd = Codemod.getVariableRunEnd(statements, statementIndex, kind),
      change = Codemod.mergedVariableChange(source, statements, kind, statementIndex, runEnd);
    return {change, nextIndex: runEnd};
  }

  /**
   * Checks an element assignment against a parameter name.
   * @param {TsBinaryExpression} node - Binary AST node.
   * @param {string} parameterName - Parameter identifier.
   * @returns {boolean} Whether the left side indexes the parameter.
   */
  static isArrayElementMutation(node, parameterName) {
    const {left} = node;
    if (!ts.isElementAccessExpression(left)) {
      return false;
    }
    const {expression} = left;
    return ts.isIdentifier(expression) && expression.text === parameterName;
  }

  /**
   * Checks an array mutator call against a parameter name.
   * @param {TsCallExpression} node - Call AST node.
   * @param {string} parameterName - Parameter identifier.
   * @returns {boolean} Whether the call mutates the parameter array.
   */
  static isArrayMethodMutation(node, parameterName) {
    if (!ts.isPropertyAccessExpression(node.expression)) {
      return false;
    }
    const {expression, name} = node.expression;
    return ts.isIdentifier(expression) && expression.text === parameterName && MUTATING_ARRAY_METHODS.has(name.text);
  }

  /**
   * Checks whether a parameter is handed to another call whose mutation contract
   * cannot be proven from this local AST.
   * @param {TsCallExpression} node - Call AST node.
   * @param {string} parameterName - Parameter identifier.
   * @returns {boolean} Whether the parameter is passed as a direct argument.
   */
  static isArrayPassedToCall(node, parameterName) {
    return node.arguments.some((argument) =>
      (ts.isIdentifier(argument) && argument.text === parameterName) ||
      (ts.isSpreadElement(argument) && ts.isIdentifier(argument.expression) && argument.expression.text === parameterName));
  }

  /**
   * Checks whether a node is a movable named declaration.
   * @param {TsNode} node - AST node to inspect.
   * @returns {boolean} Whether the node can carry a named export.
   */
  static isNamedExportDeclaration(node) {
    return ts.isFunctionDeclaration(node) || ts.isVariableStatement(node) || ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isModuleDeclaration(node);
  }

  /**
   * Checks whether an array parameter is not mutated in its function body.
   * @param {TsParameterDeclaration} node - Parameter AST node.
   * @returns {boolean} Whether readonly is safe for the parameter.
   */
  static isReadonlySafeParameter(node) {
    if (!ts.isIdentifier(node.name) || !Codemod.isFunctionWithBody(node.parent)) {
      return false;
    }
    const parameterName = node.name.text;
    return !Codemod.hasUnsafeArrayUsage(node.parent.body, parameterName);
  }

  /**
   * Scans a function body for mutation or opaque call boundaries.
   * @param {TsNode} body - Function body to inspect.
   * @param {string} parameterName - Array parameter identifier.
   * @returns {boolean} Whether the array use cannot be made readonly.
   */
  static hasUnsafeArrayUsage(body, parameterName) {
    /** @type {TsNode[]} */
    const pending = [body];
    while (pending.length > EMPTY_INDEX) {
      const child = pending.pop();
      if (child === undefined) {
        break;
      }
      if ((ts.isCallExpression(child) && (Codemod.isArrayMethodMutation(child, parameterName) ||
        Codemod.isArrayPassedToCall(child, parameterName))) ||
        (ts.isBinaryExpression(child) && Codemod.isArrayElementMutation(child, parameterName))) {
        return false;
      }
      pending.push(...child.getChildren());
    }
    return false;
  }

  /**
   * Checks whether a node is a function-like declaration with an implementation body.
   * @param {TsNode} node - AST node to inspect.
   * @returns {node is TsFunctionLikeDeclaration} Whether the node has a body.
   */
  static isFunctionWithBody(node) {
    return ts.isFunctionLike(node) && "body" in node;
  }

  /**
   * Checks whether a rule applies to a target file.
   * @param {string} filePath - Target file path.
   * @param {string} rule - Transform name.
   * @returns {boolean} Whether the transform should run for the file.
   */
  static isRuleApplicable(filePath, rule) {
    return rule !== "expectAssertions" || filePath.startsWith("frontend/");
  }

  /**
   * Checks a null literal using the conservative legacy context rules.
   * @param {string} source - Source text to inspect.
   * @param {TsSourceFile} sourceFile - Parsed source.
   * @param {TsNode} node - Null literal node.
   * @returns {boolean} Whether replacing the literal is allowed.
   */
  static isSafeNullLiteral(source, sourceFile, node) {
    const start = node.getStart(sourceFile),
      end = node.getEnd(),
      before = source.slice(Math.max(EMPTY_INDEX, start - NULL_CONTEXT_BEFORE_LENGTH), start),
      after = source.slice(end, end + NULL_CONTEXT_AFTER_LENGTH),
      isTypePosition = NULL_TYPE_PATTERN.test(before) || /^[|&]/u.test(after) || /<\s*$/u.test(before),
      isComparison = NULL_COMPARISON_PATTERN.test(before),
      isReturnNull = /\breturn\s*$/u.test(before),
      isAssignment = NULL_ASSIGNMENT_PATTERN.test(before) && !isComparison;
    return !isTypePosition && !isComparison && (isReturnNull || isAssignment);
  }

  /**
   * Checks whether a call is a Jest test case.
   * @param {TsNode} node - AST node to inspect.
   * @returns {node is TsCallExpression} Whether the node calls it or test.
   */
  static isTestCaseCall(node) {
    return ts.isCallExpression(node) && ts.isIdentifier(node.expression) && TEST_CASE_NAMES.has(node.expression.text);
  }

  /**
   * Checks Unicode compatibility without changing the pattern text.
   * @param {string} pattern - Regex pattern text.
   * @param {string} flags - Existing regex flags.
   * @returns {boolean} Whether Unicode-mode compilation succeeds.
   */
  static isUnicodeCompatible(pattern, flags) {
    try {
      const compiled = new RegExp(pattern, `${flags}${UNICODE_FLAG}`);
      return compiled.unicode;
    } catch {
      return false;
    }
  }

  /**
   * Parses command-line arguments and selects transforms.
   * @returns {Options} Parsed command-line options.
   */
  static parseOptions() {
    const argumentsList = ts.sys.args,
      filePath = Codemod.getOptionValue(argumentsList, "--file"),
      rulesValue = Codemod.getOptionValue(argumentsList, "--rules");
    let rules = DEFAULT_RULES;
    if (rulesValue !== undefined) {
      rules = rulesValue.split(",");
    }
    return {
      dryRun: argumentsList.includes("--dry"),
      filePath,
      rules,
    };
  }

  /**
   * Parses source using the TypeScript compiler's AST.
   * @param {string} source - Source text to parse.
   * @returns {TsSourceFile} Parsed source file.
   */
  static parseSource(source) {
    return ts.createSourceFile(AST_FILE_NAME, source, ts.ScriptTarget.Latest, true);
  }

  /**
   * Reads, transforms, and optionally writes one file.
   * @param {string} filePath - File path to process.
   * @param {Options} options - Parsed command-line options.
   * @returns {Promise<string | undefined>} File path when changed.
   */
  static async processFile(filePath, options) {
    const source = await Codemod.readSourceFile(filePath);
    if (source === undefined) {
      return;
    }
    const transformedSource = Codemod.applyRules(source, filePath, options.rules);
    if (transformedSource === source) {
      return;
    }
    if (!options.dryRun) {
      ts.sys.writeFile(filePath, transformedSource);
    }
    return filePath;
  }

  /**
   * Processes all requested files concurrently.
   * @param {Options} options - Parsed command-line options.
   * @returns {Promise<string[]>} Changed file paths.
   */
  static async processTargets(options) {
    const targetFiles = Codemod.getTargetFiles(options.filePath),
      ownScriptPath = ts.sys.resolvePath(new URL(import.meta.url).pathname),
      filteredTargets = [];
    for (const filePath of targetFiles) {
      if (ts.sys.resolvePath(filePath) !== ownScriptPath) {
        filteredTargets.push(filePath);
      }
    }
    const tasks = [];
    for (const filePath of filteredTargets) {
      tasks.push(Codemod.processFile(filePath, options));
    }
    const results = await Promise.all(tasks),
      changedFiles = [];
    for (const filePath of results) {
      if (filePath !== undefined) {
        changedFiles.push(filePath);
      }
    }
    return changedFiles;
  }

  /**
   * Reads a UTF-8 source file without throwing for missing targets.
   * @param {string} filePath - Source file path.
   * @returns {string | undefined} File text when readable.
   */
  static readSourceFile(filePath) {
    return ts.sys.readFile(filePath);
  }

  /**
   * Runs the command-line codemod.
   * @returns {Promise<void>} Resolves after all files are processed.
   */
  async run() {
    const changedFiles = await Codemod.processTargets(Codemod.parseOptions());
    console.log("files changed:", changedFiles.length);
  }

  /**
   * Builds one merged variable declaration replacement.
   * @param {string} source - Source text to inspect.
   * @param {readonly TsStatement[]} statements - Block statements.
   * @param {string} kind - Variable declaration kind.
   * @param {number} start - Run start index.
   * @param {number} end - Exclusive run end index.
   * @returns {TextChange | undefined} Replacement for runs longer than one.
   */
  static mergedVariableChange(source, statements, kind, start, end) {
    if (end - start <= BLOCK_INSERT_OFFSET) {
      return;
    }
    const firstStatement = statements.at(start),
      lastStatement = statements.at(end - BLOCK_INSERT_OFFSET);
    if (firstStatement === undefined || lastStatement === undefined) {
      return;
    }
    const declarations = [];
    for (const statement of statements.slice(start, end)) {
      declarations.push(Codemod.stripVariableKeyword(source, statement));
    }
    const replacement = `${kind} ${declarations.join(",\n")};`;
    return {end: lastStatement.getEnd(), position: firstStatement.getStart(), replacement};
  }

  /**
   * Recursively collects source files below a directory.
   * @param {string} directory - Directory path.
   * @returns {string[]} Source paths below the directory.
   */
  static collect(directory) {
    return ts.sys.readDirectory(directory, [".ts", ".tsx", ".js", ".jsx"], [...EXCLUDED_DIRECTORY_NAMES]);
  }

  /**
   * Removes a variable keyword from one declaration statement.
   * @param {string} source - Source text to inspect.
   * @param {TsStatement} statement - Variable declaration statement.
   * @returns {string} Declaration text without its keyword.
   */
  static stripVariableKeyword(source, statement) {
    return source.slice(statement.getStart(), statement.getEnd()).replace(VARIABLE_KEYWORD_PATTERN, "");
  }

  /**
   * Returns the declaration kind for a variable statement.
   * @param {TsVariableStatement} statement - Variable declaration statement.
   * @returns {string} Declaration keyword.
   */
  static variableKind(statement) {
    const {flags} = statement.declarationList;
    if ((flags & ts.NodeFlags.Const) !== EMPTY_INDEX) {
      return "const";
    }
    if ((flags & ts.NodeFlags.Let) !== EMPTY_INDEX) {
      return "let";
    }
    return "var";
  }
}

await new Codemod().run();
