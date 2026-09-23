/* @jest-environment node */

import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { api } from "@/lib/api/client";
import { z } from "zod";

const originalFetch = globalThis.fetch;

describe("api error response messages", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("preserves a string detail and HTTP status", async () => {  expect.hasAssertions();

    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ detail: "Upstream unavailable" }, { status: 502 }));

    await expect(api("/broken", z.unknown())).rejects.toMatchObject({
      message: "Upstream unavailable",
      name: "ApiError",
      status: 502,
    });
  });

  it("uses a string error when detail is absent", async () => {  expect.hasAssertions();

    globalThis.fetch = jest
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "Backend failed" }, { status: 503 }));

    await expect(api("/broken", z.unknown())).rejects.toMatchObject({
      message: "Backend failed",
      name: "ApiError",
      status: 503,
    });
  });

  it.each([
    ["an array", ["not", "an", "object"], "HTTP error! status: 418"],
    ["a null payload", null, "HTTP error! status: 418"],
    ["a non-string detail", { detail: { message: "hidden" } }, "HTTP error! status: 418"],
    ["a null detail with a string error", { detail: null, error: "Backend failed" }, "Backend failed"],
    ["a string detail with a malformed error", { detail: "Useful", error: 123 }, "Useful"],
  ])("reads useful strings from %s", async (_description, payload, expectedMessage) => {
    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(Response.json(payload, { status: 418 }));

    await expect(api("/broken", z.unknown())).rejects.toMatchObject({
      message: expectedMessage,
      status: 418,
    });
  });

  it("uses the status fallback when the error body is not JSON", async () => {  expect.hasAssertions();

    globalThis.fetch = jest.fn<typeof fetch>().mockResolvedValue(new Response("not json", { status: 500 }));

    await expect(api("/broken", z.unknown())).rejects.toMatchObject({
      message: "HTTP error! status: 500",
      status: 500,
    });
  });

});

describe("api transport failures", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("preserves fetch rejection errors", async () => {  expect.hasAssertions();

    const networkError = new Error("network down");
    globalThis.fetch = jest.fn<typeof fetch>().mockRejectedValue(networkError);

    await expect(api("/broken", z.unknown())).rejects.toBe(networkError);
  });

  it("preserves abort rejection errors", async () => {  expect.hasAssertions();

    const abortError = new DOMException("aborted", "AbortError");
    globalThis.fetch = jest.fn<typeof fetch>().mockRejectedValue(abortError);

    await expect(api("/broken", z.unknown())).rejects.toBe(abortError);
  });
});
