import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import { useRef } from "react";

import { HighlightToolbar } from "@/components/highlight-toolbar";

type HighlightToolbarProps = ComponentProps<typeof HighlightToolbar>;

const EMPTY_HIGHLIGHTS: HighlightToolbarProps["highlights"] = [],
 NOOP_UPDATE = jest.fn<HighlightToolbarProps["onUpdate"]>(),
 NOOP_DELETE = jest.fn<HighlightToolbarProps["onDelete"]>();

const HighlightToolbarHarness = ({
 articleContainer,
 onCreate,
}: Readonly<{ articleContainer: HTMLDivElement; onCreate: HighlightToolbarProps["onCreate"] }>) => {
 const containerRef = useRef<HTMLDivElement>(articleContainer);
 return (
  <HighlightToolbar
   articleUrl="https://example.com/story"
   containerRef={containerRef}
   highlightColor="yellow"
   autoCreate
   highlights={EMPTY_HIGHLIGHTS}
   onCreate={onCreate}
   onUpdate={NOOP_UPDATE}
   onDelete={NOOP_DELETE}
  />
 );
};

describe("highlightToolbar", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not auto-create highlights for selections outside the article container", () => {  expect.hasAssertions();


    const articleContainer = document.createElement("div");
    document.body.append(articleContainer);

    const outside = document.createElement("div");
    outside.textContent = "Outside selection";
    document.body.append(outside);

    const range = document.createRange();
    range.selectNodeContents(outside);
    Object.defineProperty(range, "getBoundingClientRect", {
      configurable: true,
      value: () => new DOMRect(10, 10, 20, 10),
    });
    const selection = window.getSelection();
    if (selection === null) {
      throw new Error("Selection API is unavailable in the test environment");
    }
    selection.removeAllRanges();
    selection.addRange(range);
    jest.spyOn(window, "getSelection").mockReturnValue(selection);

    const onCreate = jest.fn<HighlightToolbarProps["onCreate"]>();

    render(<HighlightToolbarHarness articleContainer={articleContainer} onCreate={onCreate} />);

    fireEvent.pointerUp(document);

    expect(onCreate).not.toHaveBeenCalled();
  });
});
