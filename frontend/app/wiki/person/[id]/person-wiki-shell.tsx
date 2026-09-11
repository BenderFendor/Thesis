import type { ReactElement } from "react";
import { ChevronLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { GlobalNavigation } from "@/components/global-navigation";
import { PersonWikiPanels } from "./person-wiki-panels";
import { PersonWikiSidebar } from "./person-wiki-sidebar";
import type {
  DeepReadonly,
  ReadonlyControls,
  ReadonlyExternalIds,
  ReadonlyOwnershipChain,
  ReadonlyPersonEntity,
  ReadonlyRoleBreakdown,
} from "./person-wiki-types";

type PersonWikiReadyProps = DeepReadonly<{
  chain: ReadonlyOwnershipChain;
  controls: ReadonlyControls;
  data: ReadonlyPersonEntity;
  externalIds: ReadonlyExternalIds;
  roleBreakdown: ReadonlyRoleBreakdown;
}>;

const PersonWikiBackdrop = (): ReactElement => (
  <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/10 via-background to-background z-[-1]" />
);

const PersonWikiLoadingFrame = (): ReactElement => (
  <div className="flex-1 flex min-h-screen items-center justify-center relative z-10 custom-scrollbar">
    <PersonWikiBackdrop />
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const PersonWikiLoading = (): ReactElement => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    <GlobalNavigation />
    <PersonWikiLoadingFrame />
  </div>
);

const PersonWikiErrorContent = (props: DeepReadonly<{ message: string }>): ReactElement => (
  <div className="flex-1 p-6 relative z-10 custom-scrollbar">
    <PersonWikiBackdrop />
    <Link
      href="/wiki/ownership"
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ChevronLeft className="h-4 w-4" />
      Back to Intelligence Atlas
    </Link>
    <div className="mt-16 text-center text-red-400 font-mono text-sm">{props.message}</div>
  </div>
);

const PersonWikiError = (props: DeepReadonly<{ message: string }>): ReactElement => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    <GlobalNavigation />
    <PersonWikiErrorContent message={props.message} />
  </div>
);

const PersonWikiMain = (props: PersonWikiReadyProps): ReactElement => (
  <main className="mx-auto grid max-w-[1500px] gap-5 p-4 lg:grid-cols-[300px_minmax(0,1fr)]">
    <PersonWikiSidebar
      data={props.data}
      externalIds={props.externalIds}
      roleBreakdown={props.roleBreakdown}
    />
    <PersonWikiPanels chain={props.chain} controls={props.controls} data={props.data} />
  </main>
);

const PersonWikiLayout = (props: PersonWikiReadyProps): ReactElement => (
  <div className="flex bg-background min-h-screen text-foreground overflow-hidden">
    <GlobalNavigation />
    <div className="flex-1 overflow-y-auto relative z-10 custom-scrollbar">
      <PersonWikiBackdrop />
      <PersonWikiMain
        chain={props.chain}
        controls={props.controls}
        data={props.data}
        externalIds={props.externalIds}
        roleBreakdown={props.roleBreakdown}
      />
    </div>
  </div>
);

const getPersonWikiErrorMessage = (error: Error | null): string => {
  if (error !== null) {
    return error.message;
  }
  return "Person not found";
};

const renderPersonWiki = (
  props: DeepReadonly<{
    chain: ReadonlyOwnershipChain | undefined;
    controls: ReadonlyControls | undefined;
    data: ReadonlyPersonEntity | undefined;
    error: Error | null;
    externalIds: ReadonlyExternalIds | undefined;
    isLoading: boolean;
    roleBreakdown: ReadonlyRoleBreakdown | undefined;
  }>,
): ReactElement => {
  if (props.isLoading) {
    return <PersonWikiLoading />;
  }
  if (
    props.error !== null ||
    props.data === undefined ||
    props.chain === undefined ||
    props.controls === undefined ||
    props.externalIds === undefined ||
    props.roleBreakdown === undefined
  ) {
    return <PersonWikiError message={getPersonWikiErrorMessage(props.error)} />;
  }
  return (
    <PersonWikiLayout
      chain={props.chain}
      controls={props.controls}
      data={props.data}
      externalIds={props.externalIds}
      roleBreakdown={props.roleBreakdown}
    />
  );
};

export { renderPersonWiki };
