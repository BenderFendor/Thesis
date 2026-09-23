/// <reference lib="esnext" />
import ts from "../../frontend/node_modules/typescript/lib/typescript.js";

const options: ts.CompilerOptions = {
  jsx: ts.JsxEmit.ReactJSX,
  module: ts.ModuleKind.ESNext,
  noLib: true,
  noResolve: true,
  target: ts.ScriptTarget.ESNext,
};

const serviceFor = (source: string, filePath: string): ts.LanguageService => {
  const snapshots = new Map([[filePath, ts.ScriptSnapshot.fromString(source)]]);
  return ts.createLanguageService({
    fileExists: (path) => snapshots.has(path),
    getCompilationSettings: () => options,
    getCurrentDirectory: () => "/",
    getDefaultLibFileName: () => "",
    getScriptFileNames: () => [filePath],
    getScriptSnapshot: (path) => snapshots.get(path),
    getScriptVersion: () => "0",
    readFile: (path) => snapshots.get(path)?.getText(0, source.length),
  });
};

const preserveModule = (source: string, text: string, filePath: string): string => {
  const parse = (input: string) =>
    ts.createSourceFile(filePath, input, ts.ScriptTarget.Latest, true);
  if (ts.isExternalModule(parse(source)) && !ts.isExternalModule(parse(text))) {
    return `${text}\nexport {};\n`;
  }
  return text;
};

const runTransform = (source: string, filePath = "/fixture.ts") => {
  const service = serviceFor(source, filePath);
  try {
    if (service.getSyntacticDiagnostics(filePath).length > 0) {
      return { changed: false, text: source };
    }
    const text = preserveModule(source, removeImports(service, source, filePath), filePath);
    return meaningfulChange(source, text, filePath);
  } finally {
    service.dispose();
  }
};

const meaningfulChange = (source: string, text: string, filePath: string) => {
  if (importNames(source, filePath) === importNames(text, filePath)) {
    return { changed: false, text: source };
  }
  return { changed: text !== source, text };
};

const importNames = (source: string, filePath: string): string => {
  const parsed = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true);
  return parsed.statements
    .filter(ts.isImportDeclaration)
    .map((node) => node.importClause?.getText().replaceAll(/\s/gu, "") ?? "")
    .join(";");
};

const removeImports = (
  service: Readonly<ts.LanguageService>,
  source: string,
  filePath: string,
): string => {
  const mode = ts.OrganizeImportsMode.RemoveUnused;
  const changes = service.organizeImports({ fileName: filePath, mode, type: "file" }, {}, {});
  return changes
    .flatMap((file) => file.textChanges)
    .toSorted((left, right) => right.span.start - left.span.start)
    .reduce(
      (text, { span: { start, length }, newText }) =>
        text.slice(0, start) + newText + text.slice(start + length),
      source,
    );
};

export { runTransform };
