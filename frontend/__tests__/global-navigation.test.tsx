import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import { GlobalNavigation } from "@/components/global-navigation";

import type { GlobalNavigationServices, ViewMode } from "@/components/global-navigation";
import userEvent from "@testing-library/user-event";

const push = jest.fn<(href: string) => void>();
const replace = jest.fn<(href: string, options?: { readonly scroll?: boolean }) => void>();
const pathname = { value: "/" };
const navigationServices: GlobalNavigationServices = {
    usePathname: () => pathname.value,
    useRouter: () => ({ push, replace }),
  };

type NavigationTestCase = readonly [string, () => Promise<void> | void];

const navigationTestCases: readonly NavigationTestCase[] = [
  [
    "changes the home view and writes a shareable URL",
    async () => {
      const onViewChange = jest.fn<(view: ViewMode) => void>(),
        user = userEvent.setup();

      render(
        <GlobalNavigation
          currentView="grid"
          navigationServices={navigationServices}
          onViewChange={onViewChange}
        />,
      );
      await user.click(screen.getByRole("button", { name: "Globe" }));

      expect(onViewChange).toHaveBeenCalledWith("globe");
      expect(replace).toHaveBeenCalledWith("/?view=globe", { scroll: false });
    },
  ],
  [
    "restores a requested view when arriving from another route",
    async () => {
      globalThis.history.replaceState({}, "", "/?view=blindspot");
      const onViewChange = jest.fn<(view: ViewMode) => void>();

      render(
        <GlobalNavigation
          currentView="grid"
          navigationServices={navigationServices}
          onViewChange={onViewChange}
        />,
      );

      await waitFor(() => {
        expect(onViewChange).toHaveBeenCalledWith("blindspot");
      });
      expect(onViewChange).toHaveBeenCalledWith("blindspot");
    },
  ],
  [
    "routes view choices back to the matching home URL from another page",
    async () => {
      pathname.value = "/wiki";
      const user = userEvent.setup();

      render(<GlobalNavigation navigationServices={navigationServices} />);
      await user.click(screen.getByRole("button", { name: "Live" }));

      expect(push).toHaveBeenCalledWith("/?view=live-news");
    },
  ],
  [
    "expands into an accessible search form and submits encoded queries",
    async () => {
      const user = userEvent.setup();

      render(<GlobalNavigation navigationServices={navigationServices} />);
      await user.click(screen.getByRole("button", { name: "Open workspace search" }));

      const input = screen.getByRole("searchbox", { name: "Search the workspace" });
      await user.type(input, "public media ownership");
      await user.click(screen.getByRole("button", { name: "Submit search" }));

      expect(push).toHaveBeenCalledWith("/search?query=public%20media%20ownership");
    },
  ],
  [
    "persists explicit sidebar expansion",
    async () => {
      const user = userEvent.setup();

      render(<GlobalNavigation navigationServices={navigationServices} />);
      await user.click(screen.getByRole("button", { name: "Expand navigation" }));

      expect(globalThis.localStorage.getItem("scoop:sidebar-expanded")).toBe("true");
      expect(
        screen.getByRole("complementary", { name: "Primary workspace navigation" }),
      ).toHaveAttribute("data-expanded", "true");
    },
  ],
  [
    "marks library routes as active",
    () => {
      pathname.value = "/sources";

      render(<GlobalNavigation navigationServices={navigationServices} />);

      expect(screen.getByRole("link", { name: "Sources" })).toHaveAttribute("aria-current", "page");
    },
  ],
  [
    "exposes the Atlas as the only media intelligence workspace",
    () => {
      pathname.value = "/wiki/ownership";

      render(<GlobalNavigation navigationServices={navigationServices} />);

      expect(screen.getByRole("link", { name: "Intelligence Atlas" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(screen.queryByRole("link", { name: "Media Wiki" })).not.toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Reporter Graph" })).not.toBeInTheDocument();
    },
  ],
];

describe("globalNavigation", () => {
  beforeEach(() => {
    pathname.value = "/";
    push.mockReset();
    replace.mockReset();
    globalThis.localStorage.clear();
    globalThis.history.replaceState({}, "", "/");
  });

  it.each(navigationTestCases)("%s", async (_name, run): Promise<void> => {
    await run();
    expect.hasAssertions();
  });
});
