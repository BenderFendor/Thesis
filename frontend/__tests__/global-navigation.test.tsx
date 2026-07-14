import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { GlobalNavigation } from "@/components/global-navigation"

const push = jest.fn()
const replace = jest.fn()
let pathname = "/"
let searchParams = new URLSearchParams()

jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useRouter: () => ({ push, replace }),
  useSearchParams: () => searchParams,
}))

jest.mock("@/components/safe-image", () => ({
  SafeImage: ({ alt = "" }: { alt?: string }) => <span role="img" aria-label={alt || "brand mark"} />,
}))

describe("GlobalNavigation", () => {
  beforeEach(() => {
    pathname = "/"
    searchParams = new URLSearchParams()
    push.mockReset()
    replace.mockReset()
    window.localStorage.clear()
  })

  it("changes the home view and writes a shareable URL", async () => {
    const user = userEvent.setup()
    const onViewChange = jest.fn()

    render(<GlobalNavigation currentView="grid" onViewChange={onViewChange} />)
    await user.click(screen.getByRole("button", { name: "Globe" }))

    expect(onViewChange).toHaveBeenCalledWith("globe")
    expect(replace).toHaveBeenCalledWith("/?view=globe", { scroll: false })
  })

  it("restores a requested view when arriving from another route", async () => {
    searchParams = new URLSearchParams("view=blindspot")
    const onViewChange = jest.fn()

    render(<GlobalNavigation currentView="grid" onViewChange={onViewChange} />)

    await waitFor(() => expect(onViewChange).toHaveBeenCalledWith("blindspot"))
  })

  it("routes view choices back to the matching home URL from another page", async () => {
    pathname = "/wiki"
    const user = userEvent.setup()

    render(<GlobalNavigation />)
    await user.click(screen.getByRole("button", { name: "Live" }))

    expect(push).toHaveBeenCalledWith("/?view=live-news")
  })

  it("expands into an accessible search form and submits encoded queries", async () => {
    const user = userEvent.setup()

    render(<GlobalNavigation />)
    await user.click(screen.getByRole("button", { name: "Open workspace search" }))

    const input = screen.getByRole("searchbox", { name: "Search the workspace" })
    await user.type(input, "public media ownership")
    await user.click(screen.getByRole("button", { name: "Submit search" }))

    expect(push).toHaveBeenCalledWith("/search?query=public%20media%20ownership")
  })

  it("marks library routes as active", () => {
    pathname = "/sources"

    render(<GlobalNavigation />)

    expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page")
  })
})
