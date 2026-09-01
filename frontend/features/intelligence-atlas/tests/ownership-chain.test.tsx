import { describe, expect, it } from '@jest/globals';
import { render, screen } from "@testing-library/react";
import type { AtlasOwnershipChainHop } from "../lib/atlas-schema";
import { OwnershipChain } from "../ownership-chain";

const CHAIN_ITEM_COUNT = 3,
 FIRST_CHAIN_ITEM_INDEX = 0,
 NO_EVIDENCE_COUNT = 0,
 SECOND_CHAIN_ITEM_INDEX = 1,
 THIRD_CHAIN_ITEM_INDEX = 2,
 hop = ({
  claim_ids = [],
  entity_id = "organization:root",
  entity_type = "organization",
  evidence_count = NO_EVIDENCE_COUNT,
  label = "Root Holdings",
  percentage,
  percentage_range,
  profile_path,
 }: {
  readonly claim_ids?: readonly string[];
  readonly entity_id?: AtlasOwnershipChainHop["entity_id"];
  readonly entity_type?: AtlasOwnershipChainHop["entity_type"];
  readonly evidence_count?: AtlasOwnershipChainHop["evidence_count"];
  readonly label?: AtlasOwnershipChainHop["label"];
  readonly percentage?: AtlasOwnershipChainHop["percentage"];
  readonly percentage_range?: {
    readonly lower: number;
    readonly upper: number;
  };
  readonly profile_path?: AtlasOwnershipChainHop["profile_path"];
 }): AtlasOwnershipChainHop => ({
    claim_ids: [...claim_ids],
    entity_id,
    entity_type,
    evidence_count,
    label,
    percentage,
    percentage_range,
    profile_path,
  }),
 ownershipChain: readonly AtlasOwnershipChainHop[] = [
  hop({ entity_id: "outlet:abc", entity_type: "outlet", label: "Daily Beacon", profile_path: "/wiki/source/Daily%20Beacon" }),
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
],
 selfOnlyChain: readonly AtlasOwnershipChainHop[] = [
  hop({ entity_id: "outlet:abc", entity_type: "outlet", label: "Daily Beacon" }),
];

describe("ownershipChain", () => {
  it("renders nothing when the chain is self-only", () => {
    expect.hasAssertions();
    const { container } = render(
      <OwnershipChain
        chain={selfOnlyChain}
        currentEntityId="outlet:abc"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders hops top-down from ultimate owner to current entity", () => {
    expect.hasAssertions();
    render(<OwnershipChain chain={ownershipChain} currentEntityId="outlet:abc" />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(CHAIN_ITEM_COUNT);
    expect(items[FIRST_CHAIN_ITEM_INDEX]).toHaveTextContent("Org B");
    expect(items[SECOND_CHAIN_ITEM_INDEX]).toHaveTextContent("Org A");
    expect(items[THIRD_CHAIN_ITEM_INDEX]).toHaveTextContent("Daily Beacon");
  });

  it("renders ownership percentages and relationship badges", () => {
    expect.hasAssertions();
    render(<OwnershipChain chain={ownershipChain} currentEntityId="outlet:abc" />);
    const items = screen.getAllByRole("listitem");
    expect(items[FIRST_CHAIN_ITEM_INDEX]).toHaveTextContent("55.0–65.0%");
    expect(items[FIRST_CHAIN_ITEM_INDEX]).toHaveTextContent("ultimate owner");
    expect(items[SECOND_CHAIN_ITEM_INDEX]).toHaveTextContent("100.0%");
    expect(items[THIRD_CHAIN_ITEM_INDEX]).toHaveTextContent("this entity");
  });

  it("links non-current entities and leaves the current entity unlinked", () => {
    expect.hasAssertions();
    render(<OwnershipChain chain={ownershipChain} currentEntityId="outlet:abc" />);
    const orgALink = screen.getByRole("link", { name: /Org A/u });
    expect(orgALink).toHaveAttribute("href", "/wiki/organization/org-a");
    expect(screen.queryByRole("link", { name: /Daily Beacon/u })).not.toBeInTheDocument();
  });
});
