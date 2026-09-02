// @ts-check

import { PROTOCOL_VERSION, assertProtocol, hookResult } from "./protocol.mjs";

const MAX_INPUT_BYTES = 256_000;

/** @param {import("node:stream").Readable} input @returns {Promise<string>} */
async function readInput(input) {
 const chunks = [];
 let size = 0;
 for await (const chunk of input) {
  const text = String(chunk);
  size += Buffer.byteLength(text, "utf8");
  if (size > MAX_INPUT_BYTES) { throw new Error("hook payload exceeds input limit"); }
  chunks.push(text);
 }
 return chunks.join("");
}

/** @param {Record<string, unknown>} request */
function touchedPaths(request) {
 const { tool } = request;
 const toolObject = tool && typeof tool === "object" && !Array.isArray(tool)
  ? /** @type {Record<string, unknown>} */ (tool)
  : {},
  { input } = toolObject;
 if (!input || typeof input !== "object" || Array.isArray(input)) { return []; }
 const inputObject = /** @type {Record<string, unknown>} */ (input),
  values = [];
 for (const key of ["file_path", "path", "filePath", "paths"]) {
  const value = inputObject[key];
  if (typeof value === "string") { values.push(value); }
  if (Array.isArray(value)) { values.push(...value.filter((item) => typeof item === "string")); }
 }
 return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/** @param {"pre"|"post"|"stop"} event @param {import("node:stream").Readable} input */
async function hook(event, input) {
 const text = await readInput(input),
  request = JSON.parse(text);
 assertProtocol(request, "hook request");
 if (request.event !== event) { throw new Error(`hook event mismatch: expected ${event}`); }
 const paths = touchedPaths(request);
 return hookResult({
  decision: "allow",
  message: event === "stop" ? "quality Stop coordinator received the request" : "quality analysis is advisory until Stop",
  reason_code: event === "stop" ? "stop_coordinator_ready" : "advisory_analysis",
  touched_paths: paths,
 });
}

/** @param {"pre"|"post"|"stop"} event @param {Record<string, unknown>} request */
function requestFor(event, request) {
 return { event, harness: "controller", protocol: PROTOCOL_VERSION, ...request };
}

export { hook, readInput, requestFor, touchedPaths };
