/// <reference lib="esnext" />
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";

interface Bindings {
  readonly references: (name: ts.Identifier) => readonly ts.Identifier[];
  readonly symbolAt: (node: ts.Node) => ts.Symbol | undefined;
}
interface Context extends Bindings {
  readonly parsed: ts.SourceFile;
  readonly syntaxErrors: number;
}
interface Result {
  readonly changed: boolean;
  readonly rules: readonly string[];
  readonly text: string;
}

const descendants = (root: ts.Node): ts.Node[] => {
  const nodes = [root];
  ts.forEachChild(root, (child) => {
    nodes.push(...descendants(child));
  });
  return nodes;
};

const propertyName = (node: ts.Node): boolean => {
  const parent = node.parent;
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.name === node;
  }
  return ts.isPropertyAssignment(parent) && parent.name === node;
};

const parseModule = (source: string, filePath: string) => {
  const parsed = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  const options = { allowJs: true, noLib: true, noResolve: true, target: ts.ScriptTarget.ESNext };
  const files = new Map([[filePath, parsed]]);
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => files.get(name);
  const program = ts.createProgram([filePath], options, host);
  return { parsed, program };
};

const resolveSymbol = (checker: Readonly<ts.TypeChecker>, node: ts.Node): ts.Symbol | undefined => {
  if (ts.isExportSpecifier(node.parent)) {
    return checker.getExportSpecifierLocalTargetSymbol(node.parent);
  }
  if (ts.isShorthandPropertyAssignment(node.parent)) {
    return checker.getShorthandAssignmentValueSymbol(node.parent);
  }
  return checker.getSymbolAtLocation(node);
};

const context = (source: string, filePath: string): Context => {
  const { parsed, program } = parseModule(source, filePath);
  const checker = program.getTypeChecker();
  const nodes = descendants(parsed);
  const symbolAt = (node: ts.Node) => resolveSymbol(checker, node);
  return {
    parsed,
    references: (name) => nodes.filter((node) => referencesName(node, name, symbolAt)),
    symbolAt,
    syntaxErrors: program.getSyntacticDiagnostics(parsed).length,
  };
};

const referencesName = (
  node: ts.Node,
  name: ts.Identifier,
  symbolAt: Bindings["symbolAt"],
): node is ts.Identifier =>
  ts.isIdentifier(node) && !propertyName(node) && symbolAt(node) === symbolAt(name);

const functionVariable = (statement: ts.Statement): ts.Identifier | undefined => {
  if (!ts.isVariableStatement(statement) || (statement.modifiers?.length ?? 0) !== 0) {
    return undefined;
  }
  const list = statement.declarationList;
  if (list.flags !== ts.NodeFlags.Const || list.declarations.length !== 1) {
    return undefined;
  }
  return functionName(list.declarations[0]);
};

const functionName = (declaration: ts.VariableDeclaration): ts.Identifier | undefined => {
  if (
    ts.isIdentifier(declaration.name) &&
    declaration.initializer &&
    inertFunction(declaration.initializer)
  ) {
    return declaration.name;
  }
  return undefined;
};

const removableDeclaration = (
  node: ts.Node,
): node is ts.FunctionDeclaration | ts.TypeAliasDeclaration | ts.InterfaceDeclaration => {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isInterfaceDeclaration(node)
  ) {
    return (node.modifiers?.length ?? 0) === 0 && node.name !== undefined;
  }
  return false;
};

const unused = (ctx: Bindings, name: ts.Identifier, declaration: ts.Node): boolean => {
  if ((ctx.symbolAt(name)?.declarations?.length ?? 0) !== 1) {
    return false;
  }
  return ctx
    .references(name)
    .every((node) => node.pos >= declaration.pos && node.end <= declaration.end);
};

const deadDeclarations = (ctx: Bindings, source: ts.SourceFile): ts.Statement[] =>
  source.statements.filter((node) => {
    let name = functionVariable(node);
    if (removableDeclaration(node)) {
      name = node.name;
    }
    return name !== undefined && unused(ctx, name, node);
  });

const inertFunction = (node: ts.Node): boolean =>
  ts.isArrowFunction(node) || ts.isFunctionExpression(node);

const removeUnused = (source: string, filePath: string): string => {
  const ctx = context(source, filePath);
  if (skipModule(ctx, source)) {
    return source;
  }
  return deadDeclarations(ctx, ctx.parsed)
    .toReversed()
    .reduce((current, node) => current.slice(0, node.getStart()) + current.slice(node.end), source);
};

const skipModule = (ctx: Context, source: string): boolean =>
  ctx.syntaxErrors > 0 ||
  !ts.isExternalModule(ctx.parsed) ||
  /\beval\s*\(|@ts-|@typedef|@type\b/u.test(source);

const runTransform = (source: string, filePath = "fixture.ts"): Result => {
  const text = removeUnused(source, filePath);
  if (text === source) {
    return { changed: false, rules: [], text };
  }
  return { changed: true, rules: ["dead-declaration"], text: runTransform(text, filePath).text };
};

export { runTransform };
