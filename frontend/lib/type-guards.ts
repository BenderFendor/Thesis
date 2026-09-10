/** Primitive/object guards used only at runtime boundaries. */
/**
 * Check whether a value is a number.
 *
 * @param {Value} value Value to inspect.
 * @returns {value is Value & number} Whether the value is a number.
 */
const isNumberValue = <Value>(value: Value): value is Value & number =>
  typeof value === "number";

const isObjectValue = <Value>(value: Value): value is Value & object =>
  value !== null && typeof value === "object";

const isStringValue = <Value>(value: Value): value is Value & string =>
  typeof value === "string";

export { isNumberValue, isObjectValue, isStringValue };
