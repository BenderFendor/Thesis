import { describe, expect, it } from '@jest/globals';
import { render, screen } from "@testing-library/react";

import { FundingBiasPanel } from "../funding-bias-panel";
import type { AtlasFundingAndBias, AtlasFundingBiasField } from "../lib/atlas-schema";

function field(overrides: Partial<AtlasFundingBiasField>): AtlasFundingBiasField {
  return {
    asserted_by: null,
    claim_ids: [],
    evidence: [],
    evidence_count: 0,
    origin: null,
    source: null,
    value: null,
    ...overrides,
  };
}

function block(overrides: Partial<AtlasFundingAndBias>): AtlasFundingAndBias {
  return {
    bias_rating: field({}),
    factual_reporting: field({}),
    funding_type: field({}),
    ...overrides,
  };
}

describe("fundingBiasPanel", () => {
  it("always renders the correlation-not-causation caption, even with no data", () => {  expect.hasAssertions();
  
    render(<FundingBiasPanel block={block({})} />);
    expect(
      screen.getByText(/Correlation shown, not proven causation/iu),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded")).toHaveLength(3);
  });

  it("attributes an accepted MBFC claim by name and links to its evidence", () => {  expect.hasAssertions();
  
    render(
      <FundingBiasPanel
        block={block({
          bias_rating: field({
            asserted_by: "mbfc",
            claim_ids: ["claim-1"],
            evidence: [
              {
                entailment: "reviewed_yes",
                excerpt: null,
                id: "evidence-observation:obs-1",
                locator: {},
                retrieved_at: null,
                snapshot_sha256: null,
                source_name: "MBFC outlet record",
                source_type: "third_party_assessment",
                source_url: "https://mediabiasfactcheck.com/example",
              },
            ],
            evidence_count: 1,
            origin: "claim",
            source: "mbfc",
            value: "Left-Center",
          }),
        })}
      />,
    );

    expect(screen.getByText("Left-Center")).toBeInTheDocument();
    expect(screen.getByText("MBFC")).toBeInTheDocument();
    expect(screen.getByText(/Rated by Media Bias\/Fact Check/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Bias rating evidence/iu });
    expect(link).toHaveAttribute("href", "https://mediabiasfactcheck.com/example");
  });

  it("marks a legacy fallback value as uncited, with no evidence link", () => {  expect.hasAssertions();
  
    render(
      <FundingBiasPanel
        block={block({
          funding_type: field({ origin: "legacy", value: "commercial" }),
        })}
      />,
    );
    expect(screen.getByText("commercial")).toBeInTheDocument();
    expect(screen.getByText("uncited")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
