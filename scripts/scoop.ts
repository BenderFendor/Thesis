#!/usr/bin/env node
/** Deterministic CLI for Scoop's OpenAPI and WebSocket contracts. */

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dirname, ".."),
 DEFAULT_SPEC = resolve(ROOT, "backend/openapi.json"),
 HTTP_METHODS: Record<string, true> = {
  delete: true,
  get: true,
  head: true,
  options: true,
  patch: true,
  post: true,
  put: true,
  trace: true,
},
 BOOLEAN_OPTIONS: Record<string, true> = {
  help: true,
  "include-meta": true,
  json: true,
  refresh: true,
  stream: true,
},
 REPEATABLE_OPTIONS: Record<string, true> = {
  "expect-json": true,
  header: true,
  param: true,
};

type JsonValue = undefined | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
type ParameterLocation = "path" | "query" | "header" | "cookie";

interface SchemaObject {
  type?: string | string[];
  items?: SchemaObject;
}

interface ParameterObject {
  name: string;
  in: ParameterLocation;
  required?: boolean;
  schema?: SchemaObject;
}

interface RequestBodyObject {
  required?: boolean;
  content?: Record<string, unknown>;
}

interface OperationObject {
  operationId?: string;
  summary?: string;
  tags?: string[];
  parameters?: ParameterObject[];
  requestBody?: RequestBodyObject;
  responses?: Record<string, unknown>;
}

interface PathItemObject {
  parameters?: ParameterObject[];
  [key: string]: OperationObject | ParameterObject[] | undefined;
}

export interface WebSocketOperation {
  operationId: string;
  path: string;
  summary?: string;
}

export interface OpenApiSpec {
  paths?: Record<string, PathItemObject>;
  "x-scoop-websockets"?: WebSocketOperation[];
  [key: string]: unknown;
}

export interface OperationDescriptor {
  operationId: string;
  method: string;
  path: string;
  summary: string;
  tags: string[];
  operation: OperationObject;
  pathParameters: ParameterObject[];
}

type OptionValue = string | boolean | string[] | undefined;

export interface CliOptions {
  _: string[];
  help?: boolean;
  json?: boolean;
  "include-meta"?: boolean;
  stream?: boolean;
  spec?: string;
  tag?: string;
  param?: string[];
  header?: string[];
  "expect-json"?: string[];
  "expect-status"?: string;
  "base-url"?: string;
  body?: string;
  timeout?: string;
  output?: string;
  count?: string;
  send?: string;
  [key: string]: OptionValue;
}

interface PreparedRequest {
  descriptor: OperationDescriptor;
  url: string;
  init: RequestInit;
}

export interface CallResult {
  request: PreparedRequest;
  response: Response;
  body: JsonValue | string | undefined;
}

interface SmokeCheck {
  check: string;
  expected: JsonValue;
  actual: JsonValue | undefined;
  ok: boolean;
}

export interface SmokeReport {
  ok: boolean;
  operationId: string;
  method: string;
  url: string;
  status: number;
  checks: SmokeCheck[];
  body: JsonValue | string | undefined;
}

class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message: string, exitCode = 2): never {
  throw new CliError(message, exitCode);
}

export function parseOptions(argv:readonly  string[]): CliOptions {
  const options: CliOptions = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      options._.push(token);
      continue;
    }
    index = parseOption(options, token, argv, index);
  }
  return options;
}

function parseOption(
  options: CliOptions,
  token: string,
  argv: readonly string[],
  index: number,
): number {
  const [rawKey, inlineValue] = token.slice(2).split(/=(.*)/su, 2);
  if (BOOLEAN_OPTIONS[rawKey]) {
    options[rawKey] = inlineValue === undefined ? true : inlineValue !== "false";
    return index;
  }
  const value = inlineValue ?? argv[index + 1];
  if (value === undefined) {fail(`Missing value for --${rawKey}`);}
  if (REPEATABLE_OPTIONS[rawKey]) {
    const current = options[rawKey];
    options[rawKey] = [...(Array.isArray(current) ? current : []), value];
  } else {
    options[rawKey] = value;
  }
  return inlineValue === undefined ? index + 1 : index;
}

export function loadSpec(specPath = DEFAULT_SPEC): OpenApiSpec {
  return JSON.parse(readFileSync(resolve(specPath), "utf8")) as OpenApiSpec;
}

function listPathOperations(path: string, pathItem: PathItemObject): OperationDescriptor[] {
  const operations: OperationDescriptor[] = [];
  for (const [method, value] of Object.entries(pathItem)) {
    if (!HTTP_METHODS[method] || Array.isArray(value) || value === undefined) {continue;}
    const operation = value;
    if (!operation.operationId) {fail(`OpenAPI operation is missing operationId: ${method.toUpperCase()} ${path}`);}
    operations.push({
      method: method.toUpperCase(),
      operation,
      operationId: operation.operationId,
      path,
      pathParameters: pathItem.parameters ?? [],
      summary: operation.summary ?? "",
      tags: operation.tags ?? [],
    });
  }
  return operations;
}

export function listOperations(spec: OpenApiSpec): OperationDescriptor[] {
  const operations = Object.entries(spec.paths ?? {}).flatMap(([path, pathItem]) =>
    listPathOperations(path, pathItem),
  );
  return operations.sort((left, right) => left.operationId.localeCompare(right.operationId));
}

export function listWebSockets(spec: OpenApiSpec): WebSocketOperation[] {
  return [...(spec["x-scoop-websockets"] ?? [])].sort((left, right) =>
    left.operationId.localeCompare(right.operationId),
  );
}

function findOperation(spec: OpenApiSpec, operationId: string): OperationDescriptor {
  const operation = listOperations(spec).find((item) => item.operationId === operationId);
  if (!operation) {fail(`Unknown operationId: ${operationId}`);}
  return operation;
}

function splitAssignment(value: string, label: string): [string, string] {
  const separator = value.indexOf("=");
  if (separator < 1) {fail(`${label} must use name=value: ${value}`);}
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function assignments(values:readonly  string[] = []): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const item of values) {
    const [name, value] = splitAssignment(item, "Assignment");
    result.set(name, [...(result.get(name) ?? []), value]);
  }
  return result;
}

function schemaType(schema: SchemaObject = {}): string | undefined {
  return Array.isArray(schema.type) ? schema.type.find((value) => value !== "null") : schema.type;
}

function coerceScalar(value: string, schema: SchemaObject, name: string): JsonValue {
  const type = schemaType(schema);
  if (type === "boolean") {
    if (value === "true") {return true;}
    if (value === "false") {return false;}
    fail(`Parameter ${name} must be true or false`);
  }
  if (type === "integer") {
    if (!/^-?\d+$/u.test(value)) {fail(`Parameter ${name} must be an integer`);}
    return Number(value);
  }
  if (type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) {fail(`Parameter ${name} must be a number`);}
    return number;
  }
  if (type === "object") {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      fail(`Parameter ${name} must be valid JSON`);
    }
  }
  return value;
}

function serializeParameter(parameter: ParameterObject, values:readonly  string[]): JsonValue | JsonValue[] {
  const schema = parameter.schema ?? {};
  if (schemaType(schema) === "array") {
    return values
      .flatMap((value) => value.split(","))
      .map((value) => coerceScalar(value, schema.items ?? {}, parameter.name));
  }
  return coerceScalar(values.at(-1) ?? "", schema, parameter.name);
}

function requestBody(rawBody: string | undefined): JsonValue | undefined {
  if (rawBody === undefined) {return undefined;}
  const text = rawBody.startsWith("@")
    ? readFileSync(resolve(rawBody.slice(1)), "utf8")
    : rawBody;
  try {
    return JSON.parse(text) as JsonValue;
  } catch {
    fail("--body must be JSON or @path-to-json");
  }
}

interface RequestTarget {
  path: string;
  query: URLSearchParams;
  headers: Headers;
  cookies: string[];
}

function applyParameter(
  target: RequestTarget,
  parameter: ParameterObject,
  value: JsonValue | JsonValue[],
): void {
  if (parameter.in === "path") {
    target.path = target.path.replace(`{${parameter.name}}`, encodeURIComponent(String(value)));
    return;
  }
  if (parameter.in === "query") {
    for (const item of Array.isArray(value) ? value : [value]) {
      target.query.append(parameter.name, String(item));
    }
    return;
  }
  if (parameter.in === "header") {
    target.headers.set(parameter.name, Array.isArray(value) ? value.join(",") : String(value));
    return;
  }
  if (parameter.in === "cookie") {
    target.cookies.push(`${parameter.name}=${encodeURIComponent(String(value))}`);
  }
}

function validateParameters(
  parameters:readonly  ParameterObject[],
  supplied: Map<string, string[]>,
  operationId: string,
): void {
  const known = new Set(parameters.map((parameter) => parameter.name));
  for (const name of supplied.keys()) {
    if (!known.has(name)) {fail(`Unknown parameter for ${operationId}: ${name}`);}
  }
}

function applyOperationParameters(
  target: RequestTarget,
  parameters:readonly  ParameterObject[],
  supplied: Map<string, string[]>,
): void {
  for (const parameter of parameters) {
    const values = supplied.get(parameter.name);
    if (!values?.length) {
      if (parameter.required) {fail(`Missing required parameter: ${parameter.name}`);}
      continue;
    }
    applyParameter(target, parameter, serializeParameter(parameter, values));
  }
}

function applyRequestHeaders(target: RequestTarget, options: CliOptions): void {
  for (const item of options.header ?? []) {
    const [name, value] = splitAssignment(item, "Header");
    target.headers.set(name, value);
  }
  if (target.cookies.length > 0) {target.headers.set("Cookie", target.cookies.join("; "));}
}

function applyRequestBody(
  target: RequestTarget,
  descriptor: OperationDescriptor,
  options: CliOptions,
  operationId: string,
): JsonValue | undefined {
  const body = requestBody(options.body);
  if (descriptor.operation.requestBody?.required === true && body === undefined) {
    fail(`Missing required --body for ${operationId}`);
  }
  if (body !== undefined) {target.headers.set("Content-Type", "application/json");}
  return body;
}

export function prepareRequest(
  spec: OpenApiSpec,
  operationId: string,
  options: CliOptions = { _: [] },
): PreparedRequest {
  const descriptor = findOperation(spec, operationId),
   supplied = assignments(options.param),
   parameters = [...descriptor.pathParameters, ...(descriptor.operation.parameters ?? [])];
  validateParameters(parameters, supplied, operationId);

  const target: RequestTarget = {
    cookies: [],
    headers: new Headers({ Accept: "application/json" }),
    path: descriptor.path,
    query: new URLSearchParams(),
  };
  applyOperationParameters(target, parameters, supplied);
  applyRequestHeaders(target, options);
  const body = applyRequestBody(target, descriptor, options, operationId),

   baseUrl = options["base-url"] ?? process.env.SCOOP_API_URL ?? "http://127.0.0.1:8000",
   queryString = target.query.toString();
  return {
    descriptor,
    init: {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: target.headers,
      method: descriptor.method,
    },
    url: `${baseUrl.replace(/\/$/u, "")}${target.path}${queryString ? `?${queryString}` : ""}`,
  };
}

async function responseBody(response: Response): Promise<JsonValue | string> {
  const bytes = Buffer.from(await response.arrayBuffer()),
   text = bytes.toString("utf8");
  if (response.headers.get("content-type")?.includes("json")) {
    try {
      return JSON.parse(text) as JsonValue;
    } catch {
      return text;
    }
  }
  return text;
}

function printValue(value: unknown, output = "pretty"): void {
  if (typeof value === "string") {
    process.stdout.write(value.endsWith("\n") ? value : `${value}\n`);
    return;
  }
  process.stdout.write(`${JSON.stringify(value, undefined, output === "json" ? 0 : 2)}\n`);
}

export async function callOperation(
  spec: OpenApiSpec,
  operationId: string,
  options: CliOptions = { _: [] },
  fetchImpl: typeof fetch = fetch,
): Promise<CallResult> {
  const request = prepareRequest(spec, operationId, options),
   timeoutSeconds = Number(options.timeout ?? 30);
  if (!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) {fail("--timeout must be positive");}
  const response = await fetchImpl(request.url, {
    ...request.init,
    signal: AbortSignal.timeout(timeoutSeconds * 1000),
  });

  if (options.stream) {
    if (!response.body) {fail("Response has no stream", 1);}
    for await (const chunk of response.body) {process.stdout.write(chunk);}
    return { body: undefined, request, response };
  }
  return { body: await responseBody(response), request, response };
}

function jsonPointer(value: unknown, pointer: string): JsonValue | undefined {
  if (pointer === "") {return value as JsonValue;}
  if (!pointer.startsWith("/")) {fail(`JSON pointer must start with /: ${pointer}`);}
  let current: unknown = value;
  for (const rawPart of pointer.slice(1).split("/")) {
    const part = rawPart.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      current = current[Number(part)];
    } else if (current !== null && typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current as JsonValue | undefined;
}

function expectedValue(raw: string): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    return raw;
  }
}

export function evaluateSmoke(result: CallResult, options: CliOptions = { _: [] }): SmokeReport {
  const expectedStatuses = String(options["expect-status"] ?? "200")
    .split(",")
    .map(Number),
   checks: SmokeCheck[] = [
    {
      actual: result.response.status,
      check: "status",
      expected: expectedStatuses,
      ok: expectedStatuses.includes(result.response.status),
    },
  ];
  for (const raw of options["expect-json"] ?? []) {
    const [pointer, expectedRaw] = splitAssignment(raw, "--expect-json"),
     expected = expectedValue(expectedRaw),
     actual = jsonPointer(result.body, pointer);
    checks.push({
      actual,
      check: `json:${pointer}`,
      expected,
      ok: JSON.stringify(actual) === JSON.stringify(expected),
    });
  }
  return {
    body: result.body,
    checks,
    method: result.request.descriptor.method,
    ok: checks.every((check) => check.ok),
    operationId: result.request.descriptor.operationId,
    status: result.response.status,
    url: result.request.url,
  };
}

async function listenWebSocket(
  spec: OpenApiSpec,
  operationIdOrPath: string,
  options: CliOptions,
): Promise<{ connected: boolean; received: number; url: string }> {
  const descriptor = listWebSockets(spec).find(
    (item) => item.operationId === operationIdOrPath || item.path === operationIdOrPath,
  );
  if (!descriptor) {fail(`Unknown WebSocket operation or path: ${operationIdOrPath}`);}
  const baseUrl = options["base-url"] ?? process.env.SCOOP_API_URL ?? "http://127.0.0.1:8000",
   socketUrl = `${baseUrl.replace(/^http/u, "ws").replace(/\/$/u, "")}${descriptor.path}`,
   count = Number(options.count ?? 1),
   timeoutMs = Number(options.timeout ?? 30) * 1000,

   { promise, resolve: resolvePromise, reject: rejectPromise } =
    Promise.withResolvers<{ connected: boolean; received: number; url: string }>(),
   socket = new WebSocket(socketUrl);
  let connected = false,
   received = 0;
  const timer = setTimeout(() => {
    socket.close();
    rejectPromise(new Error(`WebSocket timed out after ${timeoutMs / 1000}s`));
  }, timeoutMs);
  socket.addEventListener("open", () => {
    connected = true;
    if (options.send !== undefined) {socket.send(options.send);}
    if (count === 0) {socket.close(1000);}
  });
  socket.addEventListener("message", (event: MessageEvent<unknown>) => {
    received += 1;
    let value: JsonValue | string = String(event.data);
    try {
      value = JSON.parse(String(event.data)) as JsonValue;
    } catch {
      // Preserve non-JSON messages exactly as received.
    }
    printValue(value, options.output);
    if (received >= count) {socket.close(1000);}
  });
  socket.addEventListener("close", () => {
    clearTimeout(timer);
    if (connected && received >= count) {resolvePromise({ connected, received, url: socketUrl });}
    else {rejectPromise(new Error(`WebSocket closed after ${received} messages`));}
  });
  socket.addEventListener("error", () => {
    clearTimeout(timer);
    rejectPromise(new Error(`WebSocket connection failed: ${socketUrl}`));
  });
  return promise;
}


function runSchemaCommand(action: "check" | "export" | "refresh", options: CliOptions): number {
  const args = ["-m", "scripts.export_openapi"];
  if (action === "check") {args.push("--check");}
  if (options.output) {args.push("--output", resolve(options.output));}
  const virtualenvPython = resolve(ROOT, "backend/.venv/bin/python"),
   python = existsSync(virtualenvPython) ? virtualenvPython : "python3",
   result = spawnSync(python, args, {
    cwd: resolve(ROOT, "backend"),
    env: { ...process.env, PYTHONPATH: resolve(ROOT, "backend") },
    stdio: "inherit",
  });
  if (result.error) {fail(result.error.message, 1);}
  if (result.status !== 0) {return result.status ?? 1;}
  if (action !== "refresh") {return 0;}
  return spawnSync("npm", ["--prefix", "frontend", "run", "openapi:types"], {
    cwd: ROOT,
    stdio: "inherit",
  }).status ?? 1;
}

interface InvestigateWorkflow {
  operationId: string;
  /** When true, the target name is placed in the JSON request body */
  useBody: boolean;
  /** CLI option keys to lift into the body (e.g. "website" -> body.website) */
  bodyOptionKeys?: string[];
  /** CLI option names mapped to generated OpenAPI parameter names */
  parameterOptions?: Record<string, string>;
  /** Parameter name for the target when it goes in path/query rather than body */
  targetParam?: string;
  /** Human-readable summary for usage */
  summary?: string;
}

const INVESTIGATE_WORKFLOWS: Record<string, InvestigateWorkflow> = {
  organization: {
    bodyOptionKeys: ["website"],
    operationId: "research_organization_research_entity_organization_research_post",
    parameterOptions: {},
    summary: "Research a news organization's funding, ownership, and profile",
    useBody: true,
  },
  ownership: {
    operationId: "get_ownership_chain_research_entity_organization__org_name__ownership_chain_get",
    parameterOptions: { "max-depth": "max_depth" },
    summary: "Get the ownership chain for an organization",
    targetParam: "org_name",
    useBody: false,
  },
  reporter: {
    bodyOptionKeys: ["organization"],
    operationId: "profile_reporter_research_entity_reporter_profile_post",
    parameterOptions: {},
    summary: "Profile a reporter or journalist",
    useBody: true,
  },
  source: {
    bodyOptionKeys: ["website"],
    operationId: "research_source_profile_research_entity_source_profile_post",
    parameterOptions: {},
    summary: "Build a source profile with funding, ownership, bias, and metadata",
    useBody: true,
  },
};

function investigateParameters(
  workflow: InvestigateWorkflow,
  target: string,
  options: CliOptions,
): string[] {
  const params: string[] = [...(options.param ?? [])];

  // Forward --refresh to force_refresh query parameter
  if (options.refresh && workflow.useBody) {params.push("force_refresh=true");}

  for (const [optionKey, parameterName] of Object.entries(workflow.parameterOptions ?? {})) {
    const cliValue = options[optionKey];
    if (cliValue !== undefined) {params.push(`${parameterName}=${String(cliValue)}`);}
  }
  // Set target as path/query parameter for GET operations
  if (workflow.targetParam) {
    params.push(`${workflow.targetParam}=${target}`);
  }
  return params;
}

function investigateBody(workflow: InvestigateWorkflow, target: string, options: CliOptions): string | undefined {
  if (!workflow.useBody) {return undefined;}
  const body: Record<string, unknown> = { name: target };
  for (const optionKey of workflow.bodyOptionKeys ?? []) {
    const value = options[optionKey];
    if (value !== undefined) {body[optionKey] = value;}
  }
  return JSON.stringify(body);
}

export async function runInvestigateCommand(
  spec: OpenApiSpec,
  subcommand: string,
  target: string,
  options: CliOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const workflow = INVESTIGATE_WORKFLOWS[subcommand];
  if (!workflow) {fail(`Unknown investigate subcommand: ${subcommand}`);}

  const params = investigateParameters(workflow, target, options),
   body = investigateBody(workflow, target, options),
   investigateOptions: CliOptions = { ...options, _: options._, body, param: params },
   result = await callOperation(spec, workflow.operationId, investigateOptions, fetchImpl),

   output = options["include-meta"]
    ? {
        body: result.body,
        method: result.request.descriptor.method,
        operationId: result.request.descriptor.operationId,
        status: result.response.status,
        url: result.request.url,
      }
    : result.body;
  printValue(output, options.output ?? "json");
  return result.response.ok ? 0 : 1;
}

function runSchemaGroup(action: string | undefined, options: CliOptions): number {
  if (action === "check" || action === "export" || action === "refresh") {
    return runSchemaCommand(action, options);
  }
  fail("schema requires check, export, or refresh");
}

function apiListCommand(spec: OpenApiSpec, options: CliOptions): number {
  const operations = listOperations(spec).filter(
    (operation) => !options.tag || operation.tags.includes(options.tag),
  );
  if (options.json) {
    printValue(
      operations.map(({ operation: _operation, pathParameters: _pathParameters, ...item }) => item),
      "json",
    );
  } else {
    for (const item of operations) {
      console.log(`${item.operationId}\t${item.method}\t${item.path}\t${item.summary}`);
    }
  }
  return 0;
}

function apiDescribeCommand(spec: OpenApiSpec, target: string | undefined): number {
  if (!target) {fail("api describe requires an operationId");}
  const item = findOperation(spec, target);
  printValue({
    method: item.method,
    operationId: item.operationId,
    parameters: [...item.pathParameters, ...(item.operation.parameters ?? [])],
    path: item.path,
    requestBody: item.operation.requestBody,
    responses: item.operation.responses,
    summary: item.summary,
    tags: item.tags,
  });
  return 0;
}

async function apiCallCommand(spec: OpenApiSpec, target: string | undefined, options: CliOptions): Promise<number> {
  if (!target) {fail("api call requires an operationId");}
  const result = await callOperation(spec, target, options),
   output = options["include-meta"]
    ? {
        body: result.body,
        method: result.request.descriptor.method,
        operationId: result.request.descriptor.operationId,
        status: result.response.status,
        url: result.request.url,
      }
    : result.body;
  if (!options.stream) {printValue(output, options.output);}
  return result.response.ok ? 0 : 1;
}

async function apiSmokeCommand(spec: OpenApiSpec, target: string | undefined, options: CliOptions): Promise<number> {
  if (!target) {fail("api smoke requires an operationId");}
  const result = await callOperation(spec, target, options),
   report = evaluateSmoke(result, options);
  printValue(report, options.output);
  return report.ok ? 0 : 1;
}

async function runApiCommand(
  spec: OpenApiSpec,
  action: string | undefined,
  target: string | undefined,
  options: CliOptions,
): Promise<number> {
  if (action === "list") {return apiListCommand(spec, options);}
  if (action === "describe") {return apiDescribeCommand(spec, target);}
  if (action === "call") {return apiCallCommand(spec, target, options);}
  if (action === "smoke") {return apiSmokeCommand(spec, target, options);}
  fail(`Unknown command: ${options._.join(" ")}`);
}

function wsListCommand(spec: OpenApiSpec, options: CliOptions): number {
  const sockets = listWebSockets(spec);
  if (options.json) {printValue(sockets, "json");}
  else {
    for (const item of sockets) {
      console.log(`${item.operationId}\tWS\t${item.path}\t${item.summary ?? ""}`);
    }
  }
  return 0;
}

async function wsListenCommand(spec: OpenApiSpec, target: string | undefined, options: CliOptions): Promise<number> {
  if (!target) {fail("ws listen requires an operationId or path");}
  const result = await listenWebSocket(spec, target, options);
  if (options["include-meta"] || Number(options.count ?? 1) === 0) {
    printValue(result, options.output);
  }
  return 0;
}

async function runWsCommand(
  spec: OpenApiSpec,
  action: string | undefined,
  target: string | undefined,
  options: CliOptions,
): Promise<number> {
  if (action === "list") {return wsListCommand(spec, options);}
  if (action === "listen") {return wsListenCommand(spec, target, options);}
  fail(`Unknown command: ${options._.join(" ")}`);
}

function runInvestigateGroup(
  spec: OpenApiSpec,
  action: string | undefined,
  target: string | undefined,
  options: CliOptions,
): Promise<number> {
  if (!action) {fail("investigate requires a subcommand: organization, ownership, source, or reporter");}
  if (!target) {fail(`investigate ${action} requires a name`);}
  return runInvestigateCommand(spec, action, target, options);
}

function usage(): string {
  const workflows = Object.entries(INVESTIGATE_WORKFLOWS)
    .map(([name, wf]) => {
      const args: string[] = [];
      if (wf.bodyOptionKeys?.includes("website")) {args.push("[--website URL]");}
      if (wf.bodyOptionKeys?.includes("organization")) {args.push("[--organization ORG]");}
      if (wf.parameterOptions?.["max-depth"]) {args.push("[--max-depth N]");}
      if (wf.useBody) {args.push("[--refresh]");}
      return `  scoop investigate ${name} NAME ${args.join(" ")}\t${wf.summary ?? ""}`;
    })
    .join("\n");

  return `Usage:
  scoop api list [--tag TAG] [--json] [--spec PATH]
  scoop api describe OPERATION_ID [--spec PATH]
  scoop api call OPERATION_ID [--param name=value] [--body JSON|@FILE]
  scoop api smoke OPERATION_ID [--expect-status 200] [--expect-json /pointer=value]
  scoop ws list [--json] [--spec PATH]
  scoop ws listen OPERATION_ID|PATH [--count N] [--timeout SECONDS]
  scoop schema check|export|refresh [--output PATH]

Investigate commands:
${workflows}

Common request options:
  --base-url URL       Backend URL (default SCOOP_API_URL or http://127.0.0.1:8000)
  --param name=value   OpenAPI path, query, header, or cookie parameter; repeatable
  --header name=value  Additional HTTP header; repeatable
  --body JSON|@FILE    JSON request body
  --timeout SECONDS    Request deadline, default 30
  --refresh            Force re-research (skip cache)
  --stream             Forward response chunks without buffering
  --include-meta       Include status, method, URL, and response body
  --output pretty|json Response formatting, default pretty
`;
}

export async function main(argv:readonly  string[] = process.argv.slice(2)): Promise<number> {
  const options = parseOptions(argv),
   [group, action, target] = options._;
  if (options.help || !group) {
    process.stdout.write(usage());
    return 0;
  }
  if (group === "schema") {return runSchemaGroup(action, options);}
  const spec = loadSpec(options.spec ?? process.env.SCOOP_OPENAPI ?? DEFAULT_SPEC);
  if (group === "api") {return runApiCommand(spec, action, target, options);}
  if (group === "ws") {return runWsCommand(spec, action, target, options);}
  if (group === "investigate") {return runInvestigateGroup(spec, action, target, options);}
  fail(`Unknown command: ${options._.join(" ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    (exitCode) => {
      process.exitCode = exitCode;
    },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error),
       exitCode = error instanceof CliError ? error.exitCode : 1;
      console.error(message);
      process.exitCode = exitCode;
    },
  );
}
