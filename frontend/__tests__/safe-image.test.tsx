import { describe, expect, it } from "@jest/globals"
import { fireEvent, render, screen } from "@testing-library/react"
import { SafeImage } from "@/components/safe-image"

describe("safeImage", () => {
  it("shows the fallback after an image error and retries a new source", () => {
    expect.hasAssertions()
    const { rerender } = render(
      <SafeImage src="https://example.com/first.png" alt="First" width={100} height={60} />,
    ),
     image = screen.getByAltText("First")

    expect(image).toHaveAttribute("src", "https://example.com/first.png")
    fireEvent.error(image)
    expect(image).toHaveAttribute("src", `${globalThis.location.origin}/placeholder.svg`)

    rerender(<SafeImage src="https://example.com/second.png" alt="Second" width={100} height={60} />)
    expect(screen.getByAltText("Second")).toHaveAttribute("src", "https://example.com/second.png")
  })
})
