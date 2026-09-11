import { execFile } from "node:child_process";
import { delimiter, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dirname, ".."),
  executable = resolve(repositoryRoot, "frontend/node_modules/.bin/oxlint"),
  localBin = resolve(repositoryRoot, "frontend/node_modules/.bin"),
  environment = { ...process.env, PATH: [localBin, process.env.PATH ?? ""].filter(Boolean).join(delimiter) },
  acceptedExitCodes = new Set([0, 1]);

const diagnosticsFrom = (text) => {
  if (!text.trim()) { return []; }
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) {
    return parsed.flatMap((entry) => Array.isArray(entry?.warnings) ? entry.warnings : []);
  }
  return Array.isArray(parsed?.diagnostics) ? parsed.diagnostics : [];
};

const run = (config, paths) => new Promise((resolveRun, rejectRun) => {
  if (paths.length === 0) { resolveRun([]); return; }
  execFile(executable, ["-c", config, "--format", "json", ...paths], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: environment,
    maxBuffer: 50 * 1024 * 1024,
  }, (error, stdout, stderr) => {
    const code = error ? Number(error.code) : 0;
    if (!acceptedExitCodes.has(code)) {
      rejectRun(new Error(`Oxlint failed with exit ${code}: ${stderr.slice(0, 500)}`));
      return;
    }
    try { resolveRun(diagnosticsFrom(stdout)); }
    catch (parseError) { rejectRun(new Error(`Oxlint returned invalid JSON: ${String(parseError)}`)); }
  });
});

const isScriptPath = (path) => path === "scripts" || path.startsWith("scripts/");

const runOxlint = async (paths) => {
  const selected = paths.length === 0 ? ["frontend", "scripts"] : paths,
    scriptPaths = selected.filter(isScriptPath),
    applicationPaths = selected.filter((path) => !isScriptPath(path)),
    [applicationDiagnostics, scriptDiagnostics] = await Promise.all([
      run(".oxlintrc.json", applicationPaths),
      run("scripts/oxlint.config.json", scriptPaths),
    ]);
  return [...applicationDiagnostics, ...scriptDiagnostics];
};

const isWarning = (diagnostic) => String(diagnostic?.severity ?? "error").toLowerCase().startsWith("warn");

const main = async () => {
  const paths = process.argv.slice(2).filter((argument) => argument !== "--json"),
    diagnostics = await runOxlint(paths),
    errors = diagnostics.filter((diagnostic) => !isWarning(diagnostic));
  process.stdout.write(JSON.stringify({ diagnostics }));
  return errors.length === 0 ? 0 : 1;
};

try {
  process.exitCode = await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}

export { diagnosticsFrom, runOxlint };
