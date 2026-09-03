import type { ApiRequestInit } from "./types";

// One HTTP primitive for the whole frontend API layer.

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const ENABLE_DIGEST = process.env.NEXT_PUBLIC_ENABLE_DIGEST === "true";
export const ENABLE_HIGHLIGHTS = true;

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export interface ApiErrorBody {
  readonly detail?: string;
  readonly error?: string;
}

function readErrorMessage(payload: ApiErrorBody, status: number): string {
  if (payload.detail) {
    return payload.detail;
  }
  if (payload.error) {
    return payload.error;
  }
  return `HTTP error! status: ${status}`;
}

export async function api<T>(
  path: string,
  init?: ApiRequestInit,
): Promise<T> {
  const response = init
    ? await fetch(`${API_BASE_URL}${path}`, init)
    : await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiErrorBody;
    // SAFETY: error bodies are small; missing fields fall back to the status message.
    throw new ApiError(response.status, readErrorMessage(payload, response.status));
  }

  const body: unknown = await response.json();
  // SAFETY: the API contract is generated from OpenAPI; endpoint wrappers
  // validate shape where backend nullability has historically drifted.
  return body as T;
}

export function query(
  params: Readonly<Record<string, string | number | boolean | null | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}
