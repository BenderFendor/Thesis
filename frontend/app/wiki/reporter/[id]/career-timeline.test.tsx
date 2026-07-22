import { render, screen } from "@testing-library/react";

import { CareerTimeline } from "./career-timeline";
import type { ReporterCareerTimeline } from "@/lib/api";

function timeline(overrides: Partial<ReporterCareerTimeline> = {}): ReporterCareerTimeline {
  return {
    timeline: [],
    shared_owner_findings: [],
    ...overrides,
  };
}

describe("CareerTimeline", () => {
  it("renders nothing when there is no timeline data", () => {
    const { container } = render(<CareerTimeline data={timeline()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders byline and affiliation entries with badges, date ranges, and evidence links", () => {
    const data = timeline({
      timeline: [
        {
          source: "affiliation",
          outlet: "Press Freedom Institute",
          start_date: "2015-01-01",
          end_date: "2018-01-01",
          article_count: null,
          role: "board member",
          evidence_url: "https://littlesis.org/entities/999",
        },
        {
          source: "byline",
          outlet: "Daily Beacon",
          start_date: "2020-01-01",
          end_date: "2021-06-01",
          article_count: 12,
          role: null,
          evidence_url: null,
        },
      ],
      shared_owner_findings: [],
    });

    render(<CareerTimeline data={data} />);

    expect(screen.getByRole("link", { name: "Press Freedom Institute" })).toHaveAttribute(
      "href",
      "/wiki/source/Press%20Freedom%20Institute",
    );
    expect(screen.getByText("Affiliation")).toBeInTheDocument();
    expect(screen.getByText("Byline")).toBeInTheDocument();
    expect(screen.getByText("12 articles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Evidence/ })).toHaveAttribute(
      "href",
      "https://littlesis.org/entities/999",
    );
  });

  it("renders a neutral shared-owner annotation with links to outlets and the owner", () => {
    const data = timeline({
      timeline: [
        {
          source: "byline",
          outlet: "Daily Beacon",
          start_date: "2020-01-01",
          end_date: "2021-01-01",
          article_count: 5,
          role: null,
          evidence_url: null,
        },
        {
          source: "byline",
          outlet: "Nightly Ledger",
          start_date: "2021-02-01",
          end_date: "2022-01-01",
          article_count: 3,
          role: null,
          evidence_url: null,
        },
      ],
      shared_owner_findings: [
        {
          owner: {
            entity_id: "organization:ent_org",
            label: "Mega Corp",
            entity_type: "organization",
            profile_path: "/wiki/organization/ent_org",
          },
          outlets: [
            {
              entity_id: "outlet:beacon",
              label: "Daily Beacon",
              entity_type: "outlet",
              profile_path: "/wiki/source/Daily%20Beacon",
            },
            {
              entity_id: "outlet:ledger",
              label: "Nightly Ledger",
              entity_type: "outlet",
              profile_path: "/wiki/source/Nightly%20Ledger",
            },
          ],
          evidence_count: 3,
          claim_ids: ["claim-1", "claim-2"],
        },
      ],
    });

    render(<CareerTimeline data={data} />);

    expect(screen.getByText(/Reported for/)).toBeInTheDocument();
    expect(screen.getByText(/both ultimately owned by/)).toBeInTheDocument();

    const outletLinks = screen.getAllByRole("link", { name: "Daily Beacon" });
    expect(outletLinks.some((link) => link.getAttribute("href") === "/wiki/source/Daily%20Beacon")).toBe(true);

    const ownerLinks = screen.getAllByRole("link", { name: "Mega Corp" });
    expect(ownerLinks.some((link) => link.getAttribute("href") === "/wiki/organization/ent_org")).toBe(true);

    expect(screen.getByText(/3 evidence · view ownership chain/)).toBeInTheDocument();
  });
});
