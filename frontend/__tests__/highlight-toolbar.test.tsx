import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render } from "@testing-library/react";
import type { ComponentProps } from "react";
import type { Highlight } from "@/lib/api";

import { HighlightToolbar } from "@/components/highlight-toolbar";

type HighlightToolbarProps = ComponentProps<typeof HighlightToolbar>;
interface TestContainerRef {
  current: HTMLElement | null;
}
interface OutsideSelection {
  readonly articleContainer: HTMLDivElement;
  readonly selection: Selection;
}

const EMPTY_HIGHLIGHTS: readonly Highlight[] = [];
const containerRef: TestContainerRef = { current: null };

const getBrowserSelection = (): Selection => {
  const selection = window.getSelection();
  if (selection === null) {
    throw new Error("Expected a browser selection");
  }
  return selection;
};

const createOutsideSelection = (): OutsideSelection => {
  const articleContainer = document.createElement("div");
  const outside = document.createElement("div");
  outside.textContent = "Outside selection";
  document.body.append(articleContainer, outside);

  const range = document.createRange();
  range.selectNodeContents(outside);
  const selection = getBrowserSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  return { articleContainer, selection };
};

describe("highlightToolbar", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not auto-create highlights for selections outside the article container", () => {
    expect.hasAssertions();

    const { articleContainer, selection } = createOutsideSelection();
    containerRef.current = articleContainer;

    jest.spyOn(window, "getSelection").mockReturnValue(selection);

    const onCreate = jest.fn<HighlightToolbarProps["onCreate"]>();

    render(
      <HighlightToolbar
        articleUrl="https://example.com/story"
        containerRef={containerRef}
        highlightColor="yellow"
        autoCreate
        highlights={EMPTY_HIGHLIGHTS}
        onCreate={onCreate}
        onUpdate={jest.fn<HighlightToolbarProps["onUpdate"]>()}
        onDelete={jest.fn<HighlightToolbarProps["onDelete"]>()}
      />,
    );

    fireEvent.pointerUp(document);

    expect(onCreate).not.toHaveBeenCalled();
  });
});
