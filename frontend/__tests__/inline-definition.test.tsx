import { afterEach, describe, expect, it, jest } from '@jest/globals';
import React from "react";
import { render, screen } from "@testing-library/react";

import { InlineDefinitionPopover } from "@/components/inline-definition";

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
        result={{ definition: "Former U.S. Treasury Secretary.", term: "Janet Yellen" }}
        open
        setOpen={jest.fn()}
        anchorPosition={{ x: 100, y: 200 }}
      />
    );

    expect(screen.getByText("Janet Yellen")).toBeInTheDocument();
    expect(screen.getByText(/Former U.S. Treasury Secretary/u)).toBeInTheDocument();
  });
});
