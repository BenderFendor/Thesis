import {
  buildObsidianMarkdown,
  getGlobalOffset,
  getMarkdownWithHighlights,
  renderHighlightedContent,
} from "@/lib/highlight-utils"
import { describe, expect, it, jest } from "@jest/globals"
import { fireEvent, render, screen } from "@testing-library/react"
import type { Highlight } from "@/lib/api"

interface HighlightAnchorElement {
  readonly contains: HTMLElement["contains"]
  readonly getBoundingClientRect: () => DOMRect
}

const EXPECTED_ACTIVATION_COUNT = 2,
 HIGHLIGHT: Readonly<Highlight> = {
  article_url: "https://example.com/story",
  character_end: 10,
  character_start: 5,
  color: "yellow",
  highlighted_text: "hello",
}

describe("highlightUtils", () => {
  it("renders and activates a highlight with mouse and keyboard input", () => {
    expect.hasAssertions()
    const onHighlightClick = jest.fn<
      (stableId: string, element: Readonly<HighlightAnchorElement>) => void
    >()

    render(<div>{renderHighlightedContent("Read hello world", [HIGHLIGHT], onHighlightClick)}</div>)

    expect(screen.getByRole("button", { name: "hello" })).toHaveAttribute(
      "data-highlight-stable-id",
      "range:5:10:hello",
    )

    fireEvent.click(screen.getByRole("button", { name: "hello" }))
    fireEvent.keyDown(screen.getByRole("button", { name: "hello" }), { key: "Enter" })

    expect(onHighlightClick).toHaveBeenCalledTimes(EXPECTED_ACTIVATION_COUNT)
    expect(onHighlightClick).toHaveBeenLastCalledWith("range:5:10:hello", expect.any(HTMLElement))
  })

  it("keeps markdown export and DOM offsets aligned with the article text", () => {
    expect.hasAssertions()
    const root = document.createElement("div"),
     textNode = document.createTextNode("Read hello world")
    root.append(textNode)

    expect(getGlobalOffset(root, textNode, HIGHLIGHT.character_start)).toBe(HIGHLIGHT.character_start)
    expect(getMarkdownWithHighlights("Read hello world", [HIGHLIGHT])).toBe("Read ==hello== world")
    expect(
      buildObsidianMarkdown({
        article: {
          author: "Ada Example",
          publishedAt: "2026-09-02",
          summary: "Read hello world",
          title: "Example",
          url: "https://example.com/story",
        },
        fullArticleText: "Read hello world",
        highlights: [HIGHLIGHT],
      }),
    ).toContain("Read ==hello== world")
  })
})
