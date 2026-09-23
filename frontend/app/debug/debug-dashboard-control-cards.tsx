import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TabsContent } from "@/components/ui/tabs";
import type { DatabaseDebugResponse } from "@/lib/api";
import type { DeepReadonly } from "@/lib/deep-readonly";
import {
  checkedValueChange,
  formatDatabaseSnapshotDate,
  numberValueChange,
} from "./debug-dashboard-utils";
import { SnapshotCard } from "./debug-dashboard-primitives";

type DebugDatabaseResponse = DeepReadonly<DatabaseDebugResponse>;

interface ControlsSectionProps {
  readonly logLevel: string;
  readonly onSetLogLevel: (level: string) => void;
  readonly frontendDebugMode: boolean;
  readonly onToggleFrontendDebug: () => void;
}

const BackendLogLevelCard = (
  props: Readonly<Pick<ControlsSectionProps, "logLevel" | "onSetLogLevel">>,
) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Backend Log Level</CardTitle>
      <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
        Change runtime log verbosity
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <BackendLogLevelControl logLevel={props.logLevel} onSetLogLevel={props.onSetLogLevel} />
      <p className="text-xs text-muted-foreground">
        Changes are applied immediately to all backend loggers.
      </p>
    </CardContent>
  </Card>
);

const BackendLogLevelControl = (
  props: Readonly<Pick<ControlsSectionProps, "logLevel" | "onSetLogLevel">>,
) => (
  <div className="flex items-center gap-4">
    <span className="text-sm">Current level:</span>
    <BackendLogLevelSelect logLevel={props.logLevel} onSetLogLevel={props.onSetLogLevel} />
  </div>
);

const BackendLogLevelSelect = (
  props: Readonly<Pick<ControlsSectionProps, "logLevel" | "onSetLogLevel">>,
) => (
  <Select value={props.logLevel} onValueChange={props.onSetLogLevel}>
    <SelectTrigger className="w-32">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="DEBUG">DEBUG</SelectItem>
      <SelectItem value="INFO">INFO</SelectItem>
      <SelectItem value="WARNING">WARNING</SelectItem>
      <SelectItem value="ERROR">ERROR</SelectItem>
    </SelectContent>
  </Select>
);

const FrontendDebugModeCard = (
  props: Readonly<Pick<ControlsSectionProps, "frontendDebugMode" | "onToggleFrontendDebug">>,
) => (
  <Card className="border-white/5 bg-black/20 transition-all hover:-translate-y-px hover:bg-white/[0.03] hover:shadow-lg">
    <CardHeader>
      <CardTitle className="font-serif">Frontend Debug Mode</CardTitle>
      <CardDescription className="font-mono text-[10px] uppercase tracking-widest">
        Toggle verbose frontend logging
      </CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      <DebugModeToggle
        frontendDebugMode={props.frontendDebugMode}
        onToggleFrontendDebug={props.onToggleFrontendDebug}
      />
      <DebugModeDescription />
    </CardContent>
  </Card>
);

const DebugModeDescription = () => (
  <p className="text-xs text-muted-foreground">
    When enabled, detailed logs will appear in the browser console. Stored in localStorage as{" "}
    <code>thesis_debug_mode</code>.
  </p>
);

const DebugModeToggle = (
  props: Readonly<Pick<ControlsSectionProps, "frontendDebugMode" | "onToggleFrontendDebug">>,
) => (
  <label className="flex cursor-pointer items-center gap-2">
    <input
      type="checkbox"
      checked={props.frontendDebugMode}
      onChange={props.onToggleFrontendDebug}
      className="h-4 w-4"
    />
    <span className="text-sm">Enable debug mode</span>
  </label>
);

const ControlsSection = (props: Readonly<ControlsSectionProps>) => (
  <TabsContent value="controls" className="space-y-4">
    <BackendLogLevelCard logLevel={props.logLevel} onSetLogLevel={props.onSetLogLevel} />
    <FrontendDebugModeCard
      frontendDebugMode={props.frontendDebugMode}
      onToggleFrontendDebug={props.onToggleFrontendDebug}
    />
  </TabsContent>
);

interface DatabaseSnapshotCardProps {
  readonly dbData: DebugDatabaseResponse | undefined;
  readonly dbLimit: number;
  readonly dbMissingOnly: boolean;
  readonly dbOffset: number;
  readonly dbSortDirection: "asc" | "desc";
  readonly setDbLimit: (value: number) => void;
  readonly setDbMissingOnly: (value: boolean) => void;
  readonly setDbOffset: (value: number) => void;
  readonly setDbSortDirection: (value: "asc" | "desc") => void;
}

const DatabaseSnapshotRange = (props: Readonly<Pick<DatabaseSnapshotCardProps, "dbData">>) => (
  <p>
    Range: {formatDatabaseSnapshotDate(props.dbData?.oldest_published)} →{" "}
    {formatDatabaseSnapshotDate(props.dbData?.newest_published)}
  </p>
);

const DatabaseSortSelect = (
  props: Readonly<Pick<DatabaseSnapshotCardProps, "dbSortDirection" | "setDbSortDirection">>,
) => {
  const handleSortDirectionChange = props.setDbSortDirection;
  return (
    <Select value={props.dbSortDirection} onValueChange={handleSortDirectionChange}>
      <SelectTrigger className="w-[110px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="desc">Newest first</SelectItem>
        <SelectItem value="asc">Oldest first</SelectItem>
      </SelectContent>
    </Select>
  );
};

const DatabaseSnapshotControls = (
  props: Readonly<
    Pick<
      DatabaseSnapshotCardProps,
      | "dbLimit"
      | "dbMissingOnly"
      | "dbOffset"
      | "dbSortDirection"
      | "setDbLimit"
      | "setDbMissingOnly"
      | "setDbOffset"
      | "setDbSortDirection"
    >
  >,
) => (
  <div className="flex flex-wrap gap-2 text-sm">
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={props.dbMissingOnly}
        onChange={checkedValueChange(props.setDbMissingOnly)}
      />
      Missing embeddings only
    </label>
    <DatabaseSortSelect
      dbSortDirection={props.dbSortDirection}
      setDbSortDirection={props.setDbSortDirection}
    />
    <Input
      type="number"
      className="w-24"
      value={props.dbOffset}
      onChange={numberValueChange(props.setDbOffset)}
      placeholder="Offset"
    />
    <Input
      type="number"
      className="w-24"
      value={props.dbLimit}
      onChange={numberValueChange(props.setDbLimit)}
      placeholder="Limit"
    />
  </div>
);

const DatabaseSnapshotCard = (props: Readonly<DatabaseSnapshotCardProps>) => (
  <SnapshotCard title="Database Snapshot">
    <p>Total rows: {props.dbData?.total ?? "-"}</p>
    <p>Showing: {props.dbData?.returned ?? "-"}</p>
    <DatabaseSnapshotRange dbData={props.dbData} />
    <DatabaseSnapshotControls
      dbLimit={props.dbLimit}
      dbMissingOnly={props.dbMissingOnly}
      dbOffset={props.dbOffset}
      dbSortDirection={props.dbSortDirection}
      setDbLimit={props.setDbLimit}
      setDbMissingOnly={props.setDbMissingOnly}
      setDbOffset={props.setDbOffset}
      setDbSortDirection={props.setDbSortDirection}
    />
  </SnapshotCard>
);

export { ControlsSection, DatabaseSnapshotCard };
