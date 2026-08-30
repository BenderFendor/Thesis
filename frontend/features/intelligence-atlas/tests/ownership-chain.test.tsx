import { describe, expect, it } from '@jest/globals';
import { render, screen } from "@testing-library/react";

import { OwnershipChain } from "../ownership-chain";
import type { AtlasOwnershipChainHop } from "../lib/atlas-schema";

function hop(overrides: Partial<AtlasOwnershipChainHop>): AtlasOwnershipChainHop {
  return {
    claim_ids: [],
    entity_id: "organization:root",
    entity_type: "organization",
    evidence_count: 0,
    label: "Root Holdings",
    percentage: null,
    percentage_range: null,
    profile_path: null,
    ...overrides,
  };
}

describe("ownershipChain", () => {
  it("renders nothing when the chain is self-only", () => {  expect.hasAssertions();
  
    const { container } = render(
      <OwnershipChain
        chain={[hop({ entity_id: "outlet:abc", entity_type: "outlet", label: "Daily Beacon" })]}
        currentEntityId="outlet:abc"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders hops top-down (ultimate owner first, this entity last) with percentage and evidence badges", () => {  expect.hasAssertions();
  
    const chain: AtlasOwnershipChainHop[] = [
      hop({ entity_id: "outlet:abc", entity_type: "outlet", label: "Daily Beacon", profile_path: "/wiki/suource/Daily%20Beacon" }),
      hop({
        claim_ids: ["claim-1"],
        entity_id: "organization:org-a",
        entity_type: "organization",
        evidence_count: 2,
        label: "Org A",
        percentage: 100,
        profile_path: "/wiki/organization/org-a",
      }),
      hop({
        claim_ids: ["claim-2"],
        entity_id: "organization:org-b",
        entity_type: "organization",
        evidence_count: 1,
        label: "Org B",
        percentage_range: { lower: 55, upper: 65 },
        profile_path: "/wiki/organization/org-b",
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
