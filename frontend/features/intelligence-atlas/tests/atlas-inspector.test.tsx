import { render, screen } from "@testing-library/react";

import { AtlasInspector } from "../atlas-inspector";
import type { AtlasEntityRecord, AtlasMeasurementsResponse } from "../lib/atlas-schema";

const record: AtlasEntityRecord = {
  id: "outlet:cnn",
  entity_type: "outlet",
  label: "CNN",
  status: "accepted",
  confidence_tier: "verified",
  last_verified_at: "2026-07-21T12:00:00Z",
  details: {},
  entity_kind: "publication_brand",
  dossier_sections: [
    {
      key: "summary",
      title: "Summary",
      statements: [
        {
          label: "Current owner or operator",
          answer: "Warner Bros. Discovery",
          state: "known",
          predicate: "brand_of",
          lifecycle_state: "current",
          qualifiers: {},
          evidence: [
            {
              id: "evidence-1",
              source_type: "official_company_record",
              source_name: "WBD brand portfolio",
              source_url: "https://www.wbd.com/our-brands/",
              retrieved_at: "2026-07-21T12:00:00Z",
              snapshot_sha256: "abc123",
              locator: { section: "CNN" },
              evidence_class: "own_site",
              policy_version: "evidence-policy/1",
              acceptance_decision: "accepted",
              contradictions: [],
            },
          ],
        },
      ],
    },
    {
      key: "ownership_control",
      title: "Ownership and control",
      statements: [
        {
          label: "Proposed relationship",
          answer: "Paramount Skydance",
          state: "known",
          predicate: "successor_of",
          lifecycle_state: "proposed",
          qualifiers: {},
          evidence: [],
        },
      ],
    },
    {
      key: "evidence_conflicts_freshness_gaps",
      title: "Evidence, conflicts, freshness, and known gaps",
      statements: [
        {
          label: "Known gaps",
          answer: "The legal chain is incomplete.",
          state: "chain_incomplete",
          qualifiers: {},
          evidence: [],
        },
      ],
    },
  ],
  evidence: [],
  connections: [],
};

const measurements: AtlasMeasurementsResponse = {
  source_name: "CNN",
  measurements: [
    {
      id: "calc-1",
      measurement_name: "publication_cadence",
      algorithm_version: "media_measurements/1.0",
      created_at: "2026-07-21T12:00:00Z",
      result: {
        denominator: 12,
        corpus_window: { start: "2026-07-01T00:00:00Z", end: "2026-07-21T00:00:00Z" },
        coverage: { numerator: 12, denominator: 12 },
      },
    },
  ],
};

describe("AtlasInspector", () => {
  it("separates current and proposed answers, exposes gaps, evidence, and traces", () => {
    render(
      <AtlasInspector
        record={record}
        loading={false}
        error={null}
        measurements={measurements}
        onSelectConnection={jest.fn()}
      />,
    );

    expect(screen.getByText("Warner Bros. Discovery")).toBeInTheDocument();
    expect(screen.getByText("Paramount Skydance")).toBeInTheDocument();
    expect(screen.getByText("The legal chain is incomplete.")).toBeInTheDocument();
    expect(screen.getByText("Open claim evidence (1)")).toBeInTheDocument();
    expect(screen.getByText("Publication Cadence")).toBeInTheDocument();
    expect(screen.getByText("Denominator: 12")).toBeInTheDocument();
  });
});
