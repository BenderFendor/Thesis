import { RefreshCcw, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { ClusterDetailModal } from "@/components/cluster-detail-modal";
import { Skeleton } from "@/components/ui/skeleton";
import type { BlindspotClusterModalProps } from "@/components/blindspot-view-types";

const LoadingLaneCards = (): ReactElement => (
  <div className="space-y-3">
    <Skeleton className="h-20 w-full rounded-xl opacity-5" />
    <Skeleton className="h-20 w-full rounded-xl opacity-5" />
  </div>
);

const LoadingLane = (): ReactElement => (
  <div className="space-y-6">
    <Skeleton className="h-10 w-48 opacity-20" />
    <Skeleton className="h-64 w-full rounded-2xl opacity-10" />
    <LoadingLaneCards />
  </div>
);

const BlindspotLoadingState = (): ReactElement => (
  <div className="space-y-12">
    <Skeleton className="h-12 w-full rounded-sm opacity-20" />
    <div className="grid gap-12 xl:grid-cols-2">
      <LoadingLane />
      <LoadingLane />
    </div>
  </div>
);

const ErrorHeading = (): ReactElement => (
  <div className="flex flex-col items-center gap-4 text-foreground">
    <ShieldAlert className="h-12 w-12 text-primary/40" />
    <h2 className="font-serif text-3xl">Viewer unavailable</h2>
  </div>
);

const RetryButton = (props: Readonly<{ onClick: () => void }>): ReactElement => (
  <Button
    onClick={props.onClick}
    variant="outline"
    className="mt-8 border-white/10 bg-white/[0.03] px-8 text-[10px] font-mono uppercase tracking-widest"
  >
    <RefreshCcw className="mr-2 h-3.5 w-3.5" />
    Retry
  </Button>
);

const BlindspotErrorState = (
  props: Readonly<{ message: string; onRetry: () => void }>,
): ReactElement => (
  <div className="flex min-h-[32rem] items-center justify-center p-6">
    <div className="max-w-xl rounded-2xl bg-white/[0.02] p-12 text-center">
      <ErrorHeading />
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground/60">{props.message}</p>
      <RetryButton onClick={props.onRetry} />
    </div>
  </div>
);

const BlindspotOfflineState = (
  props: Readonly<{ label: string; reason?: string | null }>,
): ReactElement => {
  const reason = props.reason ?? "Check back shortly for updated intelligence.";
  return (
    <div className="rounded-2xl border border-dashed border-white/5 bg-white/[0.01] py-32 text-center">
      <h3 className="font-serif text-2xl text-foreground/60">{props.label} analyzer is offline</h3>
      <p className="mt-2 text-sm text-muted-foreground/40">{reason}</p>
    </div>
  );
};

const BlindspotClusterModal = (props: Readonly<BlindspotClusterModalProps>): ReactElement => (
  <ClusterDetailModal
    cluster={props.cluster}
    isBreaking={false}
    isOpen={props.cluster !== null}
    onClose={props.onClose}
  />
);

export { BlindspotClusterModal, BlindspotErrorState, BlindspotLoadingState, BlindspotOfflineState };
