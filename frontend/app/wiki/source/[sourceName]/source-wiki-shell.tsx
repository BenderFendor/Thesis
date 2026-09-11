import type { ReactElement } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { GlobalNavigation } from "@/components/global-navigation";
import { SourcePageBody } from "./source-wiki-panels";
import { SourceSidebar } from "./source-wiki-sidebar";
import type {
  DeepReadonly,
  ReadonlyFundingAndBias,
  ReadonlyOwnershipChain,
  ReadonlySourceProfile,
} from "./source-wiki-types";

type SourceWikiContentProps = DeepReadonly<{
  avgScore: number | null;
  data: ReadonlySourceProfile | undefined;
  embedded: boolean;
  error: unknown;
  fundingAndBias: ReadonlyFundingAndBias;
  indexing: boolean;
  isLoading: boolean;
  onIndex: () => void;
  outletEntityId?: string;
  ownershipChain: ReadonlyOwnershipChain;
}>;

type SourceWikiReadyProps = DeepReadonly<{
  avgScore: number | null;
  data: ReadonlySourceProfile;
  embedded: boolean;
  fundingAndBias: ReadonlyFundingAndBias;
  indexing: boolean;
  onIndex: () => void;
  outletEntityId?: string;
  ownershipChain: ReadonlyOwnershipChain;
}>;

const SourceWikiBackdrop = (): ReactElement => (
  <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
);

const SourceWikiLoadingFrame = (): ReactElement => (
  <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar flex items-center justify-center">
    <SourceWikiBackdrop />
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const SourceWikiLoading = (props: DeepReadonly<{ embedded: boolean }>): ReactElement => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    {!props.embedded && <GlobalNavigation />}
    <SourceWikiLoadingFrame />
  </div>
);

const getErrorContentClassName = (embedded: boolean): string => {
  if (embedded) {
    return "p-4";
  }
  return "p-6";
};

const SourceWikiErrorContent = (
  props: DeepReadonly<{ embedded: boolean; message: string }>,
): ReactElement => (
  <div
    className={`flex-1 overflow-y-auto relative z-10 custom-scrollbar ${getErrorContentClassName(props.embedded)}`}
  >
    <SourceWikiBackdrop />
    {!props.embedded && (
      <Link
        href="/wiki/ownership"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="h-4 w-4" />
        <span className="font-mono text-[10px] tracking-widest uppercase">Back to source wiki</span>
      </Link>
    )}
    <div className="mt-16 text-center text-red-400 font-mono">{props.message}</div>
  </div>
);

const SourceWikiError = (
  props: DeepReadonly<{ embedded: boolean; message: string }>,
): ReactElement => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    {!props.embedded && <GlobalNavigation />}
    <SourceWikiErrorContent embedded={props.embedded} message={props.message} />
  </div>
);

const SourceWikiSidebarFrame = (
  props: DeepReadonly<{
    avgScore: number | null;
    data: ReadonlySourceProfile;
    embedded: boolean;
    indexing: boolean;
    onIndex: () => void;
    outletEntityId?: string;
  }>,
): ReactElement => (
  <aside className="rounded-2xl bg-black/40 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] ring-1 ring-white/5 p-4">
    <SourceSidebar
      avgScore={props.avgScore}
      data={props.data}
      embedded={props.embedded}
      indexing={props.indexing}
      onIndex={props.onIndex}
      outletEntityId={props.outletEntityId}
    />
  </aside>
);

const getSourceWikiMainClassName = (embedded: boolean): string => {
  if (embedded) {
    return "max-w-none lg:grid-cols-[280px_minmax(0,1fr)]";
  }
  return "max-w-[1500px] lg:grid-cols-[300px_minmax(0,1fr)]";
};

const SourceWikiMain = (props: SourceWikiReadyProps): ReactElement => (
  <main className={`mx-auto grid gap-5 p-4 ${getSourceWikiMainClassName(props.embedded)}`}>
    <SourceWikiSidebarFrame
      avgScore={props.avgScore}
      data={props.data}
      embedded={props.embedded}
      indexing={props.indexing}
      onIndex={props.onIndex}
      outletEntityId={props.outletEntityId}
    />
    <section className="space-y-5">
      <SourcePageBody
        data={props.data}
        fundingAndBias={props.fundingAndBias}
        outletEntityId={props.outletEntityId}
        ownershipChain={props.ownershipChain}
      />
    </section>
  </main>
);

const SourceWikiFrame = (props: SourceWikiReadyProps): ReactElement => (
  <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
    <SourceWikiBackdrop />
    <SourceWikiMain
      avgScore={props.avgScore}
      data={props.data}
      embedded={props.embedded}
      fundingAndBias={props.fundingAndBias}
      indexing={props.indexing}
      onIndex={props.onIndex}
      outletEntityId={props.outletEntityId}
      ownershipChain={props.ownershipChain}
    />
  </div>
);

const SourceWikiLayout = (props: SourceWikiReadyProps): ReactElement => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    {!props.embedded && <GlobalNavigation />}
    <SourceWikiFrame
      avgScore={props.avgScore}
      data={props.data}
      embedded={props.embedded}
      fundingAndBias={props.fundingAndBias}
      indexing={props.indexing}
      onIndex={props.onIndex}
      outletEntityId={props.outletEntityId}
      ownershipChain={props.ownershipChain}
    />
  </div>
);

const renderSourceWikiContent = (props: SourceWikiContentProps): ReactElement | null => {
  if (props.isLoading) {
    return <SourceWikiLoading embedded={props.embedded} />;
  }
  if ((props.error !== undefined && props.error !== null) || props.data === undefined) {
    let message = "Source not found";
    if (props.error instanceof Error) {
      message = props.error.message;
    }
    return <SourceWikiError embedded={props.embedded} message={message} />;
  }
  return (
    <SourceWikiLayout
      avgScore={props.avgScore}
      data={props.data}
      embedded={props.embedded}
      fundingAndBias={props.fundingAndBias}
      indexing={props.indexing}
      onIndex={props.onIndex}
      outletEntityId={props.outletEntityId}
      ownershipChain={props.ownershipChain}
    />
  );
};

export { renderSourceWikiContent };
