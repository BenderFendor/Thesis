import { PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import type { ChangeEventHandler, ReactElement } from "react";
import { ChatSidebarToolbar } from "./chat-sidebar-controls";
import { ChatListItem, CollapsedChatButton } from "./chat-sidebar-items";
import type { ChatSidebarState } from "./chat-sidebar-state";
import type { ChatListItemProps, ChatSummary } from "./chat-sidebar-types";

type ChatListProps = Omit<ChatListItemProps, "chat" | "index"> & {
  readonly chats: readonly ChatSummary[];
};

const CollapsedNewChatButton = ({ onNewChat }: Readonly<{ onNewChat: () => void }>) => (
  <button
    type="button"
    onClick={onNewChat}
    title="New chat"
    aria-label="New chat"
    className="mb-4 rounded-full border border-border/40 bg-card/50 p-2 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
  >
    <Plus className="h-4 w-4" />
  </button>
);

const CollapsedChatNav = ({
  chats,
  activeId,
  onSelect,
}: Readonly<{
  chats: readonly ChatSummary[];
  activeId?: string | null;
  onSelect: (id: string) => void;
}>): ReactElement => (
  <nav className="no-scrollbar flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-2">
    {chats.map((chat) => (
      <CollapsedChatButton
        key={chat.id}
        chat={chat}
        isActive={activeId === chat.id}
        onSelect={onSelect}
      />
    ))}
  </nav>
);

const CollapsedToggleButton = ({ onToggle }: Readonly<{ onToggle?: () => void }>) => (
  <button
    type="button"
    onClick={onToggle}
    title="Expand"
    aria-label="Expand sidebar"
    className="mt-4 rounded-full border border-border/40 bg-card/50 p-2 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
  >
    <PanelLeftOpen className="h-4 w-4" />
  </button>
);

const CollapsedChatSidebar = ({
  chats,
  activeId,
  onSelect,
  onNewChat,
  onToggle,
}: Readonly<{
  chats: readonly ChatSummary[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onToggle?: () => void;
}>): ReactElement => (
  <aside className="flex h-screen w-16 flex-col items-center overflow-hidden border-r border-border/40 bg-background/80 py-3 backdrop-blur-xl">
    <CollapsedNewChatButton onNewChat={onNewChat} />
    <CollapsedChatNav chats={chats} activeId={activeId} onSelect={onSelect} />
    <CollapsedToggleButton onToggle={onToggle} />
  </aside>
);

const SidebarCollapseButton = ({ onToggle }: Readonly<{ onToggle?: () => void }>) => {
  if (!onToggle) {
    return null;
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className="rounded-full border border-border/40 bg-card/50 p-2 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
      aria-label="Collapse sidebar"
    >
      <PanelLeftClose className="h-4 w-4" />
    </button>
  );
};

const ExpandedSidebarHeading = ({ onToggle }: Readonly<{ onToggle?: () => void }>) => (
  <div className="mb-4 flex items-center justify-between">
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">Workspace</div>
      <h2 className="font-serif text-xl text-foreground">Research Threads</h2>
    </div>
    <SidebarCollapseButton onToggle={onToggle} />
  </div>
);

const ExpandedSidebarHeader = ({
  state,
  chatCount,
  searchTerm,
  onSearchChange,
  onNewChat,
  onToggle,
  onDeleteAll,
}: Readonly<{
  state: Readonly<ChatSidebarState>;
  chatCount: number;
  searchTerm: string;
  onSearchChange: ChangeEventHandler<HTMLInputElement>;
  onNewChat: () => void;
  onToggle?: () => void;
  onDeleteAll: () => void;
}>) => {
  const {
    allFilteredSelected,
    handleDeleteSelected,
    isSelectionMode,
    selectedIds,
    toggleSelectAll,
    toggleSelectionMode,
  } = state;
  const handleToggleSelectionMode = toggleSelectionMode;
  const handleToggleSelectAll = toggleSelectAll;
  const handleDeleteSelectedChats = handleDeleteSelected;
  return (
    <div className="border-b border-border/40 px-4 pb-4 pt-4">
      <ExpandedSidebarHeading onToggle={onToggle} />
      <ChatSidebarToolbar
        isSelectionMode={isSelectionMode}
        selectedCount={selectedIds.size}
        allFilteredSelected={allFilteredSelected}
        chatCount={chatCount}
        onNewChat={onNewChat}
        onToggleSelectionMode={handleToggleSelectionMode}
        onToggleSelectAll={handleToggleSelectAll}
        onDeleteSelected={handleDeleteSelectedChats}
        onDeleteAll={onDeleteAll}
      />
      <ChatSidebarSearch searchTerm={searchTerm} onSearchChange={onSearchChange} />
    </div>
  );
};

const ChatSidebarSearch = ({
  searchTerm,
  onSearchChange,
}: Readonly<{
  searchTerm: string;
  onSearchChange: ChangeEventHandler<HTMLInputElement>;
}>): ReactElement => (
  <div className="relative mt-4">
    <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    <input
      value={searchTerm}
      onChange={onSearchChange}
      placeholder="Search conversations"
      aria-label="Search chats"
      className="h-11 w-full rounded-full border border-border/40 bg-card/30 pl-11 pr-4 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
    />
  </div>
);

const EmptyChatList = (): ReactElement => (
  <div className="rounded-3xl border border-border/30 bg-card/30 px-4 py-6 text-sm text-muted-foreground">
    No chats match your search.
  </div>
);

const AnimatedChatItems = ({ items }: Readonly<{ items: ChatListProps }>) => {
  const {
    chats,
    activeId,
    editingId,
    draftTitle,
    isSelectionMode,
    selectedIds,
    onSelect,
    onDelete,
    onDraftTitleChange,
    startRename,
    cancelRename,
    commitRename,
    toggleSelection,
  } = items;
  return (
    <AnimatePresence initial={false}>
      {chats.map((chat, index) => (
        <ChatListItem
          key={chat.id}
          chat={chat}
          index={index}
          activeId={activeId}
          editingId={editingId}
          draftTitle={draftTitle}
          isSelectionMode={isSelectionMode}
          selectedIds={selectedIds}
          onSelect={onSelect}
          onDelete={onDelete}
          onDraftTitleChange={onDraftTitleChange}
          startRename={startRename}
          cancelRename={cancelRename}
          commitRename={commitRename}
          toggleSelection={toggleSelection}
        />
      ))}
    </AnimatePresence>
  );
};

const ChatList = (props: Readonly<ChatListProps>): ReactElement => (
  <ul className="space-y-2">
    <AnimatedChatItems items={props} />
  </ul>
);

const ChatSidebarList = ({
  filteredChats,
  activeId,
  state,
  onSelect,
  onDelete,
}: Readonly<{
  filteredChats: readonly ChatSummary[];
  activeId?: string | null;
  state: Readonly<ChatSidebarState>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}>): ReactElement => {
  const {
    cancelRename,
    commitRename,
    draftTitle,
    editingId,
    isSelectionMode,
    selectedIds,
    setDraftTitle,
    startRename,
    toggleSelection,
  } = state;
  const handleDraftTitleChange = setDraftTitle;
  if (filteredChats.length === 0) {
    return <EmptyChatList />;
  }
  return (
    <ChatList
      chats={filteredChats}
      activeId={activeId}
      editingId={editingId}
      draftTitle={draftTitle}
      isSelectionMode={isSelectionMode}
      selectedIds={selectedIds}
      onSelect={onSelect}
      onDelete={onDelete}
      onDraftTitleChange={handleDraftTitleChange}
      startRename={startRename}
      cancelRename={cancelRename}
      commitRename={commitRename}
      toggleSelection={toggleSelection}
    />
  );
};

const ExpandedChatSidebar = ({
  chats,
  activeId,
  onSelect,
  onDelete,
  state,
  onSearchChange,
  onNewChat,
  onToggle,
  onDeleteAll,
}: Readonly<{
  chats: readonly ChatSummary[];
  activeId?: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  state: Readonly<ChatSidebarState>;
  onSearchChange: ChangeEventHandler<HTMLInputElement>;
  onNewChat: () => void;
  onToggle?: () => void;
  onDeleteAll: () => void;
}>): ReactElement => (
  <aside className="flex h-screen w-64 min-w-64 flex-col overflow-hidden border-r border-border/40 bg-background/80 text-foreground backdrop-blur-xl">
    <ExpandedSidebarHeader
      state={state}
      chatCount={chats.length}
      searchTerm={state.searchTerm}
      onSearchChange={onSearchChange}
      onNewChat={onNewChat}
      onToggle={onToggle}
      onDeleteAll={onDeleteAll}
    />
    <div className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
      <ChatSidebarList
        filteredChats={state.filteredChats}
        activeId={activeId}
        state={state}
        onSelect={onSelect}
        onDelete={onDelete}
      />
    </div>
  </aside>
);

export { CollapsedChatSidebar, ExpandedChatSidebar };
