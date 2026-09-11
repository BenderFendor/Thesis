import type { AtlasEntityRecord, AtlasMeasurementsResponse } from "../lib/atlas-schema";
import { describe, expect, it } from '@jest/globals';
import { render, screen } from "@testing-library/react";

import { AtlasInspector } from "../atlas-inspector";

const atlasRecord: AtlasEntityRecord = {
  confidence_tier: "verified",
  connections: [],
  details: {},
  dossier_sections: [
    {
      key: "summary",
      statements: [
        {
          answer: "Warner Bros. Discovery",
          evidence: [
            {
              acceptance_decision: "accepted",
              contradictions: [],
              evidence_class: "own_site",
              id: "evidence-1",
              locator: { section: "CNN" },
              policy_version: "evidence-policy/1",
              retrieved_at: "2026-07-21T12:00:00Z",
              snapshot_sha256: "abc123",
              source_name: "WBD brand portfolio",
              source_type: "official_company_record",
              source_url: "https://www.wbd.com/our-brands/",
            },
          ],
          label: "Current owner or operator",
          lifecycle_state: "current",
          predicate: "brand_of",
          qualifiers: {},
          state: "known",
        },
      ],
      title: "Summary",
    },
    {
      key: "ownership_control",
      statements: [
        {
          answer: "Paramount Skydance",
          evidence: [],
          label: "Proposed relationship",
          lifecycle_state: "proposed",
          predicate: "successor_of",
          qualifiers: {},
          state: "known",
        },
      ],
      title: "Ownership and control",
    },
    {
      key: "evidence_conflicts_freshness_gaps",
      statements: [
        {
          answer: "The legal chain is incomplete.",
          evidence: [],
          label: "Known gaps",
          qualifiers: {},
          state: "chain_incomplete",
        },
      ],
      title: "Evidence, conflicts, freshness, and known gaps",
    },
  ],
  entity_kind: "publication_brand",
  entity_type: "outlet",
  evidence: [],
  id: "outlet:cnn",
  label: "CNN",
  last_verified_at: "2026-07-21T12:00:00Z",
  status: "accepted",
},

 ignoreConnection = (_entityId: string): void => undefined,
 measurements: AtlasMeasurementsResponse = {
  measurements: [
    {
      algorithm_version: "media_measurements/1.0",
      created_at: "2026-07-21T12:00:00Z",
      id: "calc-1",
      measurement_name: "publication_cadence",
      result: {
        corpus_window: { end: "2026-07-21T00:00:00Z", start: "2026-07-01T00:00:00Z" },
        coverage: { denominator: 12, numerator: 12 },
        denominator: 12,
      },
    },
  ],
  source_name: "CNN",
},

 renderInspector = (): void => {
  render(
    <AtlasInspector
      record={atlasRecord}
      loading={false}
      // oxlint-disable-next-line unicorn/no-null -- null is the real no-error sentinel for this component.
      error={null}
      measurements={measurements}
      onSelectConnection={ignoreConnection}
    />,
  );
};

describe("atlasInspector", () => {
  it("separates current and proposed answers and exposes evidence", () => {
    expect.hasAssertions();
    renderInspector();

    expect(screen.getByText("Warner Bros. Discovery")).toBeInTheDocument();
    expect(screen.getByText("Paramount Skydance")).toBeInTheDocument();
    expect(screen.getByText("The legal chain is incomplete.")).toBeInTheDocument();
    expect(screen.getByText("Open claim evidence (1)")).toBeInTheDocument();
    expect(screen.getByText("Publication Cadence")).toBeInTheDocument();
  });

  it("renders the stored measurement denominator", () => {
    expect.hasAssertions();
    renderInspector();

    expect(screen.getByText("Denominator: 12")).toBeInTheDocument();
  });
});
