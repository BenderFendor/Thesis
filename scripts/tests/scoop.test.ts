import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  callOperation,
  evaluateSmoke,
  listOperations,
  listWebSockets,
  parseOptions,
  prepareRequest,
  runInvestigateCommand,
  type OpenApiSpec,
} from "../scoop.ts";

const SPEC: OpenApiSpec = {
  openapi: "3.1.0",
  paths: {
    "/items/{item_id}": {
      post: {
        operationId: "update_item",
        summary: "Update item",
        tags: ["items"],
        parameters: [
          { name: "item_id", in: "path", required: true, schema: { type: "integer" } },
          { name: "verbose", in: "query", schema: { type: "boolean" } },
          { name: "labels", in: "query", schema: { type: "array", items: { type: "string" } } },
          { name: "X-Trace", in: "header", schema: { type: "string" } },
        ],
        requestBody: { required: true, content: { "application/json": {} } },
        responses: { "200": { description: "ok" } },
      },
    },
    "/research/entity/organization/research": {
      post: {
        operationId: "research_organization_research_entity_organization_research_post",
        summary: "Research Organization",
        tags: ["entity-research"],
        parameters: [
          { name: "force_refresh", in: "query", schema: { type: "boolean" } },
        ],
        requestBody: { required: true, content: { "application/json": {} } },
        responses: { "200": { description: "ok" } },
      },
    },
    "/research/entity/organization/{org_name}/ownership-chain": {
      get: {
        operationId: "get_ownership_chain_research_entity_organization__org_name__ownership_chain_get",
        summary: "Get Ownership Chain",
        tags: ["entity-research"],
        parameters: [
          { name: "org_name", in: "path", required: true, schema: { type: "string" } },
          { name: "max_depth", in: "query", schema: { type: "integer" } },
        ],
        responses: { "200": { description: "ok" } },
      },
    },
    "/research/entity/source/profile": {
      post: {
        operationId: "research_source_profile_research_entity_source_profile_post",
        summary: "Research Source Profile",
        tags: ["entity-research"],
        parameters: [
          { name: "force_refresh", in: "query", schema: { type: "boolean" } },
        ],
        requestBody: { required: true, content: { "application/json": {} } },
        responses: { "200": { description: "ok" } },
      },
    },
    "/research/entity/reporter/profile": {
      post: {
        operationId: "profile_reporter_research_entity_reporter_profile_post",
        summary: "Profile Reporter",
        tags: ["entity-research"],
        parameters: [
          { name: "force_refresh", in: "query", schema: { type: "boolean" } },
        ],
        requestBody: { required: true, content: { "application/json": {} } },
        responses: { "200": { description: "ok" } },
      },
    },
  },
  "x-scoop-websockets": [
    { operationId: "news_updates_ws", path: "/ws", summary: "News updates" },
  ],
};

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rawBody = Buffer.concat(chunks).toString("utf8");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        method: request.method,
        url: request.url,
        trace: request.headers["x-trace"],
        body: rawBody ? JSON.parse(rawBody) : null,
      }),
    );
  });
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", resolve);
  await promise;
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  server.close((error) => (error ? reject(error) : resolve()));
  await promise;
});
test("OpenAPI and WebSocket inventories expose the backend contract", () => {
  const operations = listOperations(SPEC).map(({ operationId, method, path }) => ({
    operationId,
    method,
    path,
  }));
  assert.equal(operations.length, 5);
  assert.ok(operations.find((o) => o.operationId === "update_item"));
  assert.ok(operations.find((o) => o.operationId === "research_organization_research_entity_organization_research_post"));
  assert.ok(
    operations.find(
      (o) => o.operationId === "get_ownership_chain_research_entity_organization__org_name__ownership_chain_get",
    ),
  );
  assert.ok(operations.find((o) => o.operationId === "research_source_profile_research_entity_source_profile_post"));
  assert.ok(operations.find((o) => o.operationId === "profile_reporter_research_entity_reporter_profile_post"));
  assert.deepEqual(listWebSockets(SPEC), [
    { operationId: "news_updates_ws", path: "/ws", summary: "News updates" },
  ]);
});

test("request preparation follows OpenAPI parameter locations and types", () => {
  const options = parseOptions([
    "--base-url",
    baseUrl,
    "--param",
    "item_id=42",
    "--param",
    "verbose=true",
    "--param",
    "labels=ownership,reporters",
    "--param",
    "X-Trace=trace-1",
    "--body",
    '{"active":true}',
  ]);
  const request = prepareRequest(SPEC, "update_item", options);

  assert.equal(request.url, `${baseUrl}/items/42?verbose=true&labels=ownership&labels=reporters`);
  assert.equal(new Headers(request.init.headers).get("X-Trace"), "trace-1");
  assert.equal(request.init.body, '{"active":true}');
});

test("real HTTP call and smoke assertions use the same operation", async () => {
  const options = parseOptions([
    "--base-url",
    baseUrl,
    "--param",
    "item_id=7",
    "--param",
    "verbose=false",
    "--param",
    "X-Trace=trace-2",
    "--body",
    '{"active":true}',
    "--expect-json",
    "/trace=trace-2",
    "--expect-json",
    "/body/active=true",
  ]);
  const result = await callOperation(SPEC, "update_item", options);
  const report = evaluateSmoke(result, options);

  assert.equal(result.response.status, 200);
  assert.equal(report.ok, true);
  assert.equal(report.checks.length, 3);
});

test("required OpenAPI inputs fail before network access", () => {
  assert.throws(
    () => prepareRequest(SPEC, "update_item", parseOptions(["--body", "{}"])),
    /Missing required parameter: item_id/,
  );
  assert.throws(
    () =>
      prepareRequest(
        SPEC,
        "update_item",
        parseOptions(["--param", "item_id=1", "--body", "{}", "--param", "unknown=x"]),
      ),
    /Unknown parameter for update_item: unknown/,
  );
});

test("investigate organization operation resolves from spec and sends name in POST body", async () => {
  const options = parseOptions([
    "--base-url",
    baseUrl,
    "--body",
    JSON.stringify({ name: "BBC News" }),
  ]);
  const result = await callOperation(
    SPEC,
    "research_organization_research_entity_organization_research_post",
    options,
  );
  const echo = result.body as { method: string; url: string; body: { name: string } };

  assert.equal(result.response.status, 200);
  assert.equal(echo.body.name, "BBC News");
  assert.equal(echo.method, "POST");
  assert.match(echo.url, /\/research\/entity\/organization\/research/);
});

test("investigate source operation resolves from spec with name and website in POST body", async () => {
  const options = parseOptions([
    "--base-url",
    baseUrl,
    "--body",
    JSON.stringify({ name: "Al Jazeera", website: "https://www.aljazeera.com" }),
  ]);
  const result = await callOperation(
    SPEC,
    "research_source_profile_research_entity_source_profile_post",
    options,
  );
  const echo = result.body as { body: { name: string; website: string } };

  assert.equal(result.response.status, 200);
  assert.equal(echo.body.name, "Al Jazeera");
  assert.equal(echo.body.website, "https://www.aljazeera.com");
});

test("investigate reporter operation resolves from spec with organization and refresh", async () => {
  const options = parseOptions([
    "--base-url",
    baseUrl,
    "--param",
    "force_refresh=true",
    "--body",
    JSON.stringify({ name: "Moscow Times", organization: "The Moscow Times" }),
  ]);
  const result = await callOperation(
    SPEC,
    "profile_reporter_research_entity_reporter_profile_post",
    options,
  );
  const echo = result.body as { url: string; body: { name: string; organization: string } };

  assert.equal(result.response.status, 200);
  assert.equal(echo.body.name, "Moscow Times");
  assert.equal(echo.body.organization, "The Moscow Times");
  assert.match(echo.url, /force_refresh=true/);
});

test("investigate ownership operation resolves from spec and encodes org_name as path parameter", async () => {
  const options = parseOptions([
    "--base-url",
    baseUrl,
    "--param",
    "org_name=Sinclair Broadcast Group",
  ]);
  const result = await callOperation(
    SPEC,
    "get_ownership_chain_research_entity_organization__org_name__ownership_chain_get",
    options,
  );
  const echo = result.body as { url: string };

  assert.equal(result.response.status, 200);
  assert.match(
    echo.url,
    /\/research\/entity\/organization\/Sinclair%20Broadcast%20Group\/ownership-chain/,
  );
});

test("curated organization workflow uses generated operation parameters", async () => {
  let requestedUrl = "";
  let requestedBody = "";
  const fetchImpl: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    requestedBody = String(init?.body ?? "");
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const exitCode = await runInvestigateCommand(
    SPEC,
    "organization",
    "Arbitrary Media Cooperative",
    parseOptions([
      "--base-url",
      baseUrl,
      "--website",
      "https://arbitrary.example",
      "--refresh",
    ]),
    fetchImpl,
  );

  assert.equal(exitCode, 0);
  assert.match(requestedUrl, /force_refresh=true/);
  assert.deepEqual(JSON.parse(requestedBody), {
    name: "Arbitrary Media Cooperative",
    website: "https://arbitrary.example",
  });
});

test("curated ownership workflow maps max-depth to OpenAPI max_depth", async () => {
  let requestedUrl = "";
  const fetchImpl: typeof fetch = async (input) => {
    requestedUrl = String(input);
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  };

  const exitCode = await runInvestigateCommand(
    SPEC,
    "ownership",
    "Independent Holding Company",
    parseOptions(["--base-url", baseUrl, "--max-depth", "7"]),
    fetchImpl,
  );

  assert.equal(exitCode, 0);
  assert.match(
    requestedUrl,
    /Independent%20Holding%20Company\/ownership-chain\?max_depth=7$/,
  );
});
