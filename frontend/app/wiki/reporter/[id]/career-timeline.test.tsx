import { describe, expect, it } from '@jest/globals';
import { render, screen } from "@testing-library/react";

import { CareerTimeline } from "./career-timeline";
import type { ReporterCareerTimeline } from "@/lib/api";

interface TimelineOverrides {
  readonly shared_owner_findings?: readonly ReadonlySharedOwnerFinding[];
  readonly timeline?: readonly ReadonlyTimelineEntry[];
}

type ReadonlyOwnershipRef = Readonly<ReporterCareerTimeline["shared_owner_findings"][number]["owner"]>;
type ReadonlySharedOwnerFinding = Readonly<{
  readonly claim_ids: readonly string[];
  readonly evidence_count: number;
  readonly outlets: readonly ReadonlyOwnershipRef[];
  readonly owner: ReadonlyOwnershipRef;
}>;
type ReadonlyTimelineEntry = Readonly<ReporterCareerTimeline["timeline"][number]>;

const FIRST_LINK_INDEX = 0,
  affiliationEntry: ReporterCareerTimeline["timeline"][number] = {
    end_date: "2018-01-01",
    evidence_url: "https://littlesis.org/entities/999",
    outlet: "Press Freedom Institute",
    role: "board member",
    source: "affiliation",
    start_date: "2015-01-01",
  },
  bylineEntry: ReporterCareerTimeline["timeline"][number] = {
    article_count: 12,
    end_date: "2021-06-01",
    outlet: "Daily Beacon",
    source: "byline",
    start_date: "2020-01-01",
  },
  sharedOwnerFinding: ReporterCareerTimeline["shared_owner_findings"][number] = {
    claim_ids: ["claim-1", "claim-2"],
    evidence_count: 3,
    outlets: [
      {
        entity_id: "outlet:beacon",
        entity_type: "outlet",
        label: "Daily Beacon",
        profile_path: "/wiki/source/Daily%20Beacon",
      },
      {
        entity_id: "outlet:ledger",
        entity_type: "outlet",
        label: "Nightly Ledger",
        profile_path: "/wiki/source/Nightly%20Ledger",
      },
    ],
    owner: {
      entity_id: "organization:ent_org",
      entity_type: "organization",
      label: "Mega Corp",
      profile_path: "/wiki/organization/ent_org",
    },
  },
  sharedOwnerTimeline: readonly ReadonlyTimelineEntry[] = [
    {
      article_count: 5,
      end_date: "2021-01-01",
      outlet: "Daily Beacon",
      source: "byline",
      start_date: "2020-01-01",
    },
    {
      article_count: 3,
      end_date: "2022-01-01",
      outlet: "Nightly Ledger",
      source: "byline",
      start_date: "2021-02-01",
    },
  ],
  timeline = (overrides: TimelineOverrides = {}): ReporterCareerTimeline => ({
    shared_owner_findings: Array.from(overrides.shared_owner_findings ?? [], ({ claim_ids, evidence_count, outlets, owner }) => ({
      claim_ids: [...claim_ids],
      evidence_count,
      outlets: Array.from(outlets, ({ entity_id, entity_type, label, profile_path }) => ({
        entity_id,
        entity_type,
        label,
        profile_path,
      })),
      owner: {
        entity_id: owner.entity_id,
        entity_type: owner.entity_type,
        label: owner.label,
        profile_path: owner.profile_path,
      },
    })),
    timeline: [...(overrides.timeline ?? [])],
  });

describe("careerTimeline", () => {
  it("renders nothing when there is no timeline data", () => {
    expect.hasAssertions();
    const { container } = render(<CareerTimeline data={timeline()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders byline and affiliation entries with badges, date ranges, and evidence links", () => {
    expect.hasAssertions();
    render(<CareerTimeline data={timeline({ timeline: [affiliationEntry, bylineEntry] })} />);

    expect(screen.getByRole("link", { name: "Press Freedom Institute" })).toHaveAttribute(
      "href",
      "/wiki/source/Press%20Freedom%20Institute",
    );
    expect(screen.getByText("Affiliation")).toBeInTheDocument();
    expect(screen.getByText("Byline")).toBeInTheDocument();
    expect(screen.getByText("12 articles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Evidence/u })).toHaveAttribute(
      "href",
      "https://littlesis.org/entities/999",
    );
  });

  it("renders a neutral shared-owner annotation with links to outlets and the owner", () => {
    expect.hasAssertions();
    render(
      <CareerTimeline
        data={timeline({
          shared_owner_findings: [sharedOwnerFinding],
          timeline: sharedOwnerTimeline,
        })}
      />,
    );

    expect(screen.getByText(/Reported for/u)).toBeInTheDocument();
    expect(screen.getByText(/both ultimately owned by/u)).toBeInTheDocument();

    const outletLinks = screen.getAllByRole("link", { name: "Daily Beacon" }),
      ownerLinks = screen.getAllByRole("link", { name: "Mega Corp" });
    expect(outletLinks[FIRST_LINK_INDEX]).toHaveAttribute("href", "/wiki/source/Daily%20Beacon");
    expect(ownerLinks[FIRST_LINK_INDEX]).toHaveAttribute("href", "/wiki/organization/ent_org");

    expect(screen.getByText(/3 evidence · view ownership chain/u)).toBeInTheDocument();
  });
});
