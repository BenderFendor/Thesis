import { Clock3 } from "lucide-react";
import { hasText } from "@/lib/utils";
import { AtlasMeasurementResultSchema, dateLabel, humanize } from "./atlas-inspector-display";
import type { AtlasMeasurement, ReadonlyAtlasMeasurementsResponse } from "./atlas-inspector-types";
import styles from "./atlas.module.css";
import type { z } from "zod";

type MeasurementResult = z.infer<typeof AtlasMeasurementResultSchema>;

const AtlasMeasurements = ({
  measurements,
  loading,
}: Readonly<{
  measurements?: ReadonlyAtlasMeasurementsResponse;
  loading: boolean;
}>) => (
  <section className={styles.inspectorSection}>
    <MeasurementsHeader />
    <MeasurementsContent loading={loading} measurements={measurements} />
  </section>
);

const MeasurementsHeader = () => (
  <div className="flex items-center gap-2">
    <Clock3 className="h-4 w-4 text-[#d7b35f]" />
    <h3 className={styles.controlLabel}>Corpus measurements</h3>
  </div>
);

const MeasurementsContent = ({
  loading,
  measurements,
}: Readonly<{
  loading: boolean;
  measurements?: ReadonlyAtlasMeasurementsResponse;
}>) => {
  const measurementItems = measurements?.measurements ?? [];
  if (loading) {
    return <MeasurementMessage>Calculating from the indexed corpus.</MeasurementMessage>;
  }
  if (measurementItems.length === 0) {
    return (
      <MeasurementMessage>No measurement is available for this indexed corpus.</MeasurementMessage>
    );
  }
  return (
    <div className={styles.detailGrid}>
      {measurementItems.map((measurement) => (
        <AtlasMeasurementCard key={measurement.id} measurement={measurement} />
      ))}
    </div>
  );
};

const MeasurementMessage = ({ children }: Readonly<{ children: string }>) => (
  <div className={`${styles.detailCard} mt-2`}>{children}</div>
);

const AtlasMeasurementCard = ({ measurement }: Readonly<{ measurement: AtlasMeasurement }>) => {
  const parsedResult = parseMeasurementResult(measurement);
  return (
    <div className={`${styles.detailCard} col-span-2`}>
      <MeasurementSummary measurement={measurement} result={parsedResult} />
      <MeasurementWindow measurement={measurement} result={parsedResult} />
      <MeasurementTrace result={measurement.result} />
    </div>
  );
};

const parseMeasurementResult = (measurement: AtlasMeasurement): MeasurementResult => {
  const parsedResult = AtlasMeasurementResultSchema.safeParse(measurement.result);
  if (parsedResult.success) {
    return parsedResult.data;
  }
  return {};
};

const MeasurementSummary = ({
  measurement,
  result,
}: Readonly<{ measurement: AtlasMeasurement; result: MeasurementResult }>) => (
  <>
    <div className={styles.microLabel}>{humanize(measurement.measurement_name)}</div>
    <div className={styles.detailValue}>Denominator: {result.denominator ?? "not available"}</div>
  </>
);

const MeasurementWindow = ({
  measurement,
  result,
}: Readonly<{ measurement: AtlasMeasurement; result: MeasurementResult }>) => (
  <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.12em] text-[#77736a]">
    {measurement.algorithm_version} · <WindowDate value={result.corpus_window?.start} /> to{" "}
    <WindowDate value={result.corpus_window?.end} />
  </div>
);

const WindowDate = ({ value }: Readonly<{ value?: string | null }>) => {
  if (hasText(value)) {
    return <>{dateLabel(value)}</>;
  }
  return <>No dated articles</>;
};

const MeasurementTrace = ({ result }: Readonly<{ result: AtlasMeasurement["result"] }>) => (
  <details className="mt-2 text-xs text-[#c9c3b6]">
    <summary className="cursor-pointer text-[#d7b35f]">Open calculation trace</summary>
    <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded border border-white/10 p-2">
      {JSON.stringify(result, undefined, 2)}
    </pre>
  </details>
);

export { AtlasMeasurements };
