import type { Message, StoredChatState, StoredMessage } from "../model/types";
import { parseStoredChatState } from "../model/schemas";

const CHAT_STORAGE_KEY = "news-research.chat-state";
const CHAT_STORAGE_VERSION = 1;
type RevivedChatMessages = Readonly<Record<string, readonly Message[]>>;

const reviveStoredMessage = ({ timestamp, ...item }: StoredMessage): Message => {
  let revivedTimestamp = new Date();
  if (timestamp.length > 0) {
    revivedTimestamp = new Date(timestamp);
  }
  return {
    ...item,
    isStreaming: false,
    timestamp: revivedTimestamp,
  };
};

const reviveStoredChatMessages = (
  messages: StoredChatState["messages"] | undefined,
): RevivedChatMessages => {
  const revivedMessages = Object.fromEntries(
    Object.entries(messages ?? {}).map(([chatId, items]) => [
      chatId,
      items.map((item) => reviveStoredMessage(item)),
    ]),
  );
  return revivedMessages satisfies RevivedChatMessages;
};

const getHydratedChatId = (
  stored: Readonly<StoredChatState>,
  revivedMessages: Readonly<RevivedChatMessages>,
): string | null => {
  if (
    stored.activeChatId !== undefined &&
    stored.activeChatId !== null &&
    revivedMessages[stored.activeChatId] !== undefined
  ) {
    return stored.activeChatId;
  }
  return stored.chats[0]?.id ?? null;
};

const serializeChatMessages = (
  chatMessagesMap: Readonly<Record<string, readonly Message[]>>,
): StoredChatState["messages"] =>
  Object.fromEntries(
    Object.entries(chatMessagesMap).map(([chatId, items]) => [
      chatId,
      items.map((item) => ({
        ...item,
        timestamp: item.timestamp.toISOString(),
      })),
    ]),
  );

const parsePersistedChatState = (raw: string): StoredChatState | undefined => {
  const parsed = parseStoredChatState(raw);
  if (parsed?.version !== CHAT_STORAGE_VERSION) {
    return void 0;
  }
  return parsed;
};

export {
  CHAT_STORAGE_KEY,
  CHAT_STORAGE_VERSION,
  getHydratedChatId,
  parsePersistedChatState,
  reviveStoredChatMessages,
  serializeChatMessages,
};
