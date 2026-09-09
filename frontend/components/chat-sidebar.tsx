import { hasText } from "@/lib/utils";
import { AnimatePresence, motion } from "framer-motion";
import {
  CheckSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PenLine,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import React, { useCallback, useMemo, useState } from "react";
import { Button } from "./ui/button";
import { formatShortDate } from "@/lib/date-formatters";

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

const chatItemClassName = (
  isSelectionMode: boolean,
  isSelected: boolean,
  isActive: boolean,
): string => {
  if (isSelectionMode) {
    if (isSelected) {
  return "border-primary/40 bg-primary/10";
}
return "border-border/30 bg-card/30 hover:bg-card/50";
  }
  if (isActive) {
  return "border-primary/40 bg-card shadow-lg shadow-black/20";
}
return "border-border/30 bg-card/30 hover:bg-card/50";
};

interface ChatListItemSelectionProps {
  readonly isSelectionMode: boolean;
  readonly isSelected: boolean;
}

const ChatListItemSelection = ({
  isSelectionMode,
  isSelected,
}: ChatListItemSelectionProps): React.JSX.Element | null => {
  if (!isSelectionMode) {
    return null;
  }
  return (
    <div
      className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border ${
        (() => {
  if (isSelected) {
    return "border-primary bg-primary text-primary-foreground";
  }
  return "border-border/50 bg-transparent";
})()
      }`}
    >
      {isSelected && <CheckSquare className="h-3 w-3" />}
    </div>
  );
};

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

const ChatListItemBody = ({
  chat,
  isEditing,
  isSelectionMode,
  draftTitle,
  onSelect,
  onDraftTitleChange,
  cancelRename,
  commitRename,
  toggleSelection,
}: ChatListItemBodyProps): React.JSX.Element => {
  const handleSubmit = useCallback(
      (event: ChatFormSubmitEvent) => {
        event.preventDefault();
        commitRename();
      },
      [commitRename],
    );
  const handleTitleChange = useCallback<React.ChangeEventHandler<HTMLInputElement>>(
      (event) => {
        onDraftTitleChange(event.target.value);
      },
      [onDraftTitleChange],
    );
  const handleTitleKeyDown = useCallback<React.KeyboardEventHandler<HTMLInputElement>>(
      (event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          cancelRename();
        }
      },
      [cancelRename],
    );
  const handleSelect = useCallback<React.MouseEventHandler<HTMLButtonElement>>(
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
  const chatContent = (
    <>
      <div className="font-serif text-base text-foreground line-clamp-2">{chat.title}</div>
      {hasText(chat.lastMessage) && (
        <div className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
          {chat.lastMessage}
        </div>
      )}
    </>
  );

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Thread</span>
        {hasText(chat.updatedAt) && (
          <span className="text-xs text-muted-foreground">{formatShortDate(chat.updatedAt)}</span>
        )}
      </div>

      {(() => {
  if (isEditing) {
    return <form onSubmit={handleSubmit}>
          <input value={draftTitle} onChange={handleTitleChange} onBlur={commitRename} onKeyDown={handleTitleKeyDown} className="w-full rounded-2xl border border-primary/40 bg-background/60 px-3 py-2 text-sm font-serif text-foreground focus:outline-none" />
        </form>;
  }
  return (() => {
    if (isSelectionMode) {
      return <div className="w-full text-left">{chatContent}</div>;
    }
    return <button onClick={handleSelect} className="w-full text-left" aria-label={`Open chat ${chat.title}`} disabled={isSelectionMode}>
          {chatContent}
        </button>;
  })();
})()}
    </div>
  );
};

interface ChatListItemActionsProps {
  readonly chat: ChatSummary;
  readonly isEditing: boolean;
  readonly isSelectionMode: boolean;
  readonly onDelete: (id: string) => void;
  readonly startRename: (chat: ChatSummary) => void;
  readonly commitRename: () => void;
}

const ChatListItemActions = ({
  chat,
  isEditing,
  isSelectionMode,
  onDelete,
  startRename,
  commitRename,
}: ChatListItemActionsProps): React.JSX.Element | null => {
  const handleRename = useCallback<React.MouseEventHandler<HTMLButtonElement>>(
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
  const handleDelete = useCallback<React.MouseEventHandler<HTMLButtonElement>>(
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
      <button
        type="button"
        onClick={handleRename}
        className="rounded-full border border-border/40 bg-background/50 p-2 text-muted-foreground transition-all duration-300 ease-out hover:bg-card hover:text-foreground active:scale-95"
        aria-label="Rename chat"
      >
        <PenLine className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={handleDelete}
        className="rounded-full border border-border/40 bg-background/50 p-2 text-destructive transition-all duration-300 ease-out hover:bg-card active:scale-95"
        aria-label="Delete chat"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
};

const ChatListItemCard = (props: ChatListItemProps): React.JSX.Element => {
  const {
      chat,
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
    } = props,
    isActive = activeId === chat.id,
    isEditing = editingId === chat.id,
    isSelected = selectedIds.has(chat.id);
  const handleCardClick = useCallback<React.MouseEventHandler<HTMLButtonElement>>(
      () => {
        if (isSelectionMode) {
          toggleSelection(chat.id);
        }
      },
      [chat.id, isSelectionMode, toggleSelection],
    );

  const cardContent = (
      <div className="flex items-start gap-3">
        <ChatListItemSelection isSelectionMode={isSelectionMode} isSelected={isSelected} />
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
  const cardClassName = `group rounded-3xl border p-4 transition-all duration-300 ease-out ${chatItemClassName(isSelectionMode, isSelected, isActive)}`;

  if (isSelectionMode) {
  return <button type="button" className={cardClassName} aria-label={`Select chat ${chat.title}`} onClick={handleCardClick}>
      {cardContent}
    </button>;
}
return <div className={cardClassName}>{cardContent}</div>;
};

const CHAT_ITEM_INITIAL = { opacity: 0, y: 12 } as const;
const CHAT_ITEM_ANIMATE = { opacity: 1, y: 0 } as const;
const CHAT_ITEM_EXIT = { opacity: 0, y: -8 } as const;

const ChatListItem = ({ chat, index, ...props }: ChatListItemProps): React.JSX.Element => {
  const transition = useMemo(
    () => ({ delay: index * 0.02, duration: 0.2, ease: "easeOut" as const }),
    [index],
  );

  return (
    <motion.li
      key={chat.id}
      layout
      initial={CHAT_ITEM_INITIAL}
      animate={CHAT_ITEM_ANIMATE}
      exit={CHAT_ITEM_EXIT}
      transition={transition}
    >
      <ChatListItemCard chat={chat} index={index} {...props} />
    </motion.li>
  );
};

interface CollapsedChatButtonProps {
  readonly chat: ChatSummary;
  readonly isActive: boolean;
  readonly onSelect: (id: string) => void;
}

const CollapsedChatButton = ({
  chat,
  isActive,
  onSelect,
}: CollapsedChatButtonProps): React.JSX.Element => {
  const handleClick = useCallback(() => {
    onSelect(chat.id);
  }, [chat.id, onSelect]);

  return (
    <button
      onClick={handleClick}
      title={chat.title}
      className={`flex h-11 w-11 items-center justify-center rounded-2xl border text-xs font-semibold uppercase tracking-wide transition-all duration-300 ease-out active:scale-95 ${
        (() => {
  if (isActive) {
    return "border-primary/40 bg-primary/15 text-primary shadow-lg shadow-black/20";
  }
  return "border-border/30 bg-card/50 text-muted-foreground hover:bg-card hover:text-foreground";
})()
      }`}
    >
      {chat.title?.charAt(0)?.toUpperCase() || "?"}
    </button>
  );
};

const useChatSidebarState = ({
  chats,
  onDelete,
  onDeleteMultiple,
  onRename,
}: Pick<ChatSidebarProps, "chats" | "onDelete" | "onDeleteMultiple" | "onRename">) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const filteredChats = useMemo(() => {
      if (!searchTerm.trim()) {
        return chats;
      }
      const term = searchTerm.trim().toLowerCase();
      return chats.filter((chat) => {
        const inMessage = chat.lastMessage?.toLowerCase().includes(term),
          inTitle = chat.title?.toLowerCase().includes(term);
        return inTitle || inMessage === true;
      });
    }, [chats, searchTerm]);
  const allFilteredSelected = filteredChats.length > 0 && selectedIds.size === filteredChats.length;
  const startRename = (chat: ChatSummary) => {
      setEditingId(chat.id);
      setDraftTitle(chat.title);
    };
  const cancelRename = () => {
      setEditingId(null);
      setDraftTitle("");
    };
  const commitRename = () => {
      if (!hasText(editingId)) {
        return;
      }
      const trimmed = draftTitle.trim();
      if (trimmed) {
        onRename(editingId, trimmed);
      }
      cancelRename();
    };
  const toggleSelectionMode = () => {
      setIsSelectionMode((prev) => !prev);
      setSelectedIds(new Set());
      setEditingId(null);
    };
  const toggleSelection = (id: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
    };
  const handleDeleteSelected = () => {
      if (selectedIds.size === 0) {
        return;
      }
      if (
        globalThis.confirm(
          `Delete ${selectedIds.size} selected chats? This action cannot be undone.`,
        )
      ) {
        if (onDeleteMultiple) {
          onDeleteMultiple([...selectedIds]);
        } else {
          selectedIds.forEach((id) => {
            onDelete(id);
          });
        }
        setIsSelectionMode(false);
        setSelectedIds(new Set());
      }
    };
  const handleDeleteAll = () => {
      if (chats.length === 0) {
        return;
      }
      if (globalThis.confirm(`Delete all ${chats.length} chats? This action cannot be undone.`)) {
        const ids = chats.map((chat) => chat.id);
        if (onDeleteMultiple) {
          onDeleteMultiple(ids);
        } else {
          ids.forEach((id) => {
            onDelete(id);
          });
        }
        setIsSelectionMode(false);
        setSelectedIds(new Set());
      }
    };
  const toggleSelectAll = () => {
      if (allFilteredSelected) {
        setSelectedIds(new Set());
        return;
      }
      setSelectedIds(new Set(filteredChats.map((chat) => chat.id)));
    };

  return {
    allFilteredSelected,
    cancelRename,
    commitRename,
    draftTitle,
    editingId,
    filteredChats,
    handleDeleteAll,
    handleDeleteSelected,
    isSelectionMode,
    searchTerm,
    selectedIds,
    setDraftTitle,
    setEditingId,
    setIsSelectionMode,
    setSearchTerm,
    setSelectedIds,
    startRename,
    toggleSelectAll,
    toggleSelection,
    toggleSelectionMode,
  };
};

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
  const {
    allFilteredSelected,
    cancelRename,
    commitRename,
    draftTitle,
    editingId,
    filteredChats,
    handleDeleteAll,
    handleDeleteSelected,
    isSelectionMode,
    searchTerm,
    selectedIds,
    setDraftTitle,
    setSearchTerm,
    startRename,
    toggleSelectAll,
    toggleSelection,
    toggleSelectionMode,
  } = useChatSidebarState({ chats, onDelete, onDeleteMultiple, onRename });
  const handleSearchChange = useCallback<React.ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      setSearchTerm(event.target.value);
    },
    [setSearchTerm],
  );

  if (collapsed) {
    return (
      <aside className="flex h-screen w-16 flex-col items-center overflow-hidden border-r border-border/40 bg-background/80 py-3 backdrop-blur-xl">
        <button
          onClick={onNewChat}
          title="New chat"
          aria-label="New chat"
          className="mb-4 rounded-full border border-border/40 bg-card/50 p-2 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
        >
          <Plus className="h-4 w-4" />
        </button>

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

        <button
          onClick={onToggle}
          title="Expand"
          aria-label="Expand sidebar"
          className="mt-4 rounded-full border border-border/40 bg-card/50 p-2 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="flex h-screen w-64 min-w-64 flex-col overflow-hidden border-r border-border/40 bg-background/80 text-foreground backdrop-blur-xl">
      <div className="border-b border-border/40 px-4 pb-4 pt-4">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Workspace</div>
            <h2 className="font-serif text-xl text-foreground">Research Threads</h2>
          </div>
          {onToggle && (
            <button
              onClick={onToggle}
              className="rounded-full border border-border/40 bg-card/50 p-2 text-foreground transition-all duration-300 ease-out hover:bg-card active:scale-95"
              aria-label="Collapse sidebar"
            >
              <PanelLeftClose className="h-4 w-4" />
            </button>
          )}
        </div>

        {(() => {
  if (isSelectionMode) {
    return <div className="flex items-center justify-between gap-2 rounded-3xl border border-border/40 bg-card/50 px-4 py-3">
            <span className="text-sm text-muted-foreground">{selectedIds.size} selected</span>
            <div className="flex gap-2">
              <Button onClick={toggleSelectAll} variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs transition-all duration-300 ease-out active:scale-95">
                {(() => {
            if (allFilteredSelected) {
              return "Clear";
            }
            return "Select all";
          })()}
              </Button>
              <Button onClick={handleDeleteSelected} variant="ghost" size="sm" disabled={selectedIds.size === 0} className="h-8 rounded-full px-3 text-xs text-destructive transition-all duration-300 ease-out active:scale-95">
                Delete
              </Button>
              <Button onClick={toggleSelectionMode} variant="ghost" size="sm" className="h-8 rounded-full px-3 text-xs transition-all duration-300 ease-out active:scale-95">
                <X className="mr-1 h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          </div>;
  }
  return <div className="flex gap-2">
            <Button onClick={onNewChat} variant="ghost" className="h-10 flex-1 justify-start gap-2 rounded-full border border-border/40 bg-card/50 text-sm font-medium transition-all duration-300 ease-out hover:bg-card active:scale-95">
              <Plus className="h-4 w-4" />
              New Session
            </Button>
            <Button onClick={toggleSelectionMode} variant="ghost" size="icon" title="Select chats" className="h-10 w-10 rounded-full border border-border/40 bg-card/50 transition-all duration-300 ease-out hover:bg-card active:scale-95">
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
            </Button>
            <Button onClick={handleDeleteAll} variant="ghost" size="icon" title="Delete all chats" disabled={chats.length === 0} className="h-10 w-10 rounded-full border border-border/40 bg-card/50 text-destructive transition-all duration-300 ease-out hover:bg-card active:scale-95 disabled:opacity-40">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>;
})()}

        <div className="relative mt-4">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchTerm}
            onChange={handleSearchChange}
            placeholder="Search conversations"
            aria-label="Search chats"
            className="h-11 w-full rounded-full border border-border/40 bg-card/30 pl-11 pr-4 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
          />
        </div>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
        {(() => {
  if (filteredChats.length === 0) {
    return <div className="rounded-3xl border border-border/30 bg-card/30 px-4 py-6 text-sm text-muted-foreground">
            No chats match your search.
          </div>;
  }
  return <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {filteredChats.map((chat, index) => <ChatListItem key={chat.id} chat={chat} index={index} activeId={activeId} editingId={editingId} draftTitle={draftTitle} isSelectionMode={isSelectionMode} selectedIds={selectedIds} onSelect={onSelect} onDelete={onDelete} onDraftTitleChange={setDraftTitle} startRename={startRename} cancelRename={cancelRename} commitRename={commitRename} toggleSelection={toggleSelection} />)}
            </AnimatePresence>
          </ul>;
})()}
      </div>
    </aside>
  );
};
export { ChatSidebar };
export type { ChatSummary };
