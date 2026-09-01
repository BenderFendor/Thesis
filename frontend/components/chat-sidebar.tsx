import React, { useMemo, useState } from "react";
import { Button } from "./ui/button";
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
import { AnimatePresence, motion } from "framer-motion";

export interface ChatSummary {
  id: string;
  title: string;
  lastMessage?: string;
  updatedAt?: string;
}

interface ChatSidebarProps {
  chats: ChatSummary[];
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onRename: (id: string, title: string) => void;
  onDelete: (id: string) => void;
  onDeleteMultiple?: (ids:readonly  string[]) => void;
  activeId?: string | null;
  collapsed?: boolean;
  onToggle?: () => void;
}

interface ChatListItemProps {
  chat: ChatSummary;
  index: number;
  activeId?: string | null;
  editingId: string | null;
  draftTitle: string;
  isSelectionMode: boolean;
  selectedIds: ReadonlySet<string>;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onDraftTitleChange: (title: string) => void;
  startRename: (chat: ChatSummary) => void;
  cancelRename: () => void;
  commitRename: () => void;
  toggleSelection: (id: string) => void;
}

function chatItemClassName(isSelectionMode: boolean, isSelected: boolean, isActive: boolean): string {
  if (isSelectionMode) {
    return isSelected
      ? "border-primary/40 bg-primary/10"
      : "border-border/30 bg-card/30 hover:bg-card/50";
  }
  return isActive
    ? "border-primary/40 bg-card shadow-lg shadow-black/20"
    : "border-border/30 bg-card/30 hover:bg-card/50";
}

interface ChatListItemSelectionProps {
  isSelectionMode: boolean;
  isSelected: boolean;
}

function ChatListItemSelection({
  isSelectionMode,
  isSelected,
}: ChatListItemSelectionProps): React.JSX.Element | null {
  if (!isSelectionMode) {return null;}
  return (
    <div
      className={`mt-1 flex h-5 w-5 items-center justify-center rounded-full border ${
        isSelected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border/50 bg-transparent"
      }`}
    >
      {isSelected && <CheckSquare className="h-3 w-3" />}
    </div>
  );
}

interface ChatListItemBodyProps {
  chat: ChatSummary;
  isEditing: boolean;
  isSelectionMode: boolean;
  draftTitle: string;
  onSelect: (id: string) => void;
  onDraftTitleChange: (title: string) => void;
  cancelRename: () => void;
  commitRename: () => void;
  toggleSelection: (id: string) => void;
}

function ChatListItemBody({
  chat,
  isEditing,
  isSelectionMode,
  draftTitle,
  onSelect,
  onDraftTitleChange,
  cancelRename,
  commitRename,
  toggleSelection,
}: ChatListItemBodyProps): React.JSX.Element {
  return (
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-muted-foreground">
          Thread
        </span>
        {chat.updatedAt && (
          <span className="text-xs text-muted-foreground">
            {new Date(chat.updatedAt).toLocaleDateString("en-US", {
              day: "numeric",
              month: "short",
            })}
          </span>
        )}
      </div>

      {isEditing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            commitRename();
          }}
          onClick={(event) =>{  event.stopPropagation(); }}
        >
          <input
            value={draftTitle}
            onChange={(event) =>{  onDraftTitleChange(event.target.value); }}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                cancelRename();
              }
            }}
            autoFocus
            className="w-full rounded-2xl border border-primary/40 bg-background/60 px-3 py-2 text-sm font-serif text-foreground focus:outline-none"
          />
        </form>
      ) : (
        <button
          onClick={(event) => {
            if (isSelectionMode) {
              event.preventDefault();
              toggleSelection(chat.id);
            } else {
              onSelect(chat.id);
            }
          }}
          className="w-full text-left"
          aria-label={`Open chat ${chat.title}`}
          disabled={isSelectionMode}
        >
          <div className="font-serif text-base text-foreground line-clamp-2">
            {chat.title}
          </div>
          {chat.lastMessage && (
            <div className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
              {chat.lastMessage}
            </div>
          )}
        </button>
      )}
    </div>
  );
}

interface ChatListItemActionsProps {
  chat: ChatSummary;
  isEditing: boolean;
  isSelectionMode: boolean;
  onDelete: (id: string) => void;
  startRename: (chat: ChatSummary) => void;
  commitRename: () => void;
}

function ChatListItemActions({
  chat,
  isEditing,
  isSelectionMode,
  onDelete,
  startRename,
  commitRename,
}: ChatListItemActionsProps): React.JSX.Element | null {
  if (isSelectionMode) {return null;}
  return (
    <div className="flex flex-col gap-2 opacity-0 transition-opacity duration-300 ease-out group-hover:opacity-100 group-focus-within:opacity-100">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (isEditing) {
            commitRename();
          } else {
            startRename(chat);
          }
        }}
        className="rounded-full border border-border/40 bg-background/50 p-2 text-muted-foreground transition-all duration-300 ease-out hover:bg-card hover:text-foreground active:scale-95"
        aria-label="Rename chat"
      >
        <PenLine className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (
            globalThis.confirm(
              "Delete this chat? This action cannot be undone.",
            )
          ) {
            onDelete(chat.id);
          }
        }}
        className="rounded-full border border-border/40 bg-background/50 p-2 text-destructive transition-all duration-300 ease-out hover:bg-card active:scale-95"
        aria-label="Delete chat"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function ChatListItemCard(props: ChatListItemProps): React.JSX.Element {
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

  return (
    <div
      className={`group rounded-3xl border p-4 transition-all duration-300 ease-out ${chatItemClassName(isSelectionMode, isSelected, isActive)}`}
      onClick={() => {
        if (isSelectionMode) {
          toggleSelection(chat.id);
        }
      }}
    >
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
    </div>
  );
}

function ChatListItem({ chat, index, ...props }: ChatListItemProps): React.JSX.Element {
  return (
    <motion.li
      key={chat.id}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ delay: index * 0.02, duration: 0.2, ease: "easeOut" }}
    >
      <ChatListItemCard chat={chat} index={index} {...props} />
    </motion.li>
  );
}

export function ChatSidebar({
  chats,
  onSelect,
  onNewChat,
  onRename,
  onDelete,
  onDeleteMultiple,
  activeId,
  collapsed = false,
  onToggle,
}: ChatSidebarProps) {
  const [searchTerm, setSearchTerm] = useState(""),
   [editingId, setEditingId] = useState<string | null>(null),
   [draftTitle, setDraftTitle] = useState(""),
   [isSelectionMode, setIsSelectionMode] = useState(false),
   [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()),

   filteredChats = useMemo(() => {
    if (!searchTerm.trim()) {return chats;}
    const term = searchTerm.trim().toLowerCase();

    return chats.filter((chat) => {
      const inTitle = chat.title?.toLowerCase().includes(term),
       inMessage = chat.lastMessage?.toLowerCase().includes(term);
      return inTitle || inMessage;
    });
  }, [chats, searchTerm]),

   allFilteredSelected =
    filteredChats.length > 0 && selectedIds.size === filteredChats.length,

   startRename = (chat: ChatSummary) => {
    setEditingId(chat.id);
    setDraftTitle(chat.title);
  },

   cancelRename = () => {
    setEditingId(null);
    setDraftTitle("");
  },

   commitRename = () => {
    if (!editingId) {return;}
    const trimmed = draftTitle.trim();
    if (trimmed) {
      onRename(editingId, trimmed);
    }
    cancelRename();
  },

   toggleSelectionMode = () => {
    setIsSelectionMode((prev) => !prev);
    setSelectedIds(new Set());
    setEditingId(null);
  },

   toggleSelection = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  },

   handleDeleteSelected = () => {
    if (selectedIds.size === 0) {return;}

    if (
      globalThis.confirm(
        `Delete ${selectedIds.size} selected chats? This action cannot be undone.`,
      )
    ) {
      if (onDeleteMultiple) {
        onDeleteMultiple([...selectedIds]);
      } else {
        selectedIds.forEach((id) =>{  onDelete(id); });
      }
      setIsSelectionMode(false);
      setSelectedIds(new Set());
    }
  },

   handleDeleteAll = () => {
    if (chats.length === 0) {return;}

    if (
      globalThis.confirm(
        `Delete all ${chats.length} chats? This action cannot be undone.`,
      )
    ) {
      const ids = chats.map((chat) => chat.id);
      if (onDeleteMultiple) {
        onDeleteMultiple(ids);
      } else {
        ids.forEach((id) =>{  onDelete(id); });
      }
      setIsSelectionMode(false);
      setSelectedIds(new Set());
    }
  },

   toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
      return;
    }

    setSelectedIds(new Set(filteredChats.map((chat) => chat.id)));
  };

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
          {chats.map((chat) => {
            const isActive = activeId === chat.id;

            return (
              <button
                key={chat.id}
                onClick={() =>{  onSelect(chat.id); }}
                title={chat.title}
                className={`flex h-11 w-11 items-center justify-center rounded-2xl border text-xs font-semibold uppercase tracking-wide transition-all duration-300 ease-out active:scale-95 ${
                  isActive
                    ? "border-primary/40 bg-primary/15 text-primary shadow-lg shadow-black/20"
                    : "border-border/30 bg-card/50 text-muted-foreground hover:bg-card hover:text-foreground"
                }`}
              >
                {chat.title?.charAt(0)?.toUpperCase() || "?"}
              </button>
            );
          })}
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
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Workspace
            </div>
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

        {isSelectionMode ? (
          <div className="flex items-center justify-between gap-2 rounded-3xl border border-border/40 bg-card/50 px-4 py-3">
            <span className="text-sm text-muted-foreground">
              {selectedIds.size} selected
            </span>
            <div className="flex gap-2">
              <Button
                onClick={toggleSelectAll}
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3 text-xs transition-all duration-300 ease-out active:scale-95"
              >
                {allFilteredSelected ? "Clear" : "Select all"}
              </Button>
              <Button
                onClick={handleDeleteSelected}
                variant="ghost"
                size="sm"
                disabled={selectedIds.size === 0}
                className="h-8 rounded-full px-3 text-xs text-destructive transition-all duration-300 ease-out active:scale-95"
              >
                Delete
              </Button>
              <Button
                onClick={toggleSelectionMode}
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3 text-xs transition-all duration-300 ease-out active:scale-95"
              >
                <X className="mr-1 h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              onClick={onNewChat}
              variant="ghost"
              className="h-10 flex-1 justify-start gap-2 rounded-full border border-border/40 bg-card/50 text-sm font-medium transition-all duration-300 ease-out hover:bg-card active:scale-95"
            >
              <Plus className="h-4 w-4" />
              New Session
            </Button>
            <Button
              onClick={toggleSelectionMode}
              variant="ghost"
              size="icon"
              title="Select chats"
              className="h-10 w-10 rounded-full border border-border/40 bg-card/50 transition-all duration-300 ease-out hover:bg-card active:scale-95"
            >
              <CheckSquare className="h-4 w-4 text-muted-foreground" />
            </Button>
            <Button
              onClick={handleDeleteAll}
              variant="ghost"
              size="icon"
              title="Delete all chats"
              disabled={chats.length === 0}
              className="h-10 w-10 rounded-full border border-border/40 bg-card/50 text-destructive transition-all duration-300 ease-out hover:bg-card active:scale-95 disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}

        <div className="relative mt-4">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={searchTerm}
            onChange={(event) =>{  setSearchTerm(event.target.value); }}
            placeholder="Search conversations"
            aria-label="Search chats"
            className="h-11 w-full rounded-full border border-border/40 bg-card/30 pl-11 pr-4 text-sm placeholder:text-muted-foreground focus:border-primary/40 focus:outline-none"
          />
        </div>
      </div>

      <div className="no-scrollbar flex-1 overflow-y-auto px-3 py-4">
        {filteredChats.length === 0 ? (
          <div className="rounded-3xl border border-border/30 bg-card/30 px-4 py-6 text-sm text-muted-foreground">
            No chats match your search.
          </div>
        ) : (
          <ul className="space-y-2">
            <AnimatePresence initial={false}>
              {filteredChats.map((chat, index) => (
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
                  onDraftTitleChange={setDraftTitle}
                  startRename={startRename}
                  cancelRename={cancelRename}
                  commitRename={commitRename}
                  toggleSelection={toggleSelection}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </aside>
  );
}

export default ChatSidebar;
