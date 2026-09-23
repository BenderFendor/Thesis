import type { ApiRequestInit } from "./types";
import { z } from "zod";

// One HTTP primitive for the whole frontend API layer.

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

const ENABLE_DIGEST = process.env.NEXT_PUBLIC_ENABLE_DIGEST === "true";
const ENABLE_HIGHLIGHTS = true;

class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const ApiErrorBodySchema = z.object({
  detail: z.unknown().optional(),
  error: z.unknown().optional(),
});
type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

interface ApiResponseSchema<ResponseData> {
  readonly parse: z.ZodType<ResponseData>["parse"];
}

function readErrorMessage(payload: ApiErrorBody | null, status: number): string {
  if (payload) {
    const message = [payload.detail, payload.error].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (message !== undefined) {
      return message;
    }
  }
  return `HTTP error! status: ${status}`;
}

const fetchApiResponse = (url: string, init?: ApiRequestInit): Promise<Response> => {
  if (init === undefined) {
    return fetch(url);
  }
  return fetch(url, init);
};

const createHttpError = async (response: Response): Promise<ApiError> => {
  const rawPayload: unknown = await response.json().catch(() => null);
  const parsedPayload = ApiErrorBodySchema.safeParse(rawPayload);
  let errorPayload: ApiErrorBody | null = null;
  if (parsedPayload.success) {
    errorPayload = parsedPayload.data;
  }
  return new ApiError(response.status, readErrorMessage(errorPayload, response.status));
};

async function api<ResponseData>(
  path: string,
  schema: ApiResponseSchema<ResponseData>,
  init?: ApiRequestInit,
): Promise<ResponseData> {
  const url = `${API_BASE_URL}${path}`;
  const response = await fetchApiResponse(url, init);

  if (!response.ok) {
    throw await createHttpError(response);
  }

  const body: unknown = await response.json();
  return schema.parse(body);
}

function query(
  params: Readonly<Record<string, string | number | boolean | null | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  if (qs.length === 0) {
    return "";
  }
  return `?${qs}`;
}

export { API_BASE_URL, ApiError, ENABLE_DIGEST, ENABLE_HIGHLIGHTS, api, query };
export type { ApiResponseSchema };
