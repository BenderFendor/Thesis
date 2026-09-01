import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import { GlobalNavigation } from "@/components/global-navigation"
import type { GlobalNavigationServices } from "@/components/global-navigation"

const push = jest.fn(),
 replace = jest.fn(),
 navigationServices: GlobalNavigationServices = {
  usePathname: () => pathname,
  useRouter: () => ({ push, replace }),
 }
let pathname = "/"

describe("globalNavigation", () => {
  beforeEach(() => {
    pathname = "/"
    push.mockReset()
    replace.mockReset()
    globalThis.localStorage.clear()
    globalThis.history.replaceState({}, "", "/")
  })

  it("changes the home view and writes a shareable URL", async () => {  expect.hasAssertions();

  
    const user = userEvent.setup(),
     onViewChange = jest.fn()

    render(
      <GlobalNavigation
        currentView="grid"
        navigationServices={navigationServices}
        onViewChange={onViewChange}
      />,
    )
    await user.click(screen.getByRole("button", { name: "Globe" }))

    expect(onViewChange).toHaveBeenCalledWith("globe")
    expect(replace).toHaveBeenCalledWith("/?view=globe", { scroll: false })
  })

  it("restores a requested view when arriving from another route", async () => {  expect.hasAssertions();

  
    globalThis.history.replaceState({}, "", "/?view=blindspot")
    const onViewChange = jest.fn()

    render(
      <GlobalNavigation
        currentView="grid"
        navigationServices={navigationServices}
        onViewChange={onViewChange}
      />,
    )

    await waitFor(() =>{  expect(onViewChange).toHaveBeenCalledWith("blindspot"); })
  })

  it("routes view choices back to the matching home URL from another page", async () => {  expect.hasAssertions();

  
    pathname = "/wiki"
    const user = userEvent.setup()

    render(<GlobalNavigation navigationServices={navigationServices} />)
    await user.click(screen.getByRole("button", { name: "Live" }))

    expect(push).toHaveBeenCalledWith("/?view=live-news")
  })

  it("expands into an accessible search form and submits encoded queries", async () => {  expect.hasAssertions();

  
    const user = userEvent.setup()

    render(<GlobalNavigation navigationServices={navigationServices} />)
    await user.click(screen.getByRole("button", { name: "Open workspace search" }))

    const input = screen.getByRole("searchbox", { name: "Search the workspace" })
    await user.type(input, "public media ownership")
    await user.click(screen.getByRole("button", { name: "Submit search" }))

    expect(push).toHaveBeenCalledWith("/search?query=public%20media%20ownership")
  })

  it("persists explicit sidebar expansion", async () => {  expect.hasAssertions();

  
    const user = userEvent.setup()

    render(<GlobalNavigation navigationServices={navigationServices} />)
    await user.click(screen.getByRole("button", { name: "Expand navigation" }))

    expect(globalThis.localStorage.getItem("scoop:sidebar-expanded")).toBe("true")
    expect(screen.getByRole("complementary", { name: "Primary workspace navigation" })).toHaveAttribute(
      "data-expanded",
      "true",
    )
  })

  it("marks library routes as active", () => {  expect.hasAssertions();

  
    pathname = "/sources"

    render(<GlobalNavigation navigationServices={navigationServices} />)

    expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page")
  })

  it("exposes the Atlas as the only media intelligence workspace", () => {  expect.hasAssertions();

  
    pathname = "/wiki/ownership"

    render(<GlobalNavigation navigationServices={navigationServices} />)

    expect(screen.getByRole("link", { name: "Intelligence Atlas" })).toHaveAttribute(
      "aria-current",
      "page",
    )
    expect(screen.queryByRole("link", { name: "Media Wiki" })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: "Reporter Graph" })).not.toBeInTheDocument()
  })
})
