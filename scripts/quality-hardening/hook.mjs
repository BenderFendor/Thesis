// @ts-check

import { PROTOCOL_VERSION, assertProtocol, hookResult } from "./protocol.mjs";

const MAX_INPUT_BYTES = 256_000;

/** @param {import("node:stream").Readable} input @returns {Promise<string>} */
const readInput = async (input) => {
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

/** @typedef {string | readonly string[]} HookPathValue */
/** @typedef {Readonly<{file_path?: HookPathValue, path?: HookPathValue, filePath?: HookPathValue, paths?: HookPathValue}>} HookToolInput */
/** @typedef {Readonly<{input?: HookToolInput}>} HookTool */
/** @typedef {Readonly<{event: "pre"|"post"|"stop", harness: string, protocol: number, tool?: HookTool}>} HookRequest */

/** @param {HookRequest} request */
const touchedPaths = (request) => {
 const input = request.tool?.input;
 if (!input) { return []; }
 const values = [];
 for (const value of [input.file_path, input.path, input.filePath, input.paths]) {
  if (value?.constructor === String) { values.push(value); }
  if (Array.isArray(value)) { values.push(...value); }
 }
 return [...new Set(values)].toSorted((left, right) => left.localeCompare(right));
}

/** @param {"pre"|"post"|"stop"} event @param {import("node:stream").Readable} input */
const hook = async (event, input) => {
 const text = await readInput(input);
 /** @type {HookRequest} */
 const request = JSON.parse(text);
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

/** @param {"pre"|"post"|"stop"} event @param {Partial<HookRequest>} request */
const requestFor = (event, request) => (
 { event, harness: "controller", protocol: PROTOCOL_VERSION, ...request }
)

export { hook, readInput, requestFor, touchedPaths };
