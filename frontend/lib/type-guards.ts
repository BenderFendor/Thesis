/** Primitive/object guards used only at runtime boundaries. */
export const isNumberValue = <Value>(value: Value): value is Value & number =>
  typeof value === "number";

export const isObjectValue = <Value>(value: Value): value is Value & object =>
  value !== null && typeof value === "object";

export const isStringValue = <Value>(value: Value): value is Value & string =>
  typeof value === "string";
