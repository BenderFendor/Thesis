import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { render, screen } from "@testing-library/react";
import { InlineDefinitionPopover } from "@/components/inline-definition";

import React from "react";

const DEFINITION_RESULT = { definition: "Former U.S. Treasury Secretary.", term: "Janet Yellen" },
 ANCHOR_POSITION = { x: 100, y: 200 };

describe("inlineDefinitionPopover", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders nothing when closed", () => {  expect.hasAssertions();
  
    const { container } = render(
      <InlineDefinitionPopover result={null} open={false} setOpen={jest.fn()} anchorPosition={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders term and definition when open", () => {  expect.hasAssertions();
  
    render(
      <InlineDefinitionPopover
        result={DEFINITION_RESULT}
        open
        setOpen={jest.fn()}
        anchorPosition={ANCHOR_POSITION}
      />
    );

    expect(screen.getByText("Janet Yellen")).toBeInTheDocument();
    expect(screen.getByText(/Former U.S. Treasury Secretary/u)).toBeInTheDocument();
  });
});
