// @ts-check

import { Readable } from "node:stream";
import { once } from "node:events";
import { sourceUnitId } from "../source-units.mjs";
import { spawn } from "node:child_process";

/** @typedef {Readonly<{children?: readonly CcccFunction[], cognitive?: number, cyclomatic?: number, line?: number, name?: string}>} CcccFunction */
/** @typedef {Readonly<{functions?: readonly CcccFunction[], path: string}>} CcccFile */
/** @typedef {Readonly<{files?: readonly CcccFile[], summary?: Readonly<Record<string, unknown>>, violations?: readonly unknown[]}>} CcccReport */
/** @typedef {Readonly<{coverage: Readonly<{crap: null, state: string}>, kind: string, line?: number, metrics: Readonly<{cccc: Readonly<{cognitive?: number, cyclomatic?: number}>}>, path: string, symbol: string, unit_id: string}>} CcccUnit */
/** @typedef {Readonly<{analyzer: string, files: readonly CcccFile[], summary: Readonly<Record<string, unknown>>, units: CcccUnit[], violations: readonly unknown[]}>} NormalizedReport */
/** @typedef {Readonly<{command: readonly string[], output_limit_bytes: number, version: string}>} CcccAnalyzer */
/** @typedef {Readonly<{text: string, truncated: boolean}>} StreamResult */
/** @typedef {Readonly<Record<string, unknown>>} ReportObject */
/** @typedef {Readonly<{stderr: Readable, stdout: Readable}>} ProcessOutput */
/** @typedef {Readonly<{asRepositoryPath: (path: string) => string, createUnit: (fn: Readonly<CcccFunction>, filePath: string, repositoryRoot: string) => CcccUnit, ensurePipedOutput: (streams: readonly [Readonly<AsyncIterable<unknown>> | null, Readonly<AsyncIterable<unknown>> | null]) => ProcessOutput, flattenFiles: (files: readonly CcccFile[], repositoryRoot: string) => CcccUnit[], flattenFunctions: (functions: readonly CcccFunction[] | undefined, filePath: string, repositoryRoot: string) => CcccUnit[], isCcccReport: (value: unknown) => value is CcccReport, isReportField: (value: ReportObject, key: string, predicate: (candidate: unknown) => boolean) => boolean, isReportObject: (value: unknown) => value is ReportObject, languageForPath: (path: string) => string, normalizePath: (path: string, repositoryRoot: string) => string, normalizeProcessResult: (results: readonly [StreamResult, StreamResult, readonly unknown[]], maxBuffer: number) => {code: number, stderr: string, stdout: string}, normalizeReport: (report: Readonly<CcccReport>, repositoryRoot: string) => NormalizedReport, parseReport: (text: string) => CcccReport, readStream: (resources: readonly [Readonly<AsyncIterable<unknown>>, Readonly<{kill: () => boolean}>], maxBuffer: number) => Promise<StreamResult>, runCccc: (repositoryRoot: string, analyzer: Readonly<CcccAnalyzer>, paths?: readonly string[]) => Promise<NormalizedReport>, runProcess: (executable: string, args: readonly string[], cwd: string, maxBuffer: number) => Promise<Readonly<{code: number, stderr: string, stdout: string}>>, sourceUnitId: typeof sourceUnitId, truncateStream: (child: Readonly<{kill: () => boolean}>) => StreamResult}>} CcccHelpers */

const
  CCCC_VIOLATION_EXIT = 1,
  LAST_EVENT_INDEX = -1,
  OUTPUT_ENCODING = "utf8",
  STREAM_SIZE_START = 0,
  SUCCESS_EXIT = 0,
  /** @type {CcccHelpers} */
  sourceHelpers = {
    asRepositoryPath: (path) => path.replaceAll("\\", "/"),
    createUnit: (fn, filePath, repositoryRoot) => {
      const language = sourceHelpers.languageForPath(filePath),
        name = fn.name ?? "<anonymous>",
        path = sourceHelpers.normalizePath(filePath, repositoryRoot);
      return {
        coverage: { crap: null, state: "unknown" },
        kind: "function", line: fn.line,
        metrics: { cccc: { cognitive: fn.cognitive, cyclomatic: fn.cyclomatic } },
        path, symbol: name,
        unit_id: sourceHelpers.sourceUnitId({ kind: "function", language, path, symbol: name }),
      };
    },
    ensurePipedOutput: (streams) => {
      const [stderr, stdout] = streams;
      if (!(stdout instanceof Readable) || !(stderr instanceof Readable)) {
        throw new Error("cccc process did not expose piped output");
      }
      return { stderr, stdout };
    },
    flattenFiles: (files, repositoryRoot) => {
      /** @type {CcccUnit[]} */
      const units = [];
      for (const file of files) {
        units.push(...sourceHelpers.flattenFunctions(file.functions, file.path, repositoryRoot));
      }
      return units;
    },
    flattenFunctions: (functions, filePath, repositoryRoot) => {
      /** @type {CcccUnit[]} */
      const units = [];
      for (const fn of functions ?? []) {
        const path = sourceHelpers.normalizePath(filePath, repositoryRoot);
        units.push(sourceHelpers.createUnit(fn, path, repositoryRoot), ...sourceHelpers.flattenFunctions(fn.children, path, repositoryRoot));
      }
      return units;
    },
    /**
     * @param {unknown} value - Parsed analyzer data.
     * @returns {value is CcccReport} Whether parsed data has the CCCC report envelope.
     */
    isCcccReport: (value) =>
      sourceHelpers.isReportObject(value) &&
      sourceHelpers.isReportField(value, "files", (candidate) => Array.isArray(candidate)) &&
      sourceHelpers.isReportField(value, "summary", (candidate) => candidate instanceof Object) &&
      sourceHelpers.isReportField(value, "violations", (candidate) => Array.isArray(candidate)),
    isReportField: (value, key, predicate) => !(key in value) || predicate(value[key]),
    /** @param {unknown} value @returns {value is ReportObject} */
    isReportObject: (value) => value instanceof Object && !Array.isArray(value),
    languageForPath: (path) => {
      if (path.endsWith(".rs")) {
        return "rust";
      }
      return "ecmascript";
    },
    normalizePath: (path, repositoryRoot) => {
      const marker = `${sourceHelpers.asRepositoryPath(repositoryRoot)}/`,
        normalized = sourceHelpers.asRepositoryPath(path);
      if (normalized.startsWith(marker)) {
        return normalized.slice(marker.length);
      }
      return normalized;
    },
    normalizeProcessResult: (results, maxBuffer) => {
      const [stdoutResult, stderrResult, closeEvents] = results,
        code = Number(closeEvents.at(LAST_EVENT_INDEX));
      if (stdoutResult.truncated || stderrResult.truncated) {
        throw new Error(`cccc output exceeded ${maxBuffer} bytes`);
      }
      if (!Number.isInteger(code)) {
        throw new TypeError("cccc did not report an exit code");
      }
      return { code, stderr: stderrResult.text, stdout: stdoutResult.text };
    },
    normalizeReport: (report, repositoryRoot) => {
      const files = report.files ?? [];
      return {
        analyzer: "cccc",
        files,
        summary: report.summary ?? {},
        units: sourceHelpers.flattenFiles(files, repositoryRoot),
        violations: report.violations ?? [],
      };
    },
    parseReport: (text) => {
      try {
        /** @type {unknown} */
        const report = JSON.parse(text);
        if (!sourceHelpers.isCcccReport(report)) {
          throw new TypeError("cccc returned an invalid report envelope");
        }
        return report;
      } catch {
        throw new Error("cccc returned invalid JSON");
      }
    },
    readStream: async (resources, maxBuffer) => {
      const [stream, child] = resources, chunks = [];
      let size = STREAM_SIZE_START;
      for await (const chunk of stream) {
        const text = String(chunk); size += Buffer.byteLength(text, OUTPUT_ENCODING);
        if (size > maxBuffer) { return sourceHelpers.truncateStream(child); }
        chunks.push(text);
      }
      return { text: chunks.join(""), truncated: false };
    },
    runCccc: async (repositoryRoot, analyzer, paths = []) => {
      const [executable, ...baseArguments] = analyzer.command,
        processResult = await sourceHelpers.runProcess(executable, [...baseArguments, ...paths], repositoryRoot, analyzer.output_limit_bytes),
        report = sourceHelpers.parseReport(processResult.stdout);
      if (processResult.code !== SUCCESS_EXIT && processResult.code !== CCCC_VIOLATION_EXIT) {
        throw new Error(`cccc failed with exit ${processResult.code}`);
      }
      return sourceHelpers.normalizeReport(report, repositoryRoot);
    },
    runProcess: async (executable, args, cwd, maxBuffer) => {
      const child = spawn(executable, [...args], { cwd, env: process.env, shell: false }),
        { stderr, stdout } = sourceHelpers.ensurePipedOutput([child.stderr, child.stdout]);
      return sourceHelpers.normalizeProcessResult(await Promise.all([sourceHelpers.readStream([stdout, child], maxBuffer), sourceHelpers.readStream([stderr, child], maxBuffer), once(child, "close")]), maxBuffer);
    },
    sourceUnitId,
    truncateStream: (child) => {
      child.kill();
      return { text: "", truncated: true };
    },
  },
  { normalizeReport, runCccc } = sourceHelpers;

export { normalizeReport, runCccc };
