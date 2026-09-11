import { isObjectValue } from "@/lib/type-guards";

interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

type JsonValue = JsonObject | readonly JsonValue[] | boolean | number | string | null;

const isJsonObject = <Value>(value: Value): value is Value & JsonObject =>
  isObjectValue(value) && !Array.isArray(value);

export { isJsonObject, type JsonObject, type JsonValue };
