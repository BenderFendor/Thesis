// @ts-check

const DECISIONS = new Set(["allow", "block"]),
 EXIT_CODES = Object.freeze({
  analyzer: 4,
  claim: 3,
  configuration: 2,
  ok: 0,
  quality: 1,
}),
 PROTOCOL_VERSION = 1;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isObject = (value) => 
  value !== null && typeof value === "object" && !Array.isArray(value)


/** @param {unknown} value @param {string} name */
const assertProtocol = (value, name) => {
  if (!isObject(value) || value.protocol !== PROTOCOL_VERSION) {
    throw new Error(`${name} protocol ${PROTOCOL_VERSION} is required`);
  }
}

/** @param {unknown} value */
const assertDecision = (value) => {
  if (!isObject(value) || !DECISIONS.has(String(value.decision))) {
    throw new Error("hook result decision must be allow or block");
  }
}

/** @param {Readonly<Record<string, unknown>>} fields */
const hookResult = (fields) => {
  const result = { decision: "allow", protocol: PROTOCOL_VERSION, severity: "advisory", ...fields };
  assertDecision(result);
  return result;
}

export { EXIT_CODES, PROTOCOL_VERSION, assertDecision, assertProtocol, hookResult };
