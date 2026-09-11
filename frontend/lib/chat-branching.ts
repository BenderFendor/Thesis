interface BranchableChatMessage {
  readonly id: string;
  readonly type: "user" | "assistant";
  readonly toolType?: string;
  readonly retryOfMessageId?: string;
  readonly parentMessageId?: string;
}

interface MessageVersionInfo {
  readonly groupId: string;
  readonly currentIndex: number;
  readonly totalVersions: number;
  readonly versionIds: readonly string[];
}

type BranchGroupMap<MessageType> = Map<string | null, Map<string, MessageType[]>>;

interface BranchGroupResult<MessageType extends BranchableChatMessage> {
  readonly branchGroups: BranchGroupMap<MessageType>;
  readonly resolvedParents: Map<string, string | null>;
}

const isVisibleConversationMessage = (message: BranchableChatMessage): boolean =>
  message.toolType === undefined || message.toolType === "";

const getMessageVersionGroupId = (
  message: Pick<BranchableChatMessage, "id" | "retryOfMessageId">,
): string => message.retryOfMessageId ?? message.id;

const getVisibleMessages = function getVisibleMessages<MessageType extends BranchableChatMessage>(
  messages: readonly MessageType[],
): MessageType[] {
  return messages.filter((message) => isVisibleConversationMessage(message));
};

const getResolvedParentMap = function getResolvedParentMap(
  messages: readonly BranchableChatMessage[],
): Map<string, string | null> {
  const resolvedParents = new Map<string, string | null>();
  let previousVisibleMessageId: string | null = null;

  getVisibleMessages(messages).forEach((message) => {
    const parentId = message.parentMessageId ?? previousVisibleMessageId;
    resolvedParents.set(message.id, parentId);
    previousVisibleMessageId = message.id;
  });

  return resolvedParents;
};

const getBranchGroupMap = function getBranchGroupMap<MessageType extends BranchableChatMessage>(
  messages: readonly MessageType[],
): BranchGroupResult<MessageType> {
  const resolvedParents = getResolvedParentMap(messages);
  const branchGroups: BranchGroupMap<MessageType> = new Map();

  getVisibleMessages(messages).forEach((message) => {
    const parentId = resolvedParents.get(message.id) ?? null;
    const groupId = getMessageVersionGroupId(message);
    const parentGroups = branchGroups.get(parentId) ?? new Map<string, MessageType[]>();
    const siblings = parentGroups.get(groupId) ?? [];

    siblings.push(message);
    parentGroups.set(groupId, siblings);
    branchGroups.set(parentId, parentGroups);
  });

  return { branchGroups, resolvedParents };
};

const resolveActiveVersion = function resolveActiveVersion<MessageType extends BranchableChatMessage>(
  versions: readonly MessageType[],
  activeVersionId?: string,
): MessageType {
  const activeVersion = versions.find((message) => message.id === activeVersionId);
  if (activeVersion !== undefined) {
    return activeVersion;
  }
  const latestVersion = versions.at(-1);
  if (latestVersion === undefined) {
    throw new Error("Cannot resolve a version from an empty branch");
  }
  return latestVersion;
};

const getNextBranchMessage = function getNextBranchMessage<
  MessageType extends BranchableChatMessage,
>(
  branchGroups: BranchGroupMap<MessageType>,
  parentId: string | null,
  activeVersionByGroup: Readonly<Record<string, string>>,
): MessageType | undefined {
  const childGroups = branchGroups.get(parentId);
  if (!childGroups || childGroups.size === 0) {
    return void 0;
  }
  const nextGroup = [...childGroups.entries()][0];
  if (nextGroup === undefined) {
    return void 0;
  }
  const [groupId, versions] = nextGroup;
  return resolveActiveVersion(versions, activeVersionByGroup[groupId]);
};

const getVisibleConversationMessages = function getVisibleConversationMessages<
  MessageType extends BranchableChatMessage,
>(messages: readonly MessageType[], activeVersionByGroup: Readonly<Record<string, string>>): MessageType[] {
  const { branchGroups } = getBranchGroupMap(messages),
    path: MessageType[] = [];
  let parentId: string | null = null;

  while (true) {
    const nextMessage: MessageType | undefined = getNextBranchMessage<MessageType>(
      branchGroups,
      parentId,
      activeVersionByGroup,
    );
    if (nextMessage === undefined) {
      break;
    }

    path.push(nextMessage);
    parentId = nextMessage.id;
  }

  return path;
};

const getMessageVersionInfo = function getMessageVersionInfo(
  messages: readonly BranchableChatMessage[],
  messageId: string,
  activeVersionByGroup: Readonly<Record<string, string>>,
): MessageVersionInfo | null {
  const { branchGroups, resolvedParents } = getBranchGroupMap(messages),
    targetMessage = getVisibleMessages(messages).find((message) => message.id === messageId);

  if (!targetMessage) {
    return null;
  }

  const parentId = resolvedParents.get(targetMessage.id) ?? null;
  const groupId = getMessageVersionGroupId(targetMessage);
  const versions = branchGroups.get(parentId)?.get(groupId);

  if (!versions || versions.length <= 1) {
    return null;
  }

  const activeVersion = resolveActiveVersion(versions, activeVersionByGroup[groupId]),
    currentIndex = versions.findIndex((message) => message.id === activeVersion.id);

  return {
    currentIndex,
    groupId,
    totalVersions: versions.length,
    versionIds: versions.map((message) => message.id),
  };
};
export { getMessageVersionGroupId, getVisibleConversationMessages, getMessageVersionInfo };
