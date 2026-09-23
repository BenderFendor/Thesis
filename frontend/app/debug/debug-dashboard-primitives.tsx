import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ReactElement } from "react";
import { numberValueChange, selectedNumberValueChange } from "./debug-dashboard-utils";

const SNAPSHOT_CARD_CLASS =
  "bg-black/20 border-white/5 transition-all hover:bg-white/[0.03] hover:-translate-y-px hover:shadow-lg";

interface SnapshotCardProps {
  readonly title: string;
  readonly children: Readonly<ReactElement> | readonly Readonly<ReactElement>[];
}

const SnapshotCard = (props: Readonly<Pick<SnapshotCardProps, "children" | "title">>) => (
  <Card className={SNAPSHOT_CARD_CLASS}>
    <CardHeader>
      <CardTitle className="font-serif">{props.title}</CardTitle>
    </CardHeader>
    <CardContent className="space-y-2 text-sm">{props.children}</CardContent>
  </Card>
);

interface SnapshotPaginationProps {
  readonly limit: number;
  readonly onLimitChange: (value: number) => void;
  readonly offset: number;
  readonly onOffsetChange: (value: number) => void;
  readonly compact?: boolean;
}

const SnapshotPagination = (props: Readonly<SnapshotPaginationProps>) => {
  const { compact = false } = props;
  const className = snapshotPaginationClassName(compact);
  return (
    <div className={className}>
      <span>Limit</span>
      <SnapshotLimitSelect limit={props.limit} onLimitChange={props.onLimitChange} />
      <span>Offset</span>
      <SnapshotOffsetInput offset={props.offset} onOffsetChange={props.onOffsetChange} />
    </div>
  );
};

const snapshotPaginationClassName = (compact: boolean): string => {
  if (compact) {
    return "flex items-center gap-2";
  }
  return "flex flex-wrap items-center gap-2";
};

const SnapshotLimitSelect = (
  props: Readonly<Pick<SnapshotPaginationProps, "limit" | "onLimitChange">>,
) => (
  <Select
    value={String(props.limit)}
    onValueChange={selectedNumberValueChange(props.onLimitChange)}
  >
    <SelectTrigger className="w-[100px]">
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {[10, 25, 50, 100, 200, 500].map((size) => (
        <SelectItem key={size} value={String(size)}>
          {size}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const SnapshotOffsetInput = (
  props: Readonly<Pick<SnapshotPaginationProps, "offset" | "onOffsetChange">>,
) => (
  <Input
    type="number"
    className="w-24"
    value={props.offset}
    onChange={numberValueChange(props.onOffsetChange)}
  />
);

export { SnapshotCard, SnapshotPagination };
