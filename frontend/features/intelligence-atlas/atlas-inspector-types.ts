import type { DeepReadonly } from "@/lib/deep-readonly";
import type { AtlasEntityRecord, AtlasMeasurementsResponse } from "./lib/atlas-schema";

type AtlasConnection = AtlasEntityRecord["connections"][number];
type AtlasDossierSection = AtlasEntityRecord["dossier_sections"][number];
type AtlasDossierStatement = AtlasDossierSection["statements"][number];
type AtlasEvidence = AtlasEntityRecord["evidence"][number];
type ReadonlyAtlasEntityRecord = DeepReadonly<AtlasEntityRecord>;
type ReadonlyAtlasMeasurementsResponse = DeepReadonly<AtlasMeasurementsResponse>;
type AtlasMeasurement = ReadonlyAtlasMeasurementsResponse["measurements"][number];

interface AtlasInspectorProps {
  readonly record: ReadonlyAtlasEntityRecord | undefined;
  readonly loading: boolean;
  readonly error: Error | null;
  readonly measurements?: ReadonlyAtlasMeasurementsResponse;
  readonly measurementsLoading?: boolean;
  readonly onSelectConnection: (entityId: string) => void;
}

type AtlasInspectorRecordProps = Readonly<{
  record: ReadonlyAtlasEntityRecord;
  analysisScores: readonly (readonly [string, number])[];
  details: readonly (readonly [string, string])[];
  measurements?: ReadonlyAtlasMeasurementsResponse;
  measurementsLoading?: boolean;
  onSelectConnection: (entityId: string) => void;
}>;

export type {
  AtlasConnection,
  AtlasDossierSection,
  AtlasDossierStatement,
  AtlasEvidence,
  AtlasInspectorProps,
  AtlasInspectorRecordProps,
  AtlasMeasurement,
  ReadonlyAtlasEntityRecord,
  ReadonlyAtlasMeasurementsResponse,
};
