import { describe, expect, it } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { AtlasFundingAndBias } from "../lib/atlas-schema";
import { FundingBiasPanel } from "../funding-bias-panel";

const A_EMPTY_COUNT = 0,
  A_EVIDENCE_COUNT = 1,
  EMPTY_BLOCK: AtlasFundingAndBias = {
    bias_rating: { claim_ids: [], evidence: [], evidence_count: A_EMPTY_COUNT },
    factual_reporting: { claim_ids: [], evidence: [], evidence_count: A_EMPTY_COUNT },
    funding_type: { claim_ids: [], evidence: [], evidence_count: A_EMPTY_COUNT },
  },
  LEGACY_BLOCK: AtlasFundingAndBias = {
    bias_rating: { claim_ids: [], evidence: [], evidence_count: A_EMPTY_COUNT },
    factual_reporting: { claim_ids: [], evidence: [], evidence_count: A_EMPTY_COUNT },
    funding_type: {
      claim_ids: [],
      evidence: [],
      evidence_count: A_EMPTY_COUNT,
      origin: "legacy",
      value: "commercial",
    },
  },
  MBFC_BLOCK: AtlasFundingAndBias = {
    bias_rating: {
      asserted_by: "mbfc",
      claim_ids: ["claim-1"],
      evidence: [
        {
          id: "evidence-observation:obs-1",
          locator: {},
          source_name: "MBFC outlet record",
          source_type: "third_party_assessment",
          source_url: "https://mediabiasfactcheck.com/example",
        },
      ],
      evidence_count: A_EVIDENCE_COUNT,
      origin: "claim",
      source: "mbfc",
      value: "Left-Center",
    },
    factual_reporting: { claim_ids: [], evidence: [], evidence_count: A_EMPTY_COUNT },
    funding_type: { claim_ids: [], evidence: [], evidence_count: A_EMPTY_COUNT },
  },
  THREE_FIELDS = 3;

describe("funding bias panel", () => {
  it("always renders the correlation-not-causation caption, even with no data", () => {
    expect.hasAssertions();
    render(<FundingBiasPanel block={EMPTY_BLOCK} />);
    expect(screen.getByText(/Correlation shown, not proven causation/iu)).toBeInTheDocument();
    expect(screen.getAllByText("Not recorded")).toHaveLength(THREE_FIELDS);
  });

  it("attributes an accepted MBFC claim by name and links to its evidence", () => {
    expect.hasAssertions();
    render(<FundingBiasPanel block={MBFC_BLOCK} />);
    expect(screen.getByText("Left-Center")).toBeInTheDocument();
    expect(screen.getByText("MBFC")).toBeInTheDocument();
    expect(screen.getByText(/Rated by Media Bias\/Fact Check/iu)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Bias rating evidence/iu })).toHaveAttribute(
      "href",
      "https://mediabiasfactcheck.com/example",
    );
  });

  it("marks a legacy fallback value as uncited, with no evidence link", () => {
    expect.hasAssertions();
    render(<FundingBiasPanel block={LEGACY_BLOCK} />);
    expect(screen.getByText("commercial")).toBeInTheDocument();
    expect(screen.getByText("uncited")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
