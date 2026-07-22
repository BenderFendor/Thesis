import { render, screen } from "@testing-library/react";

import { OwnershipChain } from "../ownership-chain";
import type { AtlasOwnershipChainHop } from "../lib/atlas-schema";

function hop(overrides: Partial<AtlasOwnershipChainHop>): AtlasOwnershipChainHop {
  return {
    entity_id: "organization:root",
    label: "Root Holdings",
    entity_type: "organization",
    profile_path: null,
    percentage: null,
    percentage_range: null,
    evidence_count: 0,
    claim_ids: [],
    ...overrides,
  };
}

describe("OwnershipChain", () => {
  it("renders nothing when the chain is self-only", () => {
    const { container } = render(
      <OwnershipChain
        chain={[hop({ entity_id: "outlet:abc", label: "Daily Beacon", entity_type: "outlet" })]}
        currentEntityId="outlet:abc"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders hops top-down (ultimate owner first, this entity last) with percentage and evidence badges", () => {
    const chain: AtlasOwnershipChainHop[] = [
      hop({ entity_id: "outlet:abc", label: "Daily Beacon", entity_type: "outlet", profile_path: "/wiki/source/Daily%20Beacon" }),
      hop({
        entity_id: "organization:org-a",
        label: "Org A",
        entity_type: "organization",
        profile_path: "/wiki/organization/org-a",
        percentage: 100,
        evidence_count: 2,
        claim_ids: ["claim-1"],
      }),
      hop({
        entity_id: "organization:org-b",
        label: "Org B",
        entity_type: "organization",
        profile_path: "/wiki/organization/org-b",
        percentage_range: { lower: 55, upper: 65 },
        evidence_count: 1,
        claim_ids: ["claim-2"],
      }),
    ];

    render(<OwnershipChain chain={chain} currentEntityId="outlet:abc" />);

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    // Top-down: ultimate owner (Org B) first, this entity (Daily Beacon) last.
    expect(items[0]).toHaveTextContent("Org B");
    expect(items[0]).toHaveTextContent("55.0–65.0%");
    expect(items[0]).toHaveTextContent("ultimate owner");
    expect(items[1]).toHaveTextContent("Org A");
    expect(items[1]).toHaveTextContent("100.0%");
    expect(items[2]).toHaveTextContent("Daily Beacon");
    expect(items[2]).toHaveTextContent("this entity");

    const orgALink = screen.getByRole("link", { name: /Org A/ });
    expect(orgALink).toHaveAttribute("href", "/wiki/organization/org-a");
    // The current entity's own hop is not a link.
    expect(screen.queryByRole("link", { name: /Daily Beacon/ })).not.toBeInTheDocument();
  });
});
