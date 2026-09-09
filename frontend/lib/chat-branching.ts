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

type BranchGroupMap<T> = Map<string | null, Map<string, T[]>>;

interface BranchGroupResult<T extends BranchableChatMessage> {
  readonly branchGroups: BranchGroupMap<T>;
  readonly resolvedParents: Map<string, string | null>;
}

const isVisibleConversationMessage = (message: BranchableChatMessage): boolean =>
  message.toolType === undefined || message.toolType === "";

const getMessageVersionGroupId = (
  message: Pick<BranchableChatMessage, "id" | "retryOfMessageId">,
): string => message.retryOfMessageId ?? message.id;

const getVisibleMessages = function getVisibleMessages<T extends BranchableChatMessage>(
  messages: readonly T[],
): T[] {
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

const getBranchGroupMap = function getBranchGroupMap<T extends BranchableChatMessage>(
  messages: readonly T[],
): BranchGroupResult<T> {
  const resolvedParents = getResolvedParentMap(messages);
  const branchGroups: BranchGroupMap<T> = new Map();

  getVisibleMessages(messages).forEach((message) => {
    const parentId = resolvedParents.get(message.id) ?? null;
    const groupId = getMessageVersionGroupId(message);
    const parentGroups = branchGroups.get(parentId) ?? new Map<string, T[]>();
    const siblings = parentGroups.get(groupId) ?? [];

    siblings.push(message);
    parentGroups.set(groupId, siblings);
    branchGroups.set(parentId, parentGroups);
  });

  return { branchGroups, resolvedParents };
};

const resolveActiveVersion = function resolveActiveVersion<T extends BranchableChatMessage>(
  versions: readonly T[],
  activeVersionId?: string,
): T {
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

const getVisibleConversationMessages = function getVisibleConversationMessages<
  T extends BranchableChatMessage,
>(messages: readonly T[], activeVersionByGroup: Readonly<Record<string, string>>): T[] {
  const { branchGroups } = getBranchGroupMap(messages),
    path: T[] = [];
  let parentId: string | null = null;

  while (true) {
    const childGroups = branchGroups.get(parentId);
    if (!childGroups || childGroups.size === 0) {
      break;
    }

    const nextGroup = childGroups.entries().next();
    if (nextGroup.done === true) {
      break;
    }
    const [groupId, versions] = nextGroup.value,
      activeMessage = resolveActiveVersion(versions, activeVersionByGroup[groupId]);

    path.push(activeMessage);
    parentId = activeMessage.id;
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
