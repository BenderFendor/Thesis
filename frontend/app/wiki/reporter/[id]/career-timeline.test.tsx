import { describe, expect, it } from '@jest/globals';
import { render, screen } from "@testing-library/react";

import { CareerTimeline } from "./career-timeline";
import type { ReporterCareerTimeline } from "@/lib/api";

function timeline(overrides: Partial<ReporterCareerTimeline> = {}): ReporterCareerTimeline {
  return {
    shared_owner_findings: [],
    timeline: [],
    ...overrides,
  };
}

describe("careerTimeline", () => {
  it("renders nothing when there is no timeline data", () => {  expect.hasAssertions();
  
    const { container } = render(<CareerTimeline data={timeline()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders byline and affiliation entries with badges, date ranges, and evidence links", () => {  expect.hasAssertions();
  
    const data = timeline({
      shared_owner_findings: [],
      timeline: [
        {
          article_count: null,
          end_date: "2018-01-01",
          evidence_url: "https://littlesis.org/entities/999",
          outlet: "Press Freedom Institute",
          role: "board member",
          source: "affiliation",
          start_date: "2015-01-01",
        },
        {
          article_count: 12,
          end_date: "2021-06-01",
          evidence_url: null,
          outlet: "Daily Beacon",
          role: null,
          source: "byline",
          start_date: "2020-01-01",
        },
      ],
    });

    render(<CareerTimeline data={data} />);

    expect(screen.getByRole("link", { name: "Press Freedom Institute" })).toHaveAttribute(
      "href",
      "/wiki/suource/Press%20Freedom%20Institute",
    );
    expect(screen.getByText("Affiliation")).toBeInTheDocument();
    expect(screen.getByText("Byline")).toBeInTheDocument();
    expect(screen.getByText("12 articles")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Evidence/ })).toHaveAttribute(
      "href",
      "https://littlesis.org/entities/999",
    );
  });

  it("renders a neutral shared-owner annotation with links to outlets and the owner", () => {  expect.hasAssertions();
  
    const data = timeline({
      shared_owner_findings: [
        {
          claim_ids: ["claim-1", "claim-2"],
          evidence_count: 3,
          outlets: [
            {
              entity_id: "outlet:beacon",
              entity_type: "outlet",
              label: "Daily Beacon",
              profile_path: "/wiki/suource/Daily%20Beacon",
            },
            {
              entity_id: "outlet:ledger",
              entity_type: "outlet",
              label: "Nightly Ledger",
              profile_path: "/wiki/suource/Nightly%20Ledger",
            },
          ],
          owner: {
            entity_id: "organization:ent_org",
            entity_type: "organization",
            label: "Mega Corp",
            profile_path: "/wiki/organization/ent_org",
          },
        },
      ],
      timeline: [
        {
          article_count: 5,
          end_date: "2021-01-01",
          evidence_url: null,
          outlet: "Daily Beacon",
          role: null,
          source: "byline",
          start_date: "2020-01-01",
        },
        {
          article_count: 3,
          end_date: "2022-01-01",
          evidence_url: null,
          outlet: "Nightly Ledger",
          role: null,
          source: "byline",
          start_date: "2021-02-01",
        },
      ],
    });

    render(<CareerTimeline data={data} />);

    expect(screen.getByText(/Reported for/)).toBeInTheDocument();
    expect(screen.getByText(/both ultimately owned by/)).toBeInTheDocument();

    const outletLinks = screen.getAllByRole("link", { name: "Daily Beacon" });
    expect(outletLinks.some((link) => link.getAttribute("href") === "/wiki/suource/Daily%20Beacon")).toBe(true);

    const ownerLinks = screen.getAllByRole("link", { name: "Mega Corp" });
    expect(ownerLinks.some((link) => link.getAttribute("href") === "/wiki/organization/ent_org")).toBe(true);

    expect(screen.getByText(/3 evidence · view ownership chain/)).toBeInTheDocument();
  });
});
