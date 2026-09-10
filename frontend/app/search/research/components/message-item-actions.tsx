import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import type { Message } from "../model/types";

type VersionInfo = Readonly<{
  currentIndex: number;
  groupId: string;
  totalVersions: number;
  versionIds: readonly string[];
}> | null;

interface MessageActionBarProps {
  readonly message: Readonly<Message>;
  readonly isAssistant: boolean;
  readonly isInlineEditing: boolean;
  readonly isSearching: boolean;
  readonly versionInfo: VersionInfo | null;
  readonly onSelectVersion: (groupId: string, messageId: string) => void;
  readonly onCopy: (content: string) => void;
  readonly onEdit: (messageId: string) => void;
  readonly onReset: (messageId: string) => void;
  readonly onDelete: (messageId: string) => void;
}

interface VersionArrowProps {
  readonly direction: "next" | "previous";
  readonly disabled: boolean;
  readonly onClick: () => void;
}

const getVersionDirectionLabel = (direction: VersionArrowProps["direction"]): string => {
  if (direction === "previous") {
    return "Previous";
  }
  return "Next";
};

const VersionArrowIcon = ({ direction }: Readonly<Pick<VersionArrowProps, "direction">>) => {
  if (direction === "previous") {
    return <ChevronLeft className="h-3.5 w-3.5" />;
  }
  return <ChevronRight className="h-3.5 w-3.5" />;
};

const VersionArrow = ({ direction, disabled, onClick }: Readonly<VersionArrowProps>) => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    onClick={onClick}
    disabled={disabled}
    className="h-7 w-7 px-0"
    aria-label={`${getVersionDirectionLabel(direction)} message version`}
  >
    <VersionArrowIcon direction={direction} />
  </Button>
);

const MessageVersionControls = ({
  versionInfo,
  onSelectVersion,
}: Readonly<Pick<MessageActionBarProps, "versionInfo" | "onSelectVersion">>) => {
  const selectPreviousVersion = useCallback(() => {
    if (versionInfo === null) {
      return;
    }
    const previousVersionId = versionInfo.versionIds[versionInfo.currentIndex - 1];
    if (previousVersionId !== undefined) {
      onSelectVersion(versionInfo.groupId, previousVersionId);
    }
  }, [onSelectVersion, versionInfo]);
  const selectNextVersion = useCallback(() => {
    if (versionInfo === null) {
      return;
    }
    const nextVersionId = versionInfo.versionIds[versionInfo.currentIndex + 1];
    if (nextVersionId !== undefined) {
      onSelectVersion(versionInfo.groupId, nextVersionId);
    }
  }, [onSelectVersion, versionInfo]);
  if (versionInfo === null) {
    return null;
  }
  return (
    <>
      <VersionArrow
        direction="previous"
        onClick={selectPreviousVersion}
        disabled={versionInfo.currentIndex === 0}
      />
      <span className="font-mono text-xs">
        {versionInfo.currentIndex + 1}/{versionInfo.totalVersions}
      </span>
      <VersionArrow
        direction="next"
        onClick={selectNextVersion}
        disabled={versionInfo.currentIndex === versionInfo.totalVersions - 1}
      />
    </>
  );
};

interface MessageActionButtonProps {
  readonly icon: ActionIconName;
  readonly label: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
}

type ActionIconName = "copy" | "delete" | "edit" | "retry";

interface ActionIconProps {
  readonly name: ActionIconName;
}

const ActionIcon = ({ name }: Readonly<ActionIconProps>) => {
  if (name === "copy") {
    return <Copy className="mr-1 h-3.5 w-3.5" />;
  }
  if (name === "delete") {
    return <Trash2 className="mr-1 h-3.5 w-3.5" />;
  }
  if (name === "edit") {
    return <Pencil className="mr-1 h-3.5 w-3.5" />;
  }
  return <RotateCcw className="mr-1 h-3.5 w-3.5" />;
};

const MessageActionButton = (props: Readonly<MessageActionButtonProps>) => {
  const { disabled, icon, label, onClick } = props;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="h-8 px-2 text-xs"
    >
      <ActionIcon name={icon} />
      {label}
    </Button>
  );
};

type MessageActionButtonsProps = Pick<
  MessageActionBarProps,
  "message" | "isAssistant" | "isSearching" | "onCopy" | "onEdit" | "onReset" | "onDelete"
>;

const MessageActionButtons = (props: Readonly<MessageActionButtonsProps>) => {
  const {
    message,
    isAssistant,
    isSearching,
    onCopy,
    onEdit,
    onReset,
    onDelete,
  } = props;
  const copyMessage = useCallback(() => {
    onCopy(message.content);
  }, [message.content, onCopy]);
  const editMessage = useCallback(() => {
    onEdit(message.id);
  }, [message.id, onEdit]);
  const resetMessage = useCallback(() => {
    onReset(message.id);
  }, [message.id, onReset]);
  const deleteMessage = useCallback(() => {
    onDelete(message.id);
  }, [message.id, onDelete]);
  return (
    <>
      <MessageActionButton icon="copy" label="Copy" onClick={copyMessage} />
      {!isAssistant && (
        <MessageActionButton icon="edit" label="Edit" onClick={editMessage} />
      )}
      {isAssistant && (
        <MessageActionButton
          icon="retry"
          label="Retry"
          onClick={resetMessage}
          disabled={isSearching}
        />
      )}
      <MessageActionButton
        icon="delete"
        label="Delete"
        onClick={deleteMessage}
        disabled={isSearching}
      />
    </>
  );
};

const MessageActionBar = (props: Readonly<MessageActionBarProps>) => {
  const {
    message,
    isAssistant,
    isInlineEditing,
    isSearching,
    versionInfo,
    onSelectVersion,
    onCopy,
    onEdit,
    onReset,
    onDelete,
  } = props;
  if (message.isStreaming === true || message.toolType !== undefined) {
    return null;
  }
  return (
    <div className="mt-3 flex items-center justify-between gap-3 text-muted-foreground">
      <div className="flex min-w-0 items-center gap-1">
        <MessageVersionControls versionInfo={versionInfo} onSelectVersion={onSelectVersion} />
      </div>
      {!isInlineEditing && (
        <div className="flex items-center justify-end gap-1.5">
          <MessageActionButtons
            message={message}
            isAssistant={isAssistant}
            isSearching={isSearching}
            onCopy={onCopy}
            onEdit={onEdit}
            onReset={onReset}
            onDelete={onDelete}
          />
        </div>
      )}
    </div>
  );
};

interface MessageStepsToggleProps {
  readonly message: Readonly<Message>;
  readonly isAssistant: boolean;
  readonly stepsExpanded: boolean;
  readonly onToggleSteps: (messageId: string) => void;
}

const ThinkingSteps = ({
  message,
  stepsExpanded,
}: Readonly<Pick<MessageStepsToggleProps, "message" | "stepsExpanded">>) => {
  const steps = message.thinking_steps ?? [];
  if (!stepsExpanded) {
    return null;
  }
  return (
    <div className="mt-3 space-y-2">
      {steps.map((step, stepIndex) => (
        <div
          key={`${message.id}-step-${step.type}-${step.content}`}
          className="rounded-2xl border border-border/20 bg-background/40 p-3"
        >
          <div className="font-mono text-xs uppercase tracking-wide text-muted-foreground/70">
            Step {stepIndex + 1}: {step.type.replace("_", " ")}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{step.content}</p>
        </div>
      ))}
    </div>
  );
};

const StepsIcon = ({ stepsExpanded }: Readonly<Pick<MessageStepsToggleProps, "stepsExpanded">>) => {
  if (stepsExpanded) {
    return <ChevronUp className="h-4 w-4" />;
  }
  return <ChevronDown className="h-4 w-4" />;
};

const getStepsLabel = (stepsExpanded: boolean, stepCount: number): string => {
  if (stepsExpanded) {
    return "Hide steps";
  }
  return `Show steps (${stepCount})`;
};

const MessageStepsToggle = (props: Readonly<MessageStepsToggleProps>) => {
  const { message, isAssistant, stepsExpanded, onToggleSteps } = props;
  const stepCount = message.thinking_steps?.length ?? 0;
  const toggleSteps = useCallback(() => {
    onToggleSteps(message.id);
  }, [message.id, onToggleSteps]);
  if (!isAssistant || message.isStreaming === true || stepCount === 0) {
    return null;
  }
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggleSteps}
        className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <StepsIcon stepsExpanded={stepsExpanded} />
        {getStepsLabel(stepsExpanded, stepCount)}
      </button>
      <ThinkingSteps message={message} stepsExpanded={stepsExpanded} />
    </div>
  );
};

export type { VersionInfo };
export { MessageActionBar, MessageStepsToggle };
