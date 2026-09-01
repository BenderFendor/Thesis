import { afterEach, describe, expect, it, jest } from '@jest/globals';
import type { ComponentProps } from "react";
import { fireEvent, render } from "@testing-library/react";

import { HighlightToolbar } from "@/components/highlight-toolbar";

type HighlightToolbarProps = ComponentProps<typeof HighlightToolbar>;

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

    const outsideText = outside.firstChild as Text,
     selection = {
      anchorNode: outsideText,
      focusNode: outsideText,
      getRangeAt: () =>
        ({
          commonAncestorContainer: outsideText,
          endContainer: outsideText,
          endOffset: 7,
          getBoundingClientRect: () => new DOMRect(10, 10, 20, 10),
          startContainer: outsideText,
          startOffset: 0,
        }) as unknown as Range,
      isCollapsed: false,
      rangeCount: 1,
      toString: () => "Outside selection",
    } as unknown as Selection;

    jest.spyOn(window, "getSelection").mockReturnValue(selection);

    const onCreate = jest.fn<HighlightToolbarProps["onCreate"]>();

    render(
      <HighlightToolbar
        articleUrl="https://example.com/story"
        containerRef={{ current: articleContainer }}
        highlightColor="yellow"
        autoCreate
        highlights={[]}
        onCreate={onCreate}
        onUpdate={jest.fn<HighlightToolbarProps["onUpdate"]>()}
        onDelete={jest.fn<HighlightToolbarProps["onDelete"]>()}
      />,
    );

    fireEvent.pointerUp(document);

    expect(onCreate).not.toHaveBeenCalled();
  });
});
