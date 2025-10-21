import React from "react";
import { render, screen } from "@testing-library/react";

import { InlineDefinitionPopover } from "@/components/inline-definition";

describe("InlineDefinitionPopover", () => {
  afterEach(() => {
    jest.resetAllMocks();
  });

  it("renders nothing when closed", () => {
    const { container } = render(
      <InlineDefinitionPopover result={null} open={false} setOpen={jest.fn()} anchorRef={{ current: null }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders term and definition when open", () => {
    render(
      <InlineDefinitionPopover
        result={{ term: "Janet Yellen", definition: "Former U.S. Treasury Secretary." }}
        open={true}
        setOpen={jest.fn()}
        anchorRef={{ current: { x: 100, y: 200 } }}
      />
    );

    expect(screen.getByText("Janet Yellen")).toBeInTheDocument();
    expect(screen.getByText(/Former U.S. Treasury Secretary/)).toBeInTheDocument();
  });
});
