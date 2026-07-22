import { render, screen } from "@testing-library/react";

import { FundingBiasPanel } from "../funding-bias-panel";
import type { AtlasFundingAndBias, AtlasFundingBiasField } from "../lib/atlas-schema";

function field(overrides: Partial<AtlasFundingBiasField>): AtlasFundingBiasField {
  return {
    value: null,
    origin: null,
    asserted_by: null,
    source: null,
    claim_ids: [],
    evidence_count: 0,
    evidence: [],
    ...overrides,
  };
}

function block(overrides: Partial<AtlasFundingAndBias>): AtlasFundingAndBias {
  return {
    funding_type: field({}),
    bias_rating: field({}),
    factual_reporting: field({}),
    ...overrides,
  };
}

describe("FundingBiasPanel", () => {
  it("always renders the correlation-not-causation caption, even with no data", () => {
    render(<FundingBiasPanel block={block({})} />);
    expect(
      screen.getByText(/Correlation shown, not proven causation/i),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded")).toHaveLength(3);
  });

  it("attributes an accepted MBFC claim by name and links to its evidence", () => {
    render(
      <FundingBiasPanel
        block={block({
          bias_rating: field({
            value: "Left-Center",
            origin: "claim",
            asserted_by: "mbfc",
            source: "mbfc",
            claim_ids: ["claim-1"],
            evidence_count: 1,
            evidence: [
              {
                id: "evidence-observation:obs-1",
                source_type: "third_party_assessment",
                source_name: "MBFC outlet record",
                source_url: "https://mediabiasfactcheck.com/example",
                excerpt: null,
                retrieved_at: null,
                snapshot_sha256: null,
                locator: {},
                entailment: "reviewed_yes",
              },
            ],
          }),
        })}
      />,
    );

    expect(screen.getByText("Left-Center")).toBeInTheDocument();
    expect(screen.getByText("MBFC")).toBeInTheDocument();
    expect(screen.getByText(/Rated by Media Bias\/Fact Check/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Bias rating evidence/i });
    expect(link).toHaveAttribute("href", "https://mediabiasfactcheck.com/example");
  });

  it("marks a legacy fallback value as uncited, with no evidence link", () => {
    render(
      <FundingBiasPanel
        block={block({
          funding_type: field({ value: "commercial", origin: "legacy" }),
        })}
      />,
    );
    expect(screen.getByText("commercial")).toBeInTheDocument();
    expect(screen.getByText("uncited")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
