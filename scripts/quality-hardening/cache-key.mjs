// @ts-check

import { PROTOCOL_VERSION } from "./protocol.mjs";

import { createHash } from "node:crypto";

/** @param {unknown} value @returns {string} */
function stableJson(value) {
  if (Array.isArray(value)) {return `[${value.map(stableJson).join(",")}]`;}
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** @param {Readonly<{analyzer: string, analyzerVersion: string, contentSha256: string, nativeConfigHashes?: Readonly<Record<string, string>>, policyHash: string, relativePath: string, repositoryRoot: string, scopeVersion: string}>} input */
function analysisCacheKey(input) {
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
