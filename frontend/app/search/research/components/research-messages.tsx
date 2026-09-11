import type { Message, ReadonlyNewsArticle } from "../model/types";
import { ConversationMessageItem } from "./message-item";
import type React from "react";

interface ChatScrollAreaProps {
  readonly conversationMessages: readonly Message[];
  readonly messages: readonly Message[];
  readonly activeAssistantVersions: Readonly<Record<string, string>>;
  readonly editingMessageId: string | null;
  readonly editingDraft: string;
  readonly setEditingDraft: (value: string) => void;
  readonly isSearching: boolean;
  readonly expandedStepMessageIds: ReadonlySet<string>;
  readonly chatScrollRef: React.RefCallback<HTMLDivElement>;
  readonly onStop: () => void;
  readonly onCopy: (content: string) => void;
  readonly onEdit: (messageId: string) => void;
  readonly onReset: (messageId: string) => void;
  readonly onDelete: (messageId: string) => void;
  readonly onSaveEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onSelectVersion: (groupId: string, messageId: string) => void;
  readonly onToggleSteps: (messageId: string) => void;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

type ConversationMessageListProps = Readonly<Omit<ChatScrollAreaProps, "chatScrollRef">>;

const renderConversationMessage = (
  message: Readonly<Message>,
  props: ConversationMessageListProps,
): React.ReactElement => (
  <ConversationMessageItem
    key={message.id}
    message={message}
    messages={props.messages}
    activeAssistantVersions={props.activeAssistantVersions}
    editingMessageId={props.editingMessageId}
    editingDraft={props.editingDraft}
    setEditingDraft={props.setEditingDraft}
    isSearching={props.isSearching}
    expandedStepMessageIds={props.expandedStepMessageIds}
    onStop={props.onStop}
    onCopy={props.onCopy}
    onEdit={props.onEdit}
    onReset={props.onReset}
    onDelete={props.onDelete}
    onSaveEdit={props.onSaveEdit}
    onCancelEdit={props.onCancelEdit}
    onSelectVersion={props.onSelectVersion}
    onToggleSteps={props.onToggleSteps}
    onOpenArticle={props.onOpenArticle}
  />
);

const ConversationMessageList = (props: ConversationMessageListProps) => {
  const { conversationMessages } = props;
  if (conversationMessages.length === 0) {
    return (
      <div className="rounded-2xl border border-border/40 bg-card/50 p-6 text-sm text-muted-foreground backdrop-blur-xl">
        Ask a question to start.
      </div>
    );
  }
  return (
    <>
      {conversationMessages.map((message) => renderConversationMessage(message, props))}
    </>
  );
};

const ChatScrollArea = (props: Readonly<ChatScrollAreaProps>) => {
  const {
    chatScrollRef,
    conversationMessages,
    messages,
    activeAssistantVersions,
    editingMessageId,
    editingDraft,
    setEditingDraft,
    isSearching,
    expandedStepMessageIds,
    onStop,
    onCopy,
    onEdit,
    onReset,
    onDelete,
    onSaveEdit,
    onCancelEdit,
    onSelectVersion,
    onToggleSteps,
    onOpenArticle,
  } = props;
  return (
    <div
      ref={chatScrollRef}
      className="custom-scrollbar flex-1 min-h-0 space-y-6 overflow-y-auto px-2 py-6"
    >
      <ConversationMessageList
        conversationMessages={conversationMessages}
        messages={messages}
        activeAssistantVersions={activeAssistantVersions}
        editingMessageId={editingMessageId}
        editingDraft={editingDraft}
        setEditingDraft={setEditingDraft}
        isSearching={isSearching}
        expandedStepMessageIds={expandedStepMessageIds}
        onStop={onStop}
        onCopy={onCopy}
        onEdit={onEdit}
        onReset={onReset}
        onDelete={onDelete}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
        onSelectVersion={onSelectVersion}
        onToggleSteps={onToggleSteps}
        onOpenArticle={onOpenArticle}
      />
    </div>
  );
};
export { ChatScrollArea };
