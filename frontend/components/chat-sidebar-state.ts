import { hasText } from "@/lib/utils";
import { useCallback, useMemo, useState } from "react";
import type { ChatSidebarProps, ChatSummary } from "./chat-sidebar-types";

const filterChats = (chats: readonly ChatSummary[], searchTerm: string): readonly ChatSummary[] => {
  const term = searchTerm.trim().toLowerCase();
  if (term === "") {
    return chats;
  }
  return chats.filter((chat) => {
    const titleMatches = chat.title.toLowerCase().includes(term);
    const messageMatches = chat.lastMessage?.toLowerCase().includes(term);
    return titleMatches || messageMatches === true;
  });
};

const useChatSidebarSearch = (chats: readonly ChatSummary[]) => {
  const [searchTerm, setSearchTerm] = useState("");
  const filteredChats = useMemo(() => filterChats(chats, searchTerm), [chats, searchTerm]);
  return { filteredChats, searchTerm, setSearchTerm };
};

const useChatSidebarRename = (onRename: ChatSidebarProps["onRename"]) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
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
    const trimmedTitle = draftTitle.trim();
    if (trimmedTitle !== "") {
      onRename(editingId, trimmedTitle);
    }
    cancelRename();
  };
  return { cancelRename, commitRename, draftTitle, editingId, setDraftTitle, startRename };
};

const deleteChats = (
  chatIds: readonly string[],
  onDelete: (id: string) => void,
  onDeleteMultiple: ((ids: readonly string[]) => void) | undefined,
): void => {
  if (onDeleteMultiple) {
    onDeleteMultiple(chatIds);
    return;
  }
  chatIds.forEach((chatId) => {
    onDelete(chatId);
  });
};

const confirmAndDeleteChats = (
  chatIds: readonly string[],
  message: string,
  onDelete: (id: string) => void,
  onDeleteMultiple: ((ids: readonly string[]) => void) | undefined,
): boolean => {
  if (chatIds.length === 0 || !globalThis.confirm(message)) {
    return false;
  }
  deleteChats(chatIds, onDelete, onDeleteMultiple);
  return true;
};

const useChatSidebarDeletion = ({
  chats,
  selectedIds,
  onDelete,
  onDeleteMultiple,
  clearSelection,
}: Readonly<{
  chats: readonly ChatSummary[];
  selectedIds: ReadonlySet<string>;
  onDelete: (id: string) => void;
  onDeleteMultiple?: (ids: readonly string[]) => void;
  clearSelection: () => void;
}>) => {
  const handleDeleteSelected = useCallback(() => {
    const chatIds = [...selectedIds];
    if (
      confirmAndDeleteChats(
        chatIds,
        `Delete ${chatIds.length} selected chats? This action cannot be undone.`,
        onDelete,
        onDeleteMultiple,
      )
    ) {
      clearSelection();
    }
  }, [clearSelection, onDelete, onDeleteMultiple, selectedIds]);
  const handleDeleteAll = useCallback(() => {
    const chatIds = chats.map((chat) => chat.id);
    if (
      confirmAndDeleteChats(
        chatIds,
        `Delete all ${chatIds.length} chats? This action cannot be undone.`,
        onDelete,
        onDeleteMultiple,
      )
    ) {
      clearSelection();
    }
  }, [chats, clearSelection, onDelete, onDeleteMultiple]);
  return { handleDeleteAll, handleDeleteSelected };
};

const useChatSidebarSelectionActions = (
  filteredChats: readonly ChatSummary[],
  onExitEditing: () => void,
) => {
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsView: ReadonlySet<string> = selectedIds;
  const allFilteredSelected = filteredChats.length > 0 && selectedIds.size === filteredChats.length;
  const clearSelection = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
  }, []);
  const toggleSelectionMode = useCallback(() => {
    setIsSelectionMode((previous) => !previous);
    setSelectedIds(new Set());
    onExitEditing();
  }, [onExitEditing]);
  const toggleSelection = useCallback((chatId: string) => {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  }, []);
  const toggleSelectAll = useCallback(() => {
    if (allFilteredSelected) {
      setSelectedIds(new Set());
      return;
    }
    setSelectedIds(new Set(filteredChats.map((chat) => chat.id)));
  }, [allFilteredSelected, filteredChats]);
  return {
    allFilteredSelected,
    clearSelection,
    isSelectionMode,
    selectedIds: selectedIdsView,
    toggleSelectAll,
    toggleSelection,
    toggleSelectionMode,
  };
};

const useChatSidebarSelection = ({
  chats,
  filteredChats,
  onDelete,
  onDeleteMultiple,
  onExitEditing,
}: Readonly<{
  chats: readonly ChatSummary[];
  filteredChats: readonly ChatSummary[];
  onDelete: (id: string) => void;
  onDeleteMultiple?: (ids: readonly string[]) => void;
  onExitEditing: () => void;
}>) => {
  const selection = useChatSidebarSelectionActions(filteredChats, onExitEditing);
  const deletion = useChatSidebarDeletion({
    chats,
    clearSelection: selection.clearSelection,
    onDelete,
    onDeleteMultiple,
    selectedIds: selection.selectedIds,
  });
  return {
    allFilteredSelected: selection.allFilteredSelected,
    ...deletion,
    isSelectionMode: selection.isSelectionMode,
    selectedIds: selection.selectedIds,
    toggleSelectAll: selection.toggleSelectAll,
    toggleSelection: selection.toggleSelection,
    toggleSelectionMode: selection.toggleSelectionMode,
  };
};

const useChatSidebarState = ({
  chats,
  onDelete,
  onDeleteMultiple,
  onRename,
}: Readonly<Pick<ChatSidebarProps, "chats" | "onDelete" | "onDeleteMultiple" | "onRename">>) => {
  const search = useChatSidebarSearch(chats);
  const rename = useChatSidebarRename(onRename);
  const selection = useChatSidebarSelection({
    chats,
    filteredChats: search.filteredChats,
    onDelete,
    onDeleteMultiple,
    onExitEditing: rename.cancelRename,
  });
  return { ...rename, ...search, ...selection };
};

type ChatSidebarState = ReturnType<typeof useChatSidebarState>;

export { useChatSidebarState, type ChatSidebarState };
