import { useCallback } from "react";
import type { ChangeEventHandler } from "react";
import { CollapsedChatSidebar, ExpandedChatSidebar } from "./chat-sidebar-panels";
import { useChatSidebarState } from "./chat-sidebar-state";
import type { ChatSidebarProps } from "./chat-sidebar-types";

const ChatSidebar = ({
  chats,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  onDeleteMultiple,
  activeId,
  collapsed = false,
  onToggle,
}: ChatSidebarProps) => {
  const state = useChatSidebarState({ chats, onDelete, onDeleteMultiple, onRename });
  const { handleDeleteAll, setSearchTerm } = state;
  const handleSearchChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      setSearchTerm(event.target.value);
    },
    [setSearchTerm],
  );
  if (collapsed) {
    return (
      <CollapsedChatSidebar
        chats={chats}
        activeId={activeId}
        onSelect={onSelect}
        onNewChat={onNewChat}
        onToggle={onToggle}
      />
    );
  }
  return (
    <ExpandedChatSidebar
      chats={chats}
      activeId={activeId}
      onSelect={onSelect}
      onDelete={onDelete}
      state={state}
      onSearchChange={handleSearchChange}
      onNewChat={onNewChat}
      onToggle={onToggle}
      onDeleteAll={handleDeleteAll}
    />
  );
};

export { ChatSidebar };
export type { ChatSummary } from "./chat-sidebar-types";
