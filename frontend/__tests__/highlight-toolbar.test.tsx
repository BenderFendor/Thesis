import React from "react";
import { fireEvent, render } from "@testing-library/react";

import { HighlightToolbar } from "@/components/highlight-toolbar";

jest.mock("lucide-react", () => {
  const Icon = (props: React.SVGProps<SVGSVGElement>) => <svg aria-hidden="true" {...props} />;
  return {
    Highlighter: Icon,
    X: Icon,
  };
});

jest.mock("sonner", () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock("@/lib/api", () => ({
  ENABLE_HIGHLIGHTS: true,
}));

describe("HighlightToolbar", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not auto-create highlights for selections outside the article container", () => {
    const articleContainer = document.createElement("div");
    document.body.appendChild(articleContainer);

    const outside = document.createElement("div");
    outside.textContent = "Outside selection";
    document.body.appendChild(outside);

    const outsideText = outside.firstChild as Text;
    const selection = {
      rangeCount: 1,
      isCollapsed: false,
      anchorNode: outsideText,
      focusNode: outsideText,
      toString: () => "Outside selection",
      getRangeAt: () =>
        ({
          startContainer: outsideText,
          endContainer: outsideText,
          startOffset: 0,
          endOffset: 7,
          commonAncestorContainer: outsideText,
          getBoundingClientRect: () => new DOMRect(10, 10, 20, 10),
        }) as unknown as Range,
    } as unknown as Selection;

    jest.spyOn(window, "getSelection").mockReturnValue(selection);

    const onCreate = jest.fn();

    render(
      <HighlightToolbar
        articleUrl="https://example.com/story"
        containerRef={{ current: articleContainer }}
        highlightColor="yellow"
        autoCreate={true}
        highlights={[]}
        onCreate={onCreate}
        onUpdate={jest.fn()}
        onDelete={jest.fn()}
      />,
    );

    fireEvent.pointerUp(document);

    expect(onCreate).not.toHaveBeenCalled();
  });
});
