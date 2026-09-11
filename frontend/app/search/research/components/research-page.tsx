import type { Message, ReadonlyChatSummary, ReadonlyNewsArticle } from "../model/types";
import { ResearchChatView, WorkspaceHeader } from "./research-workspace";
import { ArticleDetailModal } from "@/components/article-detail-modal";
import { ChatSidebar } from "@/components/chat-sidebar";
import { EmptyResearchView } from "./empty-research-view";
import type { EmptyResearchViewProps } from "./empty-research-view";
import type { ResearchChatViewProps } from "./research-workspace";
import { useMemo } from "react";

interface ResearchSidebarModel {
  readonly chats: readonly ReadonlyChatSummary[];
  readonly activeChatId: string | null;
  readonly collapsed: boolean;
  readonly onSelect: (id: string) => void;
  readonly onNew: () => void;
  readonly onRename: (id: string, title: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onDeleteMultiple: (ids: readonly string[]) => void;
  readonly onToggle: () => void;
}

interface ResearchWorkspaceModel {
  readonly collapsed: boolean;
  readonly isEmpty: boolean;
  readonly activeBriefTitle: string;
  readonly messageCount: number;
  readonly latestAssistantMessage: Readonly<Message> | undefined;
  readonly isSearching: boolean;
  readonly onToggleSidebar: () => void;
  readonly onStop: () => void;
  readonly chat: Readonly<ResearchChatViewProps>;
  readonly empty: Readonly<EmptyResearchViewProps>;
}

interface ResearchArticleModalModel {
  readonly article: ReadonlyNewsArticle | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
}

interface ResearchPageViewProps {
  readonly sidebar: ResearchSidebarModel;
  readonly workspace: ResearchWorkspaceModel;
  readonly articleModal: ResearchArticleModalModel;
}

const ResearchSidebar = ({ model }: { readonly model: ResearchSidebarModel }) => {
  const chats = useMemo(() => [...model.chats], [model.chats]);
  const {
    onDelete: handleDelete,
    onDeleteMultiple: handleDeleteMultiple,
    onNew: handleNew,
    onRename: handleRename,
    onSelect: handleSelect,
    onToggle: handleToggle,
  } = model;
  return (
    <div
      className={`${(() => {
  if (model.collapsed) {
    return "w-16";
  }
  return "w-60";
})()} hidden shrink-0 border-r bg-background/80 transition-all duration-300 ease-in-out md:block`}
    >
      <ChatSidebar
        activeId={model.activeChatId}
        chats={chats}
        collapsed={model.collapsed}
        onDelete={handleDelete}
        onDeleteMultiple={handleDeleteMultiple}
        onNewChat={handleNew}
        onRename={handleRename}
        onSelect={handleSelect}
        onToggle={handleToggle}
      />
    </div>
  );
};

const ResearchWorkspaceContent = ({ model }: { readonly model: ResearchWorkspaceModel }) => {
  if (model.isEmpty) {
    const {
      inputRef,
      isSearching,
      onFocusInput: handleFocusInput,
      onSampleQuery: handleSampleQuery,
      onSearch: handleSearch,
      query,
      setQuery,
    } = model.empty;
    return (
      <EmptyResearchView
        inputRef={inputRef}
        isSearching={isSearching}
        onFocusInput={handleFocusInput}
        onSampleQuery={handleSampleQuery}
        onSearch={handleSearch}
        query={query}
        setQuery={setQuery}
      />
    );
  }
  return <ResearchChatView view={model.chat} />;
};

const ResearchWorkspace = ({ model }: { readonly model: ResearchWorkspaceModel }) => {
  const { onStop: handleStop, onToggleSidebar: handleToggleSidebar } = model;
  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <WorkspaceHeader
        activeBriefTitle={model.activeBriefTitle}
        isEmpty={model.isEmpty}
        isSearching={model.isSearching}
        latestAssistantMessage={model.latestAssistantMessage}
        messageCount={model.messageCount}
        onStop={handleStop}
        onToggleSidebar={handleToggleSidebar}
        sidebarCollapsed={model.collapsed}
      />
      <main className="flex h-full flex-1 flex-col overflow-hidden bg-transparent">
        <ResearchWorkspaceContent model={model} />
      </main>
    </div>
  );
};

const ResearchPageView = ({ articleModal, sidebar, workspace }: ResearchPageViewProps) => {
  const { onClose: handleClose } = articleModal;
  return (
    <div className="h-screen overflow-hidden bg-background text-foreground">
      <div className="flex h-screen bg-gradient-to-br from-background via-background to-card/20">
        <ResearchSidebar model={sidebar} />
        <ResearchWorkspace model={workspace} />
      </div>
      <ArticleDetailModal
        article={articleModal.article}
        isOpen={articleModal.isOpen}
        onClose={handleClose}
      />
    </div>
  );
};

export { ResearchPageView };
export type { ResearchPageViewProps };
