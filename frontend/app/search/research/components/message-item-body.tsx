import { AlertTriangle, Loader2, Square } from "lucide-react";
import { useCallback } from "react";
import { Button } from "@/components/ui/button";
import { buildArticleEmbeds } from "../model/articles";
import type { Message, ReadonlyNewsArticle } from "../model/types";
import { EmbeddedContent } from "./message-item-markdown";
import type {
  MarkdownChangeEvent,
  MarkdownKeyDownEvent,
  MarkdownSubmitEvent,
} from "./message-item-markdown";

interface MessageBodyProps {
  readonly message: Readonly<Message>;
  readonly isAssistant: boolean;
  readonly isInlineEditing: boolean;
  readonly editingDraft: string;
  readonly isSearching: boolean;
  readonly setEditingDraft: (value: string) => void;
  readonly onStop: () => void;
  readonly onSaveEdit: () => void;
  readonly onCancelEdit: () => void;
  readonly onOpenArticle: (article: ReadonlyNewsArticle) => void;
}

interface InlineMessageEditorActionsProps {
  readonly editingDraft: string;
  readonly isSearching: boolean;
  readonly onCancelEdit: () => void;
}

const InlineMessageEditorActions = ({
  editingDraft,
  isSearching,
  onCancelEdit,
}: Readonly<InlineMessageEditorActionsProps>) => (
  <div className="flex justify-end gap-2">
    <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit} disabled={isSearching}>
      Cancel
    </Button>
    <Button type="submit" size="sm" disabled={editingDraft.trim().length === 0 || isSearching}>
      Save
    </Button>
  </div>
);

interface InlineMessageEditorInputProps {
  readonly editingDraft: string;
  readonly isSearching: boolean;
  readonly onChange: (event: MarkdownChangeEvent) => void;
  readonly onKeyDown: (event: MarkdownKeyDownEvent) => void;
}

const InlineMessageEditorInput = ({
  editingDraft,
  isSearching,
  onChange,
  onKeyDown,
}: Readonly<InlineMessageEditorInputProps>) => (
  <textarea
    value={editingDraft}
    onChange={onChange}
    onKeyDown={onKeyDown}
    disabled={isSearching}
    className="min-h-28 w-full resize-y rounded-2xl border border-primary/30 bg-background/60 px-4 py-3 text-base text-foreground focus:outline-none"
  />
);

type InlineMessageEditorProps = Readonly<
  Pick<
    MessageBodyProps,
    "editingDraft" | "isSearching" | "setEditingDraft" | "onSaveEdit" | "onCancelEdit"
  >
>;

const InlineMessageEditor = (props: InlineMessageEditorProps) => {
  const { editingDraft, isSearching, setEditingDraft, onSaveEdit, onCancelEdit } = props;
  const handleSubmit = useCallback(
    (event: MarkdownSubmitEvent) => {
      event.preventDefault();
      onSaveEdit();
    },
    [onSaveEdit],
  );
  const handleChange = useCallback(
    (event: MarkdownChangeEvent) => {
      setEditingDraft(event.target.value);
    },
    [setEditingDraft],
  );
  const handleKeyDown = useCallback(
    (event: MarkdownKeyDownEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        onSaveEdit();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCancelEdit();
      }
    },
    [onCancelEdit, onSaveEdit],
  );
  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <InlineMessageEditorInput
        editingDraft={editingDraft}
        isSearching={isSearching}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
      />
      <InlineMessageEditorActions
        editingDraft={editingDraft}
        isSearching={isSearching}
        onCancelEdit={onCancelEdit}
      />
    </form>
  );
};

const StreamingSteps = ({
  activities,
  steps,
}: Readonly<{ activities?: Message["activities"]; steps?: Message["thinking_steps"] }>) => {
  const visibleActivities = activities?.slice(-3) ?? [];
  if (visibleActivities.length === 0 && (steps === undefined || steps.length === 0)) {
    return null;
  }
  return (
    <div className="mt-2 space-y-1.5" aria-live="polite">
      {visibleActivities.map((activity) => (
        <div
          key={activity.id}
          className="rounded-lg border border-border/20 bg-background/30 px-2.5 py-1.5 text-xs"
        >
          <div className="flex items-center gap-1.5 font-mono uppercase tracking-wide text-muted-foreground/65">
            {activityLabel(activity)}
          </div>
          <div className="mt-0.5 line-clamp-2 text-muted-foreground">{activity.content}</div>
        </div>
      ))}
      {visibleActivities.length === 0 && steps?.slice(-3).map((step) => (
        <div
          key={`${step.timestamp}-${step.type}-${step.content}`}
          className="rounded-lg border border-border/20 bg-background/30 px-2.5 py-1.5 text-xs"
        >
          <div className="font-mono uppercase tracking-wide text-muted-foreground/65">
            {step.type.replace("_", " ")}
          </div>
          <div className="mt-0.5 line-clamp-2 text-muted-foreground">{step.content}</div>
        </div>
      ))}
    </div>
  );
};

const activityLabel = (activity: NonNullable<Message["activities"]>[number]): string => {
  if (activity.type === "thought") {
    return "working note";
  }
  return activity.tool ?? activity.type;
};

const StopButton = ({ onStop }: Readonly<{ onStop: () => void }>) => (
  <button
    type="button"
    onClick={onStop}
    className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-border/40 hover:text-foreground"
    title="Stop generation"
  >
    <Square className="h-3 w-3" />
    Stop
  </button>
);

const StreamingMessage = ({
  message,
  onStop,
}: Readonly<Pick<MessageBodyProps, "message" | "onStop">>) => (
  <>
    <div className="flex items-center gap-2">
      <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
      <span>{message.streamingStatus ?? "Working..."}</span>
      <StopButton onStop={onStop} />
    </div>
    <StreamingSteps activities={message.activities} steps={message.thinking_steps} />
    {message.streamingReasoning !== undefined && message.streamingReasoning.length > 0 && (
      <details className="mt-4 rounded-lg border border-border/30 bg-card/50 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground">Model reasoning</summary>
        <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">{message.streamingReasoning}</p>
      </details>
    )}
    {message.streamingText !== undefined && message.streamingText.length > 0 && (
      <p className="mt-4 whitespace-pre-wrap break-words leading-relaxed">{message.streamingText}</p>
    )}
  </>
);

const ResearchErrorMessage = ({ message }: Readonly<{ message: Readonly<Message> }>) => {
  const isRateLimited = message.errorCode === "rate_limit";
  const unavailable = message.errorCode === "provider_unavailable" || message.content.includes("Error code: 503");
  let title = "Research stopped";
  let description = message.content;
  if (unavailable) {
    title = "Model temporarily unavailable";
    description = "The provider could not complete this request. Your research activity is still available. Retry or choose another model above.";
  }
  if (isRateLimited) {
    title = "Model rate-limited";
  }
  return (
    <div className="rounded-xl border border-destructive/20 bg-destructive/[0.06] px-3.5 py-3">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive/90">
        <AlertTriangle className="h-4 w-4" aria-hidden="true" />
        {title}
      </div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{description}</p>
      {isRateLimited && (
        <p className="mt-2 text-xs text-muted-foreground/75">
          Choose another model above, then use Retry on this response.
        </p>
      )}
    </div>
  );
};

const MessageBody = (props: Readonly<MessageBodyProps>) => {
  const {
    message,
    isAssistant,
    isInlineEditing,
    editingDraft,
    isSearching,
    setEditingDraft,
    onStop,
    onSaveEdit,
    onCancelEdit,
    onOpenArticle,
  } = props;
  if (isInlineEditing) {
    return (
      <InlineMessageEditor
        editingDraft={editingDraft}
        isSearching={isSearching}
        setEditingDraft={setEditingDraft}
        onSaveEdit={onSaveEdit}
        onCancelEdit={onCancelEdit}
      />
    );
  }
  if (isAssistant && message.isStreaming === true) {
    return <StreamingMessage message={message} onStop={onStop} />;
  }
  if (isAssistant && message.error === true) {
    return <ResearchErrorMessage message={message} />;
  }
  if (isAssistant) {
    return (
      <EmbeddedContent
        content={message.content}
        articles={buildArticleEmbeds(message)}
        onOpenArticle={onOpenArticle}
      />
    );
  }
  return <p>{message.content}</p>;
};

export { MessageBody };
