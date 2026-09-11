import type { ResearchPageViewProps } from "../components/research-page";
import type { DeepReadonly } from "../model/types";
import type { ResearchChatActions } from "./use-research-chat-actions";
import type { ResearchChatState } from "./research-chat-state";
import type { ResearchMessageActions } from "./use-research-message-actions";
import type { ResearchDerivedState } from "./use-research-derived-state";

interface ResearchPageAssemblyContext {
  readonly actions: ResearchChatActions;
  readonly chatState: ResearchChatState;
  readonly derivedState: ResearchDerivedState;
  readonly messageActions: ResearchMessageActions;
}

const createSidebarModel = (
  actions: Readonly<ResearchChatActions>,
  chatState: Readonly<ResearchChatState>,
): ResearchPageViewProps["sidebar"] => ({
  activeChatId: chatState.activeChatId,
  chats: [...chatState.chats],
  collapsed: chatState.sidebarCollapsed,
  onDelete: actions.handleDeleteChat,
  onDeleteMultiple: actions.handleDeleteChats,
  onNew: actions.handleNewChat,
  onRename: actions.handleRenameChat,
  onSelect: actions.handleSelectChat,
  onToggle: actions.toggleSidebar,
});

const createChatModel = (
  chatState: Readonly<ResearchChatState>,
  derivedState: Readonly<ResearchDerivedState>,
  messageActions: Readonly<ResearchMessageActions>,
  actions: Readonly<ResearchChatActions>,
): ResearchPageViewProps["workspace"]["chat"] => ({
  activeAssistantVersions: chatState.activeAssistantVersions,
  chatScrollRef: chatState.setChatScrollElement,
  conversationMessages: [...chatState.conversationMessages],
  editingDraft: chatState.editingDraft,
  editingMessageId: chatState.editingMessageId,
  expandedSourceIds: new Set(chatState.expandedSourceIds),
  expandedStepMessageIds: new Set(chatState.expandedStepMessageIds),
  groupedSources: derivedState.groupedSources,
  inputRef: chatState.setInputElement,
  isSearching: chatState.isSearching,
  latestAssistantMessage: derivedState.latestAssistantMessage,
  latestSemanticMessage: derivedState.latestSemanticMessage,
  latestUserMessage: derivedState.latestUserMessage,
  messages: [...chatState.messages],
  onCancelEdit: messageActions.handleCancelEditMessage,
  onCopy: (content) => void messageActions.handleCopyMessage(content),
  onDelete: messageActions.handleDeleteMessage,
  onEdit: messageActions.handleEditMessage,
  onFocusInput: chatState.focusInput,
  onOpenArticle: derivedState.handleOpenArticle,
  onReset: (messageId) => void messageActions.handleResetMessage(messageId),
  onSaveEdit: () => void messageActions.handleSaveEditedMessage(),
  onSearch: () => void messageActions.handleSearch(),
  onSelectVersion: messageActions.handleSelectMessageVersion,
  onStop: actions.handleStop,
  onToggleSource: actions.toggleSourceVisibility,
  onToggleSteps: actions.toggleStepVisibility,
  query: chatState.query,
  setEditingDraft: chatState.setEditingDraft,
  setQuery: chatState.setQuery,
  thinkingSteps: [...derivedState.thinkingSteps],
});

const createEmptyModel = (
  chatState: Readonly<ResearchChatState>,
  messageActions: Readonly<ResearchMessageActions>,
): ResearchPageViewProps["workspace"]["empty"] => ({
  inputRef: chatState.setInputElement,
  isSearching: chatState.isSearching,
  onFocusInput: chatState.focusInput,
  onSampleQuery: messageActions.handleSampleQuery,
  onSearch: () => void messageActions.handleSearch(),
  query: chatState.query,
  setQuery: chatState.setQuery,
});

const createWorkspaceModel = (
  actions: Readonly<ResearchChatActions>,
  chatState: Readonly<ResearchChatState>,
  derivedState: Readonly<ResearchDerivedState>,
  messageActions: Readonly<ResearchMessageActions>,
): ResearchPageViewProps["workspace"] => ({
  activeBriefTitle: derivedState.activeBriefTitle,
  chat: createChatModel(chatState, derivedState, messageActions, actions),
  collapsed: chatState.sidebarCollapsed,
  empty: createEmptyModel(chatState, messageActions),
  isEmpty: derivedState.isEmpty,
  isSearching: chatState.isSearching,
  latestAssistantMessage: derivedState.latestAssistantMessage,
  messageCount: chatState.conversationMessages.length,
  onStop: actions.handleStop,
  onToggleSidebar: actions.toggleSidebar,
});

const createResearchPageViewProps = ({
  actions,
  chatState,
  derivedState,
  messageActions,
}: DeepReadonly<ResearchPageAssemblyContext>): ResearchPageViewProps => ({
  articleModal: {
    article: chatState.selectedArticle,
    isOpen: chatState.isArticleModalOpen,
    onClose: derivedState.handleCloseArticle,
  },
  sidebar: createSidebarModel(actions, chatState),
  workspace: createWorkspaceModel(actions, chatState, derivedState, messageActions),
});

export { createResearchPageViewProps };
export type { ResearchPageAssemblyContext };
