"use client";

import { useMemo } from "react";
import { AtlasConnections } from "./atlas-inspector-connections";
import { buildAnalysisScores, buildDetails } from "./atlas-inspector-display";
import { AtlasAnalysisSection, AtlasDossier } from "./atlas-inspector-dossier";
import { AtlasEvidenceTrail } from "./atlas-inspector-evidence";
import { AtlasInspectorHeader } from "./atlas-inspector-header";
import { AtlasMeasurements } from "./atlas-inspector-measurements";
import { AtlasEmptyState, AtlasLoadingState } from "./atlas-inspector-states";
import type { AtlasInspectorProps, AtlasInspectorRecordProps } from "./atlas-inspector-types";
import styles from "./atlas.module.css";

const AtlasInspectorRecord = ({
  record,
  analysisScores,
  details,
  measurements,
  measurementsLoading,
  onSelectConnection,
}: AtlasInspectorRecordProps) => {
  const handleSelectConnection = onSelectConnection;
  return (
    <div className={styles.inspector}>
      <AtlasInspectorHeader record={record} />
      <AtlasInspectorBody
        record={record}
        analysisScores={analysisScores}
        details={details}
        measurements={measurements}
        measurementsLoading={measurementsLoading}
        handleSelectConnection={handleSelectConnection}
      />
    </div>
  );
};

const AtlasInspectorBody = ({
  record,
  analysisScores,
  details,
  measurements,
  measurementsLoading,
  handleSelectConnection,
}: Omit<AtlasInspectorRecordProps, "onSelectConnection"> &
  Readonly<{ handleSelectConnection: (entityId: string) => void }>) => (
  <div className={styles.inspectorBody}>
    <AtlasAnalysisSection scores={analysisScores} />
    <AtlasDossier sections={record.dossier_sections} details={details} />
    <AtlasMeasurements measurements={measurements} loading={Boolean(measurementsLoading)} />
    <AtlasConnections
      connections={record.connections}
      onSelectConnection={handleSelectConnection}
    />
    <AtlasEvidenceTrail evidence={record.evidence} />
  </div>
);

export const AtlasInspector = ({
  record,
  loading,
  error,
  measurements,
  measurementsLoading,
  onSelectConnection,
}: Readonly<AtlasInspectorProps>) => {
  const analysisScores = useMemo(() => buildAnalysisScores(record), [record]);
  const details = useMemo(() => buildDetails(record), [record]);

  if (loading) {
    return <AtlasLoadingState />;
  }
  if (error) {
    return <AtlasEmptyState title="Record unavailable" message={error.message} />;
  }
  if (!record) {
    return (
      <AtlasEmptyState
        title="Select an entity"
        message="Choose an outlet, organization, person, or reporter to inspect its evidence and connections."
      />
    );
  }

  return (
    <AtlasInspectorRecord
      record={record}
      analysisScores={analysisScores}
      details={details}
      measurements={measurements}
      measurementsLoading={measurementsLoading}
      onSelectConnection={onSelectConnection}
    />
  );
};
