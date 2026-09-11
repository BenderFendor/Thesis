// @ts-check

import { PROTOCOL_VERSION } from "./protocol.mjs";

import { createHash } from "node:crypto";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isPlainObject = (value) => Object.prototype.toString.call(value) === "[object Object]";

/** @param {unknown} value @returns {string} */
const stableJson = (value) => {
  if (Array.isArray(value)) {return `[${value.map(stableJson).join(",")}]`;}
  if (isPlainObject(value)) {
    return `{${Object.entries(value).toSorted(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** @param {Readonly<{analyzer: string, analyzerVersion: string, contentSha256: string, nativeConfigHashes?: Readonly<Record<string, string>>, policyHash: string, relativePath: string, repositoryRoot: string, scopeVersion: string}>} input */
const analysisCacheKey = (input) => {
  const descriptor = {
    adapter_protocol: PROTOCOL_VERSION,
    analyzer: input.analyzer,
    analyzer_version: input.analyzerVersion,
    content_sha256: input.contentSha256,
    native_config_hashes: input.nativeConfigHashes ?? {},
    policy_hash: input.policyHash,
    relative_path: input.relativePath,
    repository_root: input.repositoryRoot,
    scope_version: input.scopeVersion,
  };
  return `qh-cache:${createHash("sha256").update(stableJson(descriptor)).digest("hex")}`;
}

export { analysisCacheKey, stableJson };
