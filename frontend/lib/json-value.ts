import { isObjectValue } from "@/lib/type-guards";

export interface JsonObject {
  readonly [key: string]: JsonValue | undefined;
}

export type JsonValue = JsonObject | readonly JsonValue[] | boolean | number | string | null;

export const isJsonObject = <Value>(value: Value): value is Value & JsonObject =>
  isObjectValue(value) && !Array.isArray(value);
