import { z } from "zod";
import { hasText } from "@/lib/utils";
import type { DeepReadonly } from "@/lib/deep-readonly";
import type { ReadonlyAtlasEntityRecord } from "./atlas-inspector-types";

const AtlasMeasurementResultSchema = z.object({
  corpus_window: z
    .object({
      end: z.string().nullable().optional(),
      start: z.string().nullable().optional(),
    })
    .optional(),
  denominator: z.number().optional(),
});

const AtlasDisplayScalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const AtlasDisplayObjectSchema = z.record(z.string(), z.unknown());
const AtlasDisplayArrayItemSchema = z.union([AtlasDisplayScalarSchema, AtlasDisplayObjectSchema]);
const AtlasDisplayArraySchema = z.array(AtlasDisplayArrayItemSchema);
const AtlasDisplayValueSchema = z.union([
  AtlasDisplayScalarSchema,
  AtlasDisplayArraySchema,
  AtlasDisplayObjectSchema,
]);

type AtlasDisplayArrayItem = DeepReadonly<z.infer<typeof AtlasDisplayArrayItemSchema>>;
type AtlasDisplayObject = DeepReadonly<z.infer<typeof AtlasDisplayObjectSchema>>;
type AtlasDisplayValue = DeepReadonly<z.infer<typeof AtlasDisplayValueSchema>>;

const humanize = (value: string): string =>
  value.replaceAll("_", " ").replaceAll(/\b\w/gu, (letter) => letter.toUpperCase());

const displayArrayValue = (value: readonly AtlasDisplayArrayItem[]): string | null => {
  const simpleValues = value.flatMap((item) => simpleArrayValue(item));
  if (simpleValues.length === value.length) {
    return simpleValues.join(", ");
  }
  if (value.length > 0) {
    return `${value.length} records`;
  }
  return null;
};

const simpleArrayValue = (item: AtlasDisplayArrayItem): (string | number | boolean)[] => {
  const parsed = AtlasDisplayScalarSchema.safeParse(item);
  if (parsed.success) {
    return [parsed.data];
  }
  return [];
};

const displayObjectValue = (value: AtlasDisplayObject): string =>
  `${Object.keys(value).length} fields`;

const displayParsedObject = (value: AtlasDisplayValue): string | null => {
  const object = AtlasDisplayObjectSchema.safeParse(value);
  if (object.success) {
    return displayObjectValue(object.data);
  }
  return null;
};

const displayValue = (value: AtlasDisplayValue): string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const scalar = AtlasDisplayScalarSchema.safeParse(value);
  if (scalar.success) {
    return String(scalar.data);
  }
  if (Array.isArray(value)) {
    return displayArrayValue(value);
  }
  return displayParsedObject(value);
};

const dateLabel = (value?: string | null): string => {
  if (!hasText(value)) {
    return "Not recorded";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not recorded";
  }
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
};

const buildAnalysisScores = (
  record: ReadonlyAtlasEntityRecord | undefined,
): readonly (readonly [string, number])[] => {
  if (!record) {
    return [];
  }
  return Object.entries(record.details.analysis_scores ?? {}).flatMap(([axis, score]) => {
    const parsed = z.number().safeParse(score);
    if (parsed.success) {
      return [[axis, parsed.data]] as const;
    }
    return [];
  });
};

const buildDetails = (
  record: ReadonlyAtlasEntityRecord | undefined,
): readonly (readonly [string, string])[] => {
  if (!record) {
    return [];
  }
  return Object.entries(record.details)
    .filter(([key]) => key !== "analysis_scores")
    .map(([key, value]) => {
      const parsed = AtlasDisplayValueSchema.safeParse(value);
      if (!parsed.success) {
        return [key, null] as const;
      }
      return [key, displayValue(parsed.data)] as const;
    })
    .filter((entry): entry is readonly [string, string] => hasText(entry[1]))
    .slice(0, 18);
};

export {
  AtlasDisplayValueSchema,
  AtlasMeasurementResultSchema,
  buildAnalysisScores,
  buildDetails,
  dateLabel,
  displayValue,
  humanize,
};
