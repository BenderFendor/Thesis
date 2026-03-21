export interface BranchableChatMessage {
  id: string;
  type: "user" | "assistant";
  toolType?: string;
  retryOfMessageId?: string;
  parentMessageId?: string;
}

export interface MessageVersionInfo {
  groupId: string;
  currentIndex: number;
  totalVersions: number;
  versionIds: string[];
}

type BranchGroupMap<T> = Map<string | null, Map<string, T[]>>;

function isVisibleConversationMessage<T extends BranchableChatMessage>(
  message: T,
): boolean {
  return !message.toolType;
}

export function getMessageVersionGroupId(
  message: Pick<BranchableChatMessage, "id" | "retryOfMessageId">,
): string {
  return message.retryOfMessageId ?? message.id;
}

function getVisibleMessages<T extends BranchableChatMessage>(messages: T[]): T[] {
  return messages.filter(isVisibleConversationMessage);
}

function getResolvedParentMap<T extends BranchableChatMessage>(
  messages: T[],
): Map<string, string | null> {
  const resolvedParents = new Map<string, string | null>();
  let previousVisibleMessageId: string | null = null;

  getVisibleMessages(messages).forEach((message) => {
    const parentId = message.parentMessageId ?? previousVisibleMessageId;
    resolvedParents.set(message.id, parentId);
    previousVisibleMessageId = message.id;
  });

  return resolvedParents;
}

function getBranchGroupMap<T extends BranchableChatMessage>(
  messages: T[],
): {
  branchGroups: BranchGroupMap<T>;
  resolvedParents: Map<string, string | null>;
} {
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
}

function resolveActiveVersion<T extends BranchableChatMessage>(
  versions: T[],
  activeVersionId?: string,
): T {
  return (
    versions.find((message) => message.id === activeVersionId) ??
    versions[versions.length - 1]
  );
}

export function getVisibleConversationMessages<T extends BranchableChatMessage>(
  messages: T[],
  activeVersionByGroup: Record<string, string>,
): T[] {
  const { branchGroups } = getBranchGroupMap(messages);
  const path: T[] = [];
  let parentId: string | null = null;

  while (true) {
    const childGroups = branchGroups.get(parentId);
    if (!childGroups || childGroups.size === 0) {
      break;
    }

    const [groupId, versions] = childGroups.entries().next().value as [
      string,
      T[],
    ];
    const activeMessage = resolveActiveVersion(
      versions,
      activeVersionByGroup[groupId],
    );

    path.push(activeMessage);
    parentId = activeMessage.id;
  }

  return path;
}

export function getMessageVersionInfo<T extends BranchableChatMessage>(
  messages: T[],
  messageId: string,
  activeVersionByGroup: Record<string, string>,
): MessageVersionInfo | null {
  const { branchGroups, resolvedParents } = getBranchGroupMap(messages);
  const targetMessage = getVisibleMessages(messages).find(
    (message) => message.id === messageId,
  );

  if (!targetMessage) {
    return null;
  }

  const parentId = resolvedParents.get(targetMessage.id) ?? null;
  const groupId = getMessageVersionGroupId(targetMessage);
  const versions = branchGroups.get(parentId)?.get(groupId);

  if (!versions || versions.length <= 1) {
    return null;
  }

  const activeVersion = resolveActiveVersion(
    versions,
    activeVersionByGroup[groupId],
  );
  const currentIndex = versions.findIndex(
    (message) => message.id === activeVersion.id,
  );

  return {
    groupId,
    currentIndex,
    totalVersions: versions.length,
    versionIds: versions.map((message) => message.id),
  };
}
