import { describe, expect, it } from "@jest/globals"
import { SourceResearchPanel } from "@/components/source-research-panel"
import { renderWithQueryClient } from "@/test-utils/render-with-query-client"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

type ResponseBytes = Uint8Array<ArrayBuffer>

class ErrorResponse implements Response {
  readonly body = new ReadableStream<ResponseBytes>()
  readonly bodyUsed = false
  readonly headers = new Headers()
  readonly ok = false
  readonly redirected = false
  readonly status: number
  readonly statusText = ""
  readonly type: ResponseType = "default"
  readonly url = ""

  constructor(status: number) {
    this.status = status
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return Promise.resolve(new ArrayBuffer(EMPTY_BYTE_LENGTH))
  }

  blob(): Promise<Blob> {
    return Promise.resolve(new Blob())
  }

  bytes(): Promise<ResponseBytes> {
    return Promise.resolve(new Uint8Array<ArrayBuffer>(new ArrayBuffer(EMPTY_BYTE_LENGTH)))
  }

  clone(): Response {
    return new ErrorResponse(this.status)
  }

  formData(): Promise<FormData> {
    return Promise.resolve(new FormData())
  }

  json(): Promise<Record<string, never>> {
    return Promise.resolve({})
  }

  text(): Promise<string> {
    return Promise.resolve("")
  }
}

interface FetchRestore {
  readonly previousFetch: typeof fetch
  readonly restore: () => void
}

const CACHE_MISS_STATUS = 404,
 EMPTY_BYTE_LENGTH = 0,
 SERVICE_UNAVAILABLE_STATUS = 503,
 installErrorResponse = (status: number): FetchRestore => {
  const previousFetch = globalThis.fetch
  globalThis.fetch = () => Promise.resolve(new ErrorResponse(status))
  return { previousFetch, restore: () => { globalThis.fetch = previousFetch } }
}

describe("sourceResearchPanel", () => {
  it("renders the cache-miss state through the real API boundary", async () => {
    expect.hasAssertions()
    const { previousFetch, restore: restoreFetch } = installErrorResponse(CACHE_MISS_STATUS)

    try {
      renderWithQueryClient(
        <SourceResearchPanel
          sourceName="Reuters"
          website="https://www.reuters.com"
        />,
      )

      await expect(
        screen.findByText(/Run research to fetch verified/u),
      ).resolves.toBeInTheDocument()
      expect(screen.getByRole("link", { name: /full wiki/iu })).toHaveAttribute(
        "href",
        "/wiki/source/Reuters",
      )
    } finally {
      restoreFetch()
    }

    expect(globalThis.fetch).toBe(previousFetch)
  })

  it("shows the real API error state when research is unavailable", async () => {
    expect.hasAssertions()
    const { previousFetch, restore: restoreFetch } = installErrorResponse(SERVICE_UNAVAILABLE_STATUS),
     user = userEvent.setup()

    try {
      renderWithQueryClient(<SourceResearchPanel sourceName="Reuters" />)
      await user.click(await screen.findByRole("button", { name: "Run" }))
      await expect(
        screen.findByText("Research failed. Retry.", {}, { timeout: 3000 }),
      ).resolves.toBeInTheDocument()
    } finally {
      restoreFetch()
    }

    expect(globalThis.fetch).toBe(previousFetch)
  })
})
