interface ChatFormSubmitEvent {
  readonly preventDefault: () => void;
}

interface ChatSummary {
  readonly id: string;
  readonly title: string;
  readonly lastMessage?: string;
  readonly updatedAt?: string;
}

interface ChatSidebarProps {
  readonly chats: readonly ChatSummary[];
  readonly onSelect: (id: string) => void;
  readonly onNewChat: () => void;
  readonly onRename: (id: string, title: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onDeleteMultiple?: (ids: readonly string[]) => void;
  readonly activeId?: string | null;
  readonly collapsed?: boolean;
  readonly onToggle?: () => void;
}

interface ChatListItemProps {
  readonly chat: ChatSummary;
  readonly index: number;
  readonly activeId?: string | null;
  readonly editingId: string | null;
  readonly draftTitle: string;
  readonly isSelectionMode: boolean;
  readonly selectedIds: ReadonlySet<string>;
  readonly onSelect: (id: string) => void;
  readonly onDelete: (id: string) => void;
  readonly onDraftTitleChange: (title: string) => void;
  readonly startRename: (chat: ChatSummary) => void;
  readonly cancelRename: () => void;
  readonly commitRename: () => void;
  readonly toggleSelection: (id: string) => void;
}

type ChatListItemCardProps = Omit<ChatListItemProps, "index">;

interface ChatListItemSelectionProps {
  readonly isSelectionMode: boolean;
  readonly isSelected: boolean;
}

interface ChatListItemBodyProps {
  readonly chat: ChatSummary;
  readonly isEditing: boolean;
  readonly isSelectionMode: boolean;
  readonly draftTitle: string;
  readonly onSelect: (id: string) => void;
  readonly onDraftTitleChange: (title: string) => void;
  readonly cancelRename: () => void;
  readonly commitRename: () => void;
  readonly toggleSelection: (id: string) => void;
}

interface ChatListItemActionsProps {
  readonly chat: ChatSummary;
  readonly isEditing: boolean;
  readonly isSelectionMode: boolean;
  readonly onDelete: (id: string) => void;
  readonly startRename: (chat: ChatSummary) => void;
  readonly commitRename: () => void;
}

export type {
  ChatFormSubmitEvent,
  ChatListItemActionsProps,
  ChatListItemBodyProps,
  ChatListItemCardProps,
  ChatListItemProps,
  ChatListItemSelectionProps,
  ChatSidebarProps,
  ChatSummary,
};
