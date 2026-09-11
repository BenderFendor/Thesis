import { hasText } from "@/lib/utils";
import { formatShortDate } from "@/lib/date-formatters";
import { motion } from "framer-motion";
import { CheckSquare, PenLine, Trash2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import type {
  ChangeEventHandler,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactElement,
} from "react";
import type {
  ChatFormSubmitEvent,
  ChatListItemActionsProps,
  ChatListItemBodyProps,
  ChatListItemCardProps,
  ChatListItemProps,
  ChatListItemSelectionProps,
  ChatSummary,
} from "./chat-sidebar-types";

const chatItemClassName = (
  isSelectionMode: boolean,
  isSelected: boolean,
  isActive: boolean,
): string => {
  if (isSelectionMode && isSelected) {
    return "border-primary/40 bg-primary/10";
  }
  if (isSelectionMode) {
    return "border-border/30 bg-card/30 hover:bg-card/50";
  }
  if (isActive) {
    return "border-primary/40 bg-card shadow-lg shadow-black/20";
  }
  return "border-border/30 bg-card/30 hover:bg-card/50";
};

const selectionClassName = (isSelected: boolean): string => {
  if (isSelected) {
    return "border-primary bg-primary text-primary-foreground";
  }
  return "border-border/50 bg-transparent";
};

const ChatListItemSelection = ({
  isSelectionMode,
  isSelected,
}: ChatListItemSelectionProps): ReactElement | null => {
  if (!isSelectionMode) {
    return null;
  }
  return (
    <div
      className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border ${selectionClassName(isSelected)}`}
    >
      {isSelected && <CheckSquare className="h-3 w-3" />}
    </div>
  );
};

const ChatItemMetadata = ({ chat }: Readonly<{ chat: ChatSummary }>) => (
  <div className="mb-2 flex items-center justify-between gap-3">
    <span className="text-xs uppercase tracking-wider text-muted-foreground">Thread</span>
    {hasText(chat.updatedAt) && (
      <span className="text-xs text-muted-foreground">{formatShortDate(chat.updatedAt)}</span>
    )}
  </div>
);

const ChatMessageContent = ({ chat }: Readonly<{ chat: ChatSummary }>) => (
  <>
    <div className="font-serif text-base text-foreground line-clamp-2">{chat.title}</div>
    {hasText(chat.lastMessage) && (
      <div className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
        {chat.lastMessage}
      </div>
    )}
  </>
);

const ChatRenameForm = ({
  draftTitle,
  commitRename,
  handleSubmit,
  handleTitleChange,
  handleTitleKeyDown,
}: Readonly<{
  draftTitle: string;
  commitRename: () => void;
  handleSubmit: (event: ChatFormSubmitEvent) => void;
  handleTitleChange: ChangeEventHandler<HTMLInputElement>;
  handleTitleKeyDown: KeyboardEventHandler<HTMLInputElement>;
}>) => (
  <form onSubmit={handleSubmit}>
    <input
      value={draftTitle}
      onChange={handleTitleChange}
      onBlur={commitRename}
      onKeyDown={handleTitleKeyDown}
      className="w-full rounded-2xl border border-primary/40 bg-background/60 px-3 py-2 text-sm font-serif text-foreground focus:outline-none"
    />
  </form>
);

const ChatSelectionPreview = ({ chat }: Readonly<{ chat: ChatSummary }>) => (
  <div className="w-full text-left">
    <ChatMessageContent chat={chat} />
  </div>
);

const ChatOpenButton = ({
  chat,
  onClick,
}: Readonly<{
  chat: ChatSummary;
  onClick: MouseEventHandler<HTMLButtonElement>;
}>) => (
  <button
    type="button"
    onClick={onClick}
    className="w-full text-left"
    aria-label={`Open chat ${chat.title}`}
  >
    <ChatMessageContent chat={chat} />
  </button>
);

const ChatListItemContent = ({
  chat,
  isEditing,
  isSelectionMode,
  draftTitle,
  commitRename,
  handleSubmit,
  handleTitleChange,
  handleTitleKeyDown,
  handleSelect,
}: Readonly<{
  chat: ChatSummary;
  isEditing: boolean;
  isSelectionMode: boolean;
  draftTitle: string;
  commitRename: () => void;
  handleSubmit: (event: ChatFormSubmitEvent) => void;
  handleTitleChange: ChangeEventHandler<HTMLInputElement>;
  handleTitleKeyDown: KeyboardEventHandler<HTMLInputElement>;
  handleSelect: MouseEventHandler<HTMLButtonElement>;
}>) => {
  if (isEditing) {
    return (
      <ChatRenameForm
        draftTitle={draftTitle}
        commitRename={commitRename}
        handleSubmit={handleSubmit}
        handleTitleChange={handleTitleChange}
        handleTitleKeyDown={handleTitleKeyDown}
      />
    );
  }
  if (isSelectionMode) {
    return <ChatSelectionPreview chat={chat} />;
  }
  return <ChatOpenButton chat={chat} onClick={handleSelect} />;
};

const useChatListItemHandlers = ({
  chat,
  isSelectionMode,
  onSelect,
  onDraftTitleChange,
  cancelRename,
  commitRename,
  toggleSelection,
}: Readonly<ChatListItemBodyProps>) => {
  const handleSubmit = useCallback(
    (event: ChatFormSubmitEvent) => {
      event.preventDefault();
      commitRename();
    },
    [commitRename],
  );
  const handleTitleChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      onDraftTitleChange(event.target.value);
    },
    [onDraftTitleChange],
  );
  const handleTitleKeyDown = useCallback<KeyboardEventHandler<HTMLInputElement>>(
    (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancelRename();
      }
    },
    [cancelRename],
  );
  const handleSelect = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      if (isSelectionMode) {
        event.preventDefault();
        toggleSelection(chat.id);
      } else {
        onSelect(chat.id);
      }
    },
    [chat.id, isSelectionMode, onSelect, toggleSelection],
  );
  return { handleSelect, handleSubmit, handleTitleChange, handleTitleKeyDown };
};

const ChatListItemBody = (props: Readonly<ChatListItemBodyProps>): ReactElement => {
  const { chat, isEditing, isSelectionMode, draftTitle, commitRename } = props;
  const { handleSubmit, handleTitleChange, handleTitleKeyDown, handleSelect } =
    useChatListItemHandlers(props);

  return (
    <div className="min-w-0 flex-1">
      <ChatItemMetadata chat={chat} />
      <ChatListItemContent
        chat={chat}
        isEditing={isEditing}
        isSelectionMode={isSelectionMode}
        draftTitle={draftTitle}
        commitRename={commitRename}
        handleSubmit={handleSubmit}
        handleTitleChange={handleTitleChange}
        handleTitleKeyDown={handleTitleKeyDown}
        handleSelect={handleSelect}
      />
    </div>
  );
};

const renameButtonLabel = (isEditing: boolean): string => {
  if (isEditing) {
    return "Save chat name";
  }
  return "Rename chat";
};

const ChatRenameActionButton = ({
  isEditing,
  onClick,
}: Readonly<{
  isEditing: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
}>) => (
  <button
    type="button"
    onClick={onClick}
    className="rounded-full border border-border/40 bg-background/50 p-2 text-muted-foreground transition-all duration-300 ease-out hover:bg-card hover:text-foreground active:scale-95"
    aria-label={renameButtonLabel(isEditing)}
  >
    <PenLine className="h-3.5 w-3.5" />
  </button>
);

const ChatDeleteActionButton = ({
  onClick,
}: Readonly<{ onClick: MouseEventHandler<HTMLButtonElement> }>) => (
  <button
    type="button"
    onClick={onClick}
    className="rounded-full border border-border/40 bg-background/50 p-2 text-destructive transition-all duration-300 ease-out hover:bg-card active:scale-95"
    aria-label="Delete chat"
  >
    <Trash2 className="h-3.5 w-3.5" />
  </button>
);

const ChatListItemActions = ({
  chat,
  isEditing,
  isSelectionMode,
  onDelete,
  startRename,
  commitRename,
}: ChatListItemActionsProps): ReactElement | null => {
  const handleRename = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      event.stopPropagation();
      if (isEditing) {
        commitRename();
      } else {
        startRename(chat);
      }
    },
    [chat, commitRename, isEditing, startRename],
  );
  const handleDelete = useCallback<MouseEventHandler<HTMLButtonElement>>(
    (event) => {
      event.stopPropagation();
      if (globalThis.confirm("Delete this chat? This action cannot be undone.")) {
        onDelete(chat.id);
      }
    },
    [chat.id, onDelete],
  );

  if (isSelectionMode) {
    return null;
  }
  return (
    <div className="flex flex-col gap-2 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
      <ChatRenameActionButton isEditing={isEditing} onClick={handleRename} />
      <ChatDeleteActionButton onClick={handleDelete} />
    </div>
  );
};

const ChatListItemCardBody = ({ item }: Readonly<{ item: ChatListItemCardProps }>) => {
  const {
    chat,
    editingId,
    isSelectionMode,
    draftTitle,
    selectedIds,
    onSelect,
    onDelete,
    onDraftTitleChange,
    startRename,
    cancelRename,
    commitRename,
    toggleSelection,
  } = item;
  const isEditing = editingId === chat.id;
  return (
    <div className="flex items-start gap-3">
      <ChatListItemSelection
        isSelectionMode={isSelectionMode}
        isSelected={selectedIds.has(chat.id)}
      />
      <ChatListItemBody
        chat={chat}
        isEditing={isEditing}
        isSelectionMode={isSelectionMode}
        draftTitle={draftTitle}
        onSelect={onSelect}
        onDraftTitleChange={onDraftTitleChange}
        cancelRename={cancelRename}
        commitRename={commitRename}
        toggleSelection={toggleSelection}
      />
      <ChatListItemActions
        chat={chat}
        isEditing={isEditing}
        isSelectionMode={isSelectionMode}
        onDelete={onDelete}
        startRename={startRename}
        commitRename={commitRename}
      />
    </div>
  );
};

const ChatListItemCard = (props: Readonly<ChatListItemCardProps>): ReactElement => {
  const { chat, activeId, isSelectionMode, selectedIds, toggleSelection } = props;
  const isActive = activeId === chat.id;
  const isSelected = selectedIds.has(chat.id);
  const handleCardClick = useCallback<MouseEventHandler<HTMLButtonElement>>(() => {
    if (isSelectionMode) {
      toggleSelection(chat.id);
    }
  }, [chat.id, isSelectionMode, toggleSelection]);
  const cardClassName = `group rounded-3xl border p-4 transition-all duration-300 ease-out ${chatItemClassName(isSelectionMode, isSelected, isActive)}`;
  if (isSelectionMode) {
    return (
      <button
        type="button"
        className={cardClassName}
        aria-label={`Select chat ${chat.title}`}
        onClick={handleCardClick}
      >
        <ChatListItemCardBody item={props} />
      </button>
    );
  }
  return (
    <div className={cardClassName}>
      <ChatListItemCardBody item={props} />
    </div>
  );
};

const CHAT_VERTICAL_OFFSET = "y";
const CHAT_ITEM_INITIAL = { opacity: 0, [CHAT_VERTICAL_OFFSET]: 12 } as const;
const CHAT_ITEM_ANIMATE = { opacity: 1, [CHAT_VERTICAL_OFFSET]: 0 } as const;
const CHAT_ITEM_EXIT = { opacity: 0, [CHAT_VERTICAL_OFFSET]: -8 } as const;

const ChatListItem = ({
  chat,
  index,
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
}: ChatListItemProps): ReactElement => {
  const transition = useMemo(
    () => ({ delay: index * 0.02, duration: 0.2, ease: "easeOut" as const }),
    [index],
  );
  return (
    <motion.li
      layout
      initial={CHAT_ITEM_INITIAL}
      animate={CHAT_ITEM_ANIMATE}
      exit={CHAT_ITEM_EXIT}
      transition={transition}
    >
      <ChatListItemCard
        chat={chat}
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
    </motion.li>
  );
};

const collapsedChatButtonClassName = (isActive: boolean): string => {
  if (isActive) {
    return "border-primary/40 bg-primary/15 text-primary shadow-lg shadow-black/20";
  }
  return "border-border/30 bg-card/50 text-muted-foreground hover:bg-card hover:text-foreground";
};

const CollapsedChatButton = ({
  chat,
  isActive,
  onSelect,
}: Readonly<{
  chat: ChatSummary;
  isActive: boolean;
  onSelect: (id: string) => void;
}>): ReactElement => {
  const handleClick = useCallback(() => {
    onSelect(chat.id);
  }, [chat.id, onSelect]);
  return (
    <button
      type="button"
      onClick={handleClick}
      title={chat.title}
      className={`flex h-11 w-11 items-center justify-center rounded-2xl border text-xs font-semibold uppercase tracking-wide transition-all duration-300 ease-out active:scale-95 ${collapsedChatButtonClassName(isActive)}`}
    >
      {chat.title.charAt(0).toUpperCase() || "?"}
    </button>
  );
};

export { ChatListItem, CollapsedChatButton };
