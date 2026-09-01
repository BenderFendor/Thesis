import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { AtlasAccessibleList } from "../atlas-accessible-list";

const EDGES = [
    { source_id: "outlet:first", target_id: "outlet:second" },
    { source_id: "outlet:first", target_id: "organization:owner" },
  ],
  FIRST_NODE_ID = "outlet:first",
  NODES = [
    { entity_type: "outlet", id: "outlet:first", label: "First outlet" },
    { entity_type: "outlet", id: "outlet:second", label: "Second outlet" },
  ],
  SECOND_NODE_ID = "outlet:second",
  selectNode = jest.fn<(nodeId: string) => void>();

describe("atlas accessible list", () => {
  it("renders real connection counts and sends the clicked node id", () => {
    expect.hasAssertions();

    render(
      <AtlasAccessibleList
        edges={EDGES}
        nodes={NODES}
        onSelect={selectNode}
        selectedId={FIRST_NODE_ID}
      />,
    );

    expect(screen.getByRole("button", { name: /First outlet/u })).toHaveTextContent("2 visible connections");
    expect(screen.getByRole("button", { name: /First outlet/u })).toHaveAttribute("aria-pressed", "true");
    screen.getByRole("button", { name: /Second outlet/u }).click();
    expect(selectNode).toHaveBeenCalledWith(SECOND_NODE_ID);
  });
});
