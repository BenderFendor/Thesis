import { ChevronLeft, ChevronRight, Home, Loader2, Square } from "lucide-react";
import type { Message, ReadonlyNewsArticle, ReadonlyThinkingStep } from "../model/types";
import { Button } from "@/components/ui/button";
import { ChatComposerForm } from "./chat-composer";
import { ChatScrollArea } from "./research-messages";
import Link from "next/link";
import type React from "react";
import { ResearchSidePanels } from "./research-side-panels";

interface ResearchChatViewProps {
  readonly conversationMessages: readonly Readonly<Message>[];
  readonly messages: readonly Readonly<Message>[];
  readonly activeAssistantVersions: Readonly<Record<string, string>>;
  readonly editingMessageId: string | null;
  readonly editingDraft: string;
  readonly setEditingDraft: (value: string) => void;
  readonly isSearching: boolean;
  readonly expandedStepMessageIds: ReadonlySet<string>;
  readonly expandedSourceIds: ReadonlySet<string>;
  readonly chatScrollRef: React.RefCallback<HTMLDivElement>;
  readonly inputRef: React.RefCallback<HTMLTextAreaElement>;
  readonly onFocusInput: () => void;
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly onSearch: () => void | Promise<void>;
  readonly onStop: () => void;
  readonly onCopy: (content: string) => void;
  readonly onEdit: (messageId: string) => void;
  readonly onReset: (messageId: string) => void;
  readonly onDelete: (messageId: string) => void;
  readonly onSaveEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onSelectVersion: (groupId: string, messageId: string) => void;
  readonly onToggleSteps: (messageId: string) => void;
  readonly onToggleSource: (sourceId: string) => void;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
  readonly thinkingSteps: readonly ReadonlyThinkingStep[];
  readonly latestAssistantMessage: Readonly<Message> | undefined;
  readonly latestUserMessage: Readonly<Message> | undefined;
  readonly latestSemanticMessage: Readonly<Message> | undefined;
  readonly groupedSources: readonly {
    readonly sourceId: string;
    readonly sourceName: string;
    readonly articles: readonly ReadonlyNewsArticle[];
  }[];
}

const ResearchChatScrollArea = ({
  view,
}: Readonly<{ readonly view: ResearchChatViewProps }>) => {
  const {
    activeAssistantVersions,
    chatScrollRef,
    conversationMessages,
    editingDraft,
    editingMessageId,
    expandedStepMessageIds,
    messages,
    onCancelEdit: handleCancelEdit,
    onCopy: handleCopy,
    onDelete: handleDelete,
    onEdit: handleEdit,
    onOpenArticle: handleOpenArticle,
    onReset: handleReset,
    onSaveEdit: handleSaveEdit,
    onSelectVersion: handleSelectVersion,
    onStop: handleStop,
    onToggleSteps: handleToggleSteps,
    setEditingDraft,
    isSearching,
  } = view;
  return (
    <ChatScrollArea
      activeAssistantVersions={activeAssistantVersions}
      chatScrollRef={chatScrollRef}
      conversationMessages={conversationMessages}
      editingDraft={editingDraft}
      editingMessageId={editingMessageId}
      expandedStepMessageIds={expandedStepMessageIds}
      isSearching={isSearching}
      messages={messages}
      onCancelEdit={handleCancelEdit}
      onCopy={handleCopy}
      onDelete={handleDelete}
      onEdit={handleEdit}
      onOpenArticle={handleOpenArticle}
      onReset={handleReset}
      onSaveEdit={handleSaveEdit}
      onSelectVersion={handleSelectVersion}
      onStop={handleStop}
      onToggleSteps={handleToggleSteps}
      setEditingDraft={setEditingDraft}
    />
  );
};

const ResearchChatComposer = ({
  view,
}: Readonly<{ readonly view: ResearchChatViewProps }>) => {
  const {
    inputRef,
    isSearching,
    onFocusInput: handleFocusInput,
    onSearch: handleSearch,
    query,
    setQuery,
  } = view;
  return (
    <ChatComposerForm
      inputRef={inputRef}
      isSearching={isSearching}
      onFocusInput={handleFocusInput}
      onSearch={handleSearch}
      query={query}
      setQuery={setQuery}
    />
  );
};

const ResearchChatSidePanels = ({
  view,
}: Readonly<{ readonly view: ResearchChatViewProps }>) => {
  const {
    expandedSourceIds,
    groupedSources,
    latestAssistantMessage,
    latestSemanticMessage,
    latestUserMessage,
    onOpenArticle: handleOpenArticle,
    onToggleSource: handleToggleSource,
    thinkingSteps,
  } = view;
  return (
    <ResearchSidePanels
      expandedSourceIds={expandedSourceIds}
      groupedSources={groupedSources}
      latestAssistantMessage={latestAssistantMessage}
      latestSemanticMessage={latestSemanticMessage}
      latestUserMessage={latestUserMessage}
      onOpenArticle={handleOpenArticle}
      onToggleSource={handleToggleSource}
      thinkingSteps={thinkingSteps}
    />
  );
};

const ResearchChatAside = ({
  view,
}: Readonly<{ readonly view: ResearchChatViewProps }>) => (
  <aside className="flex h-full w-full shrink-0 flex-col overflow-hidden border-t border-border/20 bg-background/60 lg:w-96 lg:border-l lg:border-t-0">
    <div className="custom-scrollbar h-full flex-1 overflow-y-auto">
      <ResearchChatSidePanels view={view} />
    </div>
  </aside>
);

const ResearchChatMain = ({
  view,
}: Readonly<{ readonly view: ResearchChatViewProps }>) => (
  <section className="flex min-w-0 flex-1 flex-col lg:basis-8/12">
    <div className="mx-auto flex h-full w-full max-w-7xl flex-1 min-h-0 flex-col px-4 md:px-6">
      <ResearchChatScrollArea view={view} />
      <ResearchChatComposer view={view} />
    </div>
  </section>
);

const ResearchChatView = (props: ResearchChatViewProps) => (
  <div className="flex h-full min-h-0 flex-1 flex-col lg:flex-row">
    <ResearchChatMain view={props} />
    <ResearchChatAside view={props} />
  </div>
);
interface WorkspaceHeaderProps {
  readonly sidebarCollapsed: boolean;
  readonly onToggleSidebar: () => void;
  readonly isEmpty: boolean;
  readonly activeBriefTitle: string;
  readonly messageCount: number;
  readonly latestAssistantMessage: Message | undefined;
  readonly isSearching: boolean;
  readonly onStop: () => void;
}

interface WorkspaceHeaderContentProps {
  readonly activeBriefTitle: string;
  readonly messageCount: number;
  readonly latestAssistantMessage: Message | undefined;
  readonly isSearching: boolean;
  readonly onStop: () => void;
}

const WorkspaceHomeLink = () => (
    <Link href="/">
      <Button
        variant="ghost"
        size="sm"
        className="h-9 rounded-full px-4 text-xs text-muted-foreground transition-all duration-300 ease-out hover:bg-card/50 hover:text-foreground"
      >
        <Home className="mr-2 h-3.5 w-3.5" />
        Back to News
      </Button>
    </Link>
  );

const WorkspaceIdentityText = () => (
  <div className="flex min-w-0 items-center gap-2.5">
    <h1 className="truncate font-serif text-base font-medium tracking-tight text-foreground">
      Scoop Research
    </h1>
    <span className="hidden h-1 w-1 rounded-full bg-border/70 md:inline-block" />
    <span className="hidden font-mono text-xs uppercase tracking-widest text-muted-foreground/55 md:inline">
      Workspace
    </span>
  </div>
);

const EmptyWorkspaceHeaderContent = () => (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        <WorkspaceIdentityText />
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-sm text-muted-foreground">
          Start a focused question to build a source-backed brief.
        </p>
        <WorkspaceHomeLink />
      </div>
    </>
  );
const WorkspaceActivity = ({
    latestAssistantMessage,
    isSearching,
    onStop,
  }: Readonly<
    Pick<WorkspaceHeaderContentProps, "latestAssistantMessage" | "isSearching" | "onStop">
  >) => {
    const isRunning = isSearching || latestAssistantMessage?.isStreaming === true;
    if (!isRunning) {
      return null;
    }
    return (
      <div className="flex items-center gap-2 rounded-full border border-primary/15 bg-primary/10 px-3 py-1.5 text-xs text-primary/80">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span className="hidden font-mono text-xs uppercase tracking-widest sm:inline">
          {latestAssistantMessage?.streamingStatus ?? "Running"}
        </span>
        <button
          type="button"
          onClick={onStop}
          className="flex items-center justify-center rounded-full p-1 transition-colors hover:bg-primary/15"
          title="Stop generation"
        >
          <Square className="h-2.5 w-2.5 fill-current" />
        </button>
      </div>
    );
  };
const ActiveWorkspaceHeaderContent = (props: Readonly<WorkspaceHeaderContentProps>) => {
    const { activeBriefTitle, messageCount, latestAssistantMessage, isSearching, onStop } = props;
    return (
      <div className="flex min-w-0 items-center gap-3">
        <h2 className="min-w-0 flex-1 truncate font-serif text-xl font-medium leading-tight tracking-tight text-foreground md:text-2xl">
          {activeBriefTitle}
        </h2>
        <div className="hidden shrink-0 items-center gap-4 font-mono text-xs uppercase tracking-widest text-muted-foreground/65 xl:flex">
          <span>{messageCount} messages</span>
          {latestAssistantMessage?.articles_searched !== undefined &&
            latestAssistantMessage.articles_searched > 0 && (
              <span>{latestAssistantMessage.articles_searched} sources searched</span>
            )}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <WorkspaceActivity
            latestAssistantMessage={latestAssistantMessage}
            isSearching={isSearching}
            onStop={onStop}
          />
          <WorkspaceHomeLink />
        </div>
      </div>
    );
  };

const WorkspaceSidebarIcon = ({
  sidebarCollapsed,
}: Readonly<{ sidebarCollapsed: boolean }>) => {
  if (sidebarCollapsed) {
    return <ChevronRight size={16} />;
  }
  return <ChevronLeft size={16} />;
};

interface WorkspaceHeaderBodyProps extends WorkspaceHeaderContentProps {
  readonly isEmpty: boolean;
}

const WorkspaceHeaderBody = ({
  activeBriefTitle,
  isEmpty,
  isSearching,
  latestAssistantMessage,
  messageCount,
  onStop,
}: Readonly<WorkspaceHeaderBodyProps>) => {
  if (isEmpty) {
    return <EmptyWorkspaceHeaderContent />;
  }
  return (
    <ActiveWorkspaceHeaderContent
      activeBriefTitle={activeBriefTitle}
      isSearching={isSearching}
      latestAssistantMessage={latestAssistantMessage}
      messageCount={messageCount}
      onStop={onStop}
    />
  );
};

const WorkspaceSidebarButton = ({
  onToggleSidebar,
  sidebarCollapsed,
}: Readonly<Pick<WorkspaceHeaderProps, "onToggleSidebar" | "sidebarCollapsed">>) => (
  <button
    onClick={onToggleSidebar}
    className="mt-0.5 shrink-0 rounded-full border border-border/30 bg-background/70 p-2 text-muted-foreground transition-all duration-300 ease-out hover:border-border/50 hover:text-foreground active:scale-95"
    aria-label={(() => {
      if (sidebarCollapsed) {
        return "Open sidebar";
      }
      return "Close sidebar";
    })()}
  >
    <WorkspaceSidebarIcon sidebarCollapsed={sidebarCollapsed} />
  </button>
);

const WorkspaceHeaderBodyContainer = (props: Readonly<WorkspaceHeaderProps>) => (
  <div className="min-w-0 flex-1">
    <WorkspaceHeaderBody
      activeBriefTitle={props.activeBriefTitle}
      isEmpty={props.isEmpty}
      isSearching={props.isSearching}
      latestAssistantMessage={props.latestAssistantMessage}
      messageCount={props.messageCount}
      onStop={props.onStop}
    />
  </div>
);

const WorkspaceHeader = (props: WorkspaceHeaderProps) => {
  const { onToggleSidebar, sidebarCollapsed } = props;
  return (
    <header className="sticky top-0 z-20 shrink-0 border-b border-border/20 bg-background/80 backdrop-blur-2xl">
      <div className="flex w-full items-start gap-4 px-4 py-4 md:px-6 lg:px-8">
        <WorkspaceSidebarButton
          onToggleSidebar={onToggleSidebar}
          sidebarCollapsed={sidebarCollapsed}
        />
        <WorkspaceHeaderBodyContainer
          activeBriefTitle={props.activeBriefTitle}
          isEmpty={props.isEmpty}
          isSearching={props.isSearching}
          latestAssistantMessage={props.latestAssistantMessage}
          messageCount={props.messageCount}
          onStop={props.onStop}
          onToggleSidebar={onToggleSidebar}
          sidebarCollapsed={sidebarCollapsed}
        />
      </div>
    </header>
  );
};
export { ResearchChatView, WorkspaceHeader };
export type { ResearchChatViewProps };
