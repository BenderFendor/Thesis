import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type React from "react";
import type { SearchSuggestion } from "@/lib/api";
import { SearchSuggestions } from "@/components/search-suggestions";
import { useCallback } from "react";

type ComposerChangeEvent = Readonly<{
  target: Readonly<{ value: string }>;
}>;

type ComposerKeyDownEvent = Readonly<{
  key: string;
  preventDefault: () => void;
  shiftKey: boolean;
}>;

type ComposerSubmitEvent = Readonly<{
  preventDefault: () => void;
}>;

interface ChatComposerFormProps {
  query: string;
  setQuery: (value: string) => void;
  isSearching: boolean;
  inputRef: React.RefCallback<HTMLTextAreaElement>;
  onFocusInput: () => void;
  onSearch: () => void | Promise<void>;
}

interface ChatComposerInputHandlers {
  readonly handleChange: (event: ComposerChangeEvent) => void;
  readonly handleKeyDown: (event: ComposerKeyDownEvent) => void;
  readonly handleSuggestionClick: (suggestion: Readonly<SearchSuggestion>) => void;
}

const useChatComposerInputHandlers = (
  setQuery: (value: string) => void,
  onFocusInput: () => void,
  onSearch: () => void | Promise<void>,
): ChatComposerInputHandlers => {
  const handleChange = useCallback(
    (event: ComposerChangeEvent) => {
      setQuery(event.target.value);
    },
    [setQuery],
  );
  const handleKeyDown = useCallback(
    (event: ComposerKeyDownEvent) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void onSearch();
      }
    },
    [onSearch],
  );
  const handleSuggestionClick = useCallback(
    (suggestion: Readonly<SearchSuggestion>) => {
      setQuery(suggestion.label);
      onFocusInput();
    },
    [onFocusInput, setQuery],
  );
  return { handleChange, handleKeyDown, handleSuggestionClick };
};

const ChatComposerInput = ({
  query,
  setQuery,
  isSearching,
  inputRef,
  onFocusInput,
  onSearch,
}: Readonly<
  Pick<
    ChatComposerFormProps,
    "query" | "setQuery" | "isSearching" | "inputRef" | "onFocusInput" | "onSearch"
  >
>) => {
  const { handleChange, handleKeyDown, handleSuggestionClick } = useChatComposerInputHandlers(
    setQuery,
    onFocusInput,
    onSearch,
  );
  return (
    <>
      <div className="relative rounded-xl border border-border/40 bg-card/50 px-2 py-1 transition-all duration-300 ease-out focus-within:border-primary/40 focus-within:bg-card/60">
        <textarea
          ref={inputRef}
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question and press Enter..."
          className="h-10 w-full resize-none bg-transparent px-1 py-2 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
          disabled={isSearching}
        />
      </div>
      {query.length >= 3 && (
        <SearchSuggestions
          query={query}
          onSuggestionClick={handleSuggestionClick}
          className="pt-2"
        />
      )}
    </>
  );
};

const ChatComposerSubmit = ({
  query,
  isSearching,
}: Readonly<Pick<ChatComposerFormProps, "query" | "isSearching">>) => (
  <Button
    type="submit"
    size="sm"
    disabled={!query.trim() || isSearching}
    className="h-10 rounded-full bg-primary px-6 text-background transition-all duration-300 ease-out active:scale-95"
  >
    {(() => {
  if (isSearching) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }
  return <>
        Send <ArrowRight className="ml-1 h-4 w-4" />
      </>;
})()}
  </Button>
);

const ChatComposerActions = ({
  query,
  isSearching,
}: Readonly<Pick<ChatComposerFormProps, "query" | "isSearching">>) => (
  <div className="flex flex-wrap items-center justify-between gap-3">
    <div className="flex flex-wrap gap-2" />
    <ChatComposerSubmit query={query} isSearching={isSearching} />
  </div>
);

const ChatComposerForm = (props: Readonly<ChatComposerFormProps>) => {
  const { query, setQuery, isSearching, inputRef, onFocusInput, onSearch } = props;
  const handleSubmit = useCallback(
    (event: ComposerSubmitEvent) => {
      event.preventDefault();
      void onSearch();
    },
    [onSearch],
  );
  return (
    <div className="border-t border-border/20 bg-background/70 p-4 backdrop-blur-xl">
      <form onSubmit={handleSubmit} className="space-y-2">
        <ChatComposerInput
          query={query}
          setQuery={setQuery}
          isSearching={isSearching}
          inputRef={inputRef}
          onFocusInput={onFocusInput}
          onSearch={onSearch}
        />
        <ChatComposerActions query={query} isSearching={isSearching} />
      </form>
    </div>
  );
};

export { ChatComposerForm };
