import { Loader2, Square } from "lucide-react";
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

const StreamingMessage = ({
  message,
  onStop,
}: Readonly<Pick<MessageBodyProps, "message" | "onStop">>) => (
  <div className="flex items-center gap-2 text-muted-foreground">
    <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
    <span>{message.streamingStatus ?? "Working..."}</span>
    <button
      type="button"
      onClick={onStop}
      className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-border/40 hover:text-foreground"
      title="Stop generation"
    >
      <Square className="h-3 w-3" />
      Stop
    </button>
  </div>
);

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
