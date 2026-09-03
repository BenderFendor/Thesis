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

function readErrorMessage(payload: unknown, status: number): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "detail" in payload &&
    typeof payload.detail === "string"
  ) {
    return payload.detail;
  }
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return `HTTP error! status: ${status}`;
}

export async function api<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, init);

  if (!response.ok) {
    const payload: unknown = await response.json().catch(() => null);
    throw new ApiError(response.status, readErrorMessage(payload, response.status));
  }

  const payload: unknown = await response.json();
  // SAFETY: the API contract is generated from OpenAPI; endpoint wrappers
  // validate shape where backend nullability has historically drifted.
  return payload as T;
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
