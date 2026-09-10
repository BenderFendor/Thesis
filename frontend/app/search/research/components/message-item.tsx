import { motion } from "framer-motion";
import type { Transition } from "framer-motion";
import { getMessageVersionInfo } from "@/lib/chat-branching";
import type { Message, ReadonlyNewsArticle } from "../model/types";
import { MessageActionBar, MessageStepsToggle } from "./message-item-actions";
import type { VersionInfo } from "./message-item-actions";
import { MessageBody } from "./message-item-body";

const MESSAGE_MOTION_INITIAL = { opacity: 0, "y": 18 };
const MESSAGE_MOTION_ANIMATE = { opacity: 1, "y": 0 };
const MESSAGE_MOTION_TRANSITION = { duration: 0.3, ease: "easeOut" } satisfies Transition;

interface MessageItemProps {
  readonly message: Readonly<Message>;
  readonly messages: readonly Message[];
  readonly activeAssistantVersions: Readonly<Record<string, string>>;
  readonly editingMessageId: string | null;
  readonly editingDraft: string;
  readonly setEditingDraft: (value: string) => void;
  readonly isSearching: boolean;
  readonly expandedStepMessageIds: ReadonlySet<string>;
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

const getMessageClass = (message: Message): string => {
  if (message.type === "user") {
    return "border-border/5 bg-[var(--news-bg-secondary)]/30 ml-20";
  }
  if (message.error === true) {
    return "border-border/5 bg-destructive/5 mr-12";
  }
  return "border-transparent bg-transparent pl-0 pr-0 mt-2 mr-4";
};

const getMessageAuthor = (isAssistant: boolean): string => {
  if (isAssistant) {
    return "Assistant";
  }
  return "You";
};

const ConversationMessageHeader = ({
  isAssistant,
  timestamp,
}: Readonly<{ isAssistant: boolean; timestamp: Date }>) => (
  <div className="flex items-center justify-between font-mono text-xs uppercase tracking-wider text-muted-foreground">
    <span>{getMessageAuthor(isAssistant)}</span>
    <span>
      {timestamp.toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      })}
    </span>
  </div>
);

interface ConversationMessageDetailsProps {
  readonly item: MessageItemProps;
  readonly isAssistant: boolean;
  readonly isInlineEditing: boolean;
  readonly versionInfo: VersionInfo | null;
  readonly stepsExpanded: boolean;
}

const ConversationMessageBody = ({
  item,
  isAssistant,
  isInlineEditing,
}: Readonly<Pick<ConversationMessageDetailsProps, "item" | "isAssistant" | "isInlineEditing">>) => {
  const {
    editingDraft,
    isSearching,
    message,
    onCancelEdit: handleCancelEdit,
    onOpenArticle: handleOpenArticle,
    onSaveEdit: handleSaveEdit,
    onStop: handleStop,
    setEditingDraft,
  } = item;
  return (
    <div className="mt-3 text-base text-foreground/90">
      <MessageBody
        message={message}
        isAssistant={isAssistant}
        isInlineEditing={isInlineEditing}
        editingDraft={editingDraft}
        isSearching={isSearching}
        setEditingDraft={setEditingDraft}
        onStop={handleStop}
        onSaveEdit={handleSaveEdit}
        onCancelEdit={handleCancelEdit}
        onOpenArticle={handleOpenArticle}
      />
    </div>
  );
};

const ConversationMessageControls = ({
  item,
  isAssistant,
  isInlineEditing,
  versionInfo,
  stepsExpanded,
}: Readonly<ConversationMessageDetailsProps>) => {
  const {
    isSearching,
    message,
    onCopy: handleCopy,
    onDelete: handleDelete,
    onEdit: handleEdit,
    onReset: handleReset,
    onSelectVersion: handleSelectVersion,
    onToggleSteps: handleToggleSteps,
  } = item;
  return (
    <>
      <MessageActionBar
        message={message}
        isAssistant={isAssistant}
        isInlineEditing={isInlineEditing}
        isSearching={isSearching}
        versionInfo={versionInfo}
        onSelectVersion={handleSelectVersion}
        onCopy={handleCopy}
        onEdit={handleEdit}
        onReset={handleReset}
        onDelete={handleDelete}
      />
      <MessageStepsToggle
        message={message}
        isAssistant={isAssistant}
        stepsExpanded={stepsExpanded}
        onToggleSteps={handleToggleSteps}
      />
    </>
  );
};

const ConversationMessageDetails = ({
  item,
  isAssistant,
  isInlineEditing,
  versionInfo,
  stepsExpanded,
}: Readonly<ConversationMessageDetailsProps>) => (
  <>
    <ConversationMessageHeader isAssistant={isAssistant} timestamp={item.message.timestamp} />
    <ConversationMessageBody
      item={item}
      isAssistant={isAssistant}
      isInlineEditing={isInlineEditing}
    />
    <ConversationMessageControls
      item={item}
      isAssistant={isAssistant}
      isInlineEditing={isInlineEditing}
      versionInfo={versionInfo}
      stepsExpanded={stepsExpanded}
    />
  </>
);

const ConversationMessageItem = (props: MessageItemProps) => {
  const { message, messages, activeAssistantVersions, editingMessageId, expandedStepMessageIds } =
    props;
  const isAssistant = message.type === "assistant";
  const isInlineEditing = !isAssistant && editingMessageId === message.id;
  const stepsExpanded = expandedStepMessageIds.has(message.id);
  const versionInfo = getMessageVersionInfo(messages, message.id, activeAssistantVersions);
  const messageClass = getMessageClass(message);
  return (
    <motion.div
      initial={MESSAGE_MOTION_INITIAL}
      animate={MESSAGE_MOTION_ANIMATE}
      transition={MESSAGE_MOTION_TRANSITION}
      className={`rounded-xl border px-5 py-3.5 ${messageClass}`}
    >
      <ConversationMessageDetails
        item={props}
        isAssistant={isAssistant}
        isInlineEditing={isInlineEditing}
        versionInfo={versionInfo}
        stepsExpanded={stepsExpanded}
      />
    </motion.div>
  );
};

export { ConversationMessageItem };
