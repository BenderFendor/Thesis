import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { InlineDefinitionPopover } from "@/components/inline-definition";
import type { InlineDefinitionPopoverProps } from "@/components/inline-definition";

import React from "react";

const OPEN_ANCHOR_POSITION = {
    "x": 100,
    "y": 200,
  } satisfies NonNullable<InlineDefinitionPopoverProps["anchorPosition"]>,
  OPEN_DEFINITION_RESULT = {
    definition: "Former U.S. Treasury Secretary.",
    term: "Janet Yellen",
  } satisfies NonNullable<InlineDefinitionPopoverProps["result"]>;

describe("inlineDefinitionPopover", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders nothing when closed", () => {
    expect.hasAssertions();

    const { container } = render(
      <InlineDefinitionPopover
        result={null}
        open={false}
        setOpen={jest.fn<(open: boolean) => void>()}
        anchorPosition={null}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders term and definition when open", () => {
    expect.hasAssertions();

    render(
      <InlineDefinitionPopover
        result={OPEN_DEFINITION_RESULT}
        open
        setOpen={jest.fn<(open: boolean) => void>()}
        anchorPosition={OPEN_ANCHOR_POSITION}
      />,
    );

    expect(screen.getByText("Janet Yellen")).toBeInTheDocument();
    expect(screen.getByText(/Former U.S. Treasury Secretary/u)).toBeInTheDocument();
  });
});
