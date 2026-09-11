import { Button } from "./ui/button";
import { CheckSquare, Plus, Trash2, X } from "lucide-react";
import type { ReactElement } from "react";

interface ChatSidebarToolbarProps {
  readonly isSelectionMode: boolean;
  readonly selectedCount: number;
  readonly allFilteredSelected: boolean;
  readonly chatCount: number;
  readonly onNewChat: () => void;
  readonly onToggleSelectionMode: () => void;
  readonly onToggleSelectAll: () => void;
  readonly onDeleteSelected: () => void;
  readonly onDeleteAll: () => void;
}

const selectAllLabel = (allFilteredSelected: boolean): string => {
  if (allFilteredSelected) {
    return "Clear";
  }
  return "Select all";
};

const ChatSelectionSummary = ({ selectedCount }: Readonly<{ selectedCount: number }>) => (
  <span className="text-sm text-muted-foreground">{selectedCount} selected</span>
);

const ChatSelectAllButton = ({
  allFilteredSelected,
  onToggleSelectAll,
}: Readonly<{
  allFilteredSelected: boolean;
  onToggleSelectAll: () => void;
}>) => (
  <Button
    onClick={onToggleSelectAll}
    variant="ghost"
    size="sm"
    className="h-8 rounded-full px-3 text-xs transition-all duration-300 ease-out active:scale-95"
  >
    {selectAllLabel(allFilteredSelected)}
  </Button>
);

const ChatDeleteSelectedButton = ({
  selectedCount,
  onDeleteSelected,
}: Readonly<{
  selectedCount: number;
  onDeleteSelected: () => void;
}>) => (
  <Button
    onClick={onDeleteSelected}
    variant="ghost"
    size="sm"
    disabled={selectedCount === 0}
    className="h-8 rounded-full px-3 text-xs text-destructive transition-all duration-300 ease-out active:scale-95"
  >
    Delete
  </Button>
);

const ChatCancelSelectionButton = ({
  onToggleSelectionMode,
}: Readonly<{ onToggleSelectionMode: () => void }>) => (
  <Button
    onClick={onToggleSelectionMode}
    variant="ghost"
    size="sm"
    className="h-8 rounded-full px-3 text-xs transition-all duration-300 ease-out active:scale-95"
  >
    <X className="mr-1 h-3.5 w-3.5" />
    Cancel
  </Button>
);

const ChatSelectionButtons = (props: ChatSidebarToolbarProps): ReactElement => (
  <div className="flex gap-2">
    <ChatSelectAllButton
      allFilteredSelected={props.allFilteredSelected}
      onToggleSelectAll={props.onToggleSelectAll}
    />
    <ChatDeleteSelectedButton
      selectedCount={props.selectedCount}
      onDeleteSelected={props.onDeleteSelected}
    />
    <ChatCancelSelectionButton onToggleSelectionMode={props.onToggleSelectionMode} />
  </div>
);

const ChatSelectionToolbar = (props: ChatSidebarToolbarProps): ReactElement => (
  <div className="flex items-center justify-between gap-2 rounded-3xl border border-border/40 bg-card/50 px-4 py-3">
    <ChatSelectionSummary selectedCount={props.selectedCount} />
    <ChatSelectionButtons
      isSelectionMode={props.isSelectionMode}
      selectedCount={props.selectedCount}
      allFilteredSelected={props.allFilteredSelected}
      chatCount={props.chatCount}
      onNewChat={props.onNewChat}
      onToggleSelectionMode={props.onToggleSelectionMode}
      onToggleSelectAll={props.onToggleSelectAll}
      onDeleteSelected={props.onDeleteSelected}
      onDeleteAll={props.onDeleteAll}
    />
  </div>
);

const ChatNewButton = ({ onNewChat }: Readonly<{ onNewChat: () => void }>) => (
  <Button
    onClick={onNewChat}
    variant="ghost"
    className="h-10 flex-1 justify-start gap-2 rounded-full border border-border/40 bg-card/50 text-sm font-medium transition-all duration-300 ease-out hover:bg-card active:scale-95"
  >
    <Plus className="h-4 w-4" />
    New Session
  </Button>
);

const ChatSelectionModeButton = ({
  onToggleSelectionMode,
}: Readonly<{ onToggleSelectionMode: () => void }>) => (
  <Button
    onClick={onToggleSelectionMode}
    variant="ghost"
    size="icon"
    title="Select chats"
    className="h-10 w-10 rounded-full border border-border/40 bg-card/50 transition-all duration-300 ease-out hover:bg-card active:scale-95"
  >
    <CheckSquare className="h-4 w-4 text-muted-foreground" />
  </Button>
);

const ChatDeleteAllButton = ({
  chatCount,
  onDeleteAll,
}: Readonly<{
  chatCount: number;
  onDeleteAll: () => void;
}>) => (
  <Button
    onClick={onDeleteAll}
    variant="ghost"
    size="icon"
    title="Delete all chats"
    disabled={chatCount === 0}
    className="h-10 w-10 rounded-full border border-border/40 bg-card/50 text-destructive transition-all duration-300 ease-out hover:bg-card active:scale-95 disabled:opacity-40"
  >
    <Trash2 className="h-4 w-4" />
  </Button>
);

const ChatDefaultToolbar = (props: ChatSidebarToolbarProps): ReactElement => (
  <div className="flex gap-2">
    <ChatNewButton onNewChat={props.onNewChat} />
    <ChatSelectionModeButton onToggleSelectionMode={props.onToggleSelectionMode} />
    <ChatDeleteAllButton chatCount={props.chatCount} onDeleteAll={props.onDeleteAll} />
  </div>
);

const ChatSidebarToolbar = (props: ChatSidebarToolbarProps): ReactElement => {
  if (props.isSelectionMode) {
    return (
      <ChatSelectionToolbar
        isSelectionMode={props.isSelectionMode}
        selectedCount={props.selectedCount}
        allFilteredSelected={props.allFilteredSelected}
        chatCount={props.chatCount}
        onNewChat={props.onNewChat}
        onToggleSelectionMode={props.onToggleSelectionMode}
        onToggleSelectAll={props.onToggleSelectAll}
        onDeleteSelected={props.onDeleteSelected}
        onDeleteAll={props.onDeleteAll}
      />
    );
  }
  return (
    <ChatDefaultToolbar
      isSelectionMode={props.isSelectionMode}
      selectedCount={props.selectedCount}
      allFilteredSelected={props.allFilteredSelected}
      chatCount={props.chatCount}
      onNewChat={props.onNewChat}
      onToggleSelectionMode={props.onToggleSelectionMode}
      onToggleSelectAll={props.onToggleSelectAll}
      onDeleteSelected={props.onDeleteSelected}
      onDeleteAll={props.onDeleteAll}
    />
  );
};

export { ChatSidebarToolbar };
