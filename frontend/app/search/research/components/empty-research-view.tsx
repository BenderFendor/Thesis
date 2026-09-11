import { ArrowRight, Clock, Cpu, Filter, Loader2 } from "lucide-react";
import type React from "react";
import type { SearchSuggestion } from "@/lib/api";
import { SearchSuggestions } from "@/components/search-suggestions";
import { motion } from "framer-motion";
import { sampleQueries } from "../model/articles";
import { useCallback } from "react";

type EmptyChangeEvent = Readonly<{
  target: Readonly<{ value: string }>;
}>;

type EmptyKeyDownEvent = Readonly<{
  key: string;
  preventDefault: () => void;
  shiftKey: boolean;
}>;

type EmptySubmitEvent = Readonly<{
  preventDefault: () => void;
}>;

type SampleQueryClickEvent = Readonly<{
  currentTarget: Readonly<{
    dataset: Readonly<Record<string, string | undefined>>;
  }>;
}>;

const SAMPLE_QUERY_LIMIT = 3;
const VERTICAL_OFFSET_KEY = "y";
const EMPTY_HEADER_INITIAL = { opacity: 0, [VERTICAL_OFFSET_KEY]: 24 };
const EMPTY_HEADER_ANIMATE = { opacity: 1, [VERTICAL_OFFSET_KEY]: 0 };
const EMPTY_HEADER_TRANSITION = { duration: 0.4, ease: "easeOut" as const };
const SAMPLE_QUERY_INITIAL = { opacity: 0, [VERTICAL_OFFSET_KEY]: 18 };
const SAMPLE_QUERY_ANIMATE = { opacity: 1, [VERTICAL_OFFSET_KEY]: 0 };
const SAMPLE_QUERY_TRANSITION = { duration: 0.35, ease: "easeOut" as const };

interface EmptyResearchViewProps {
  readonly query: string;
  readonly setQuery: (value: string) => void;
  readonly isSearching: boolean;
  readonly inputRef: React.RefCallback<HTMLTextAreaElement>;
  readonly onFocusInput: () => void;
  readonly onSearch: () => void | Promise<void>;
  readonly onSampleQuery: (sampleQuery: string) => void;
}

const EmptyResearchHeader = () => (
  <motion.div
    className="mb-6"
    initial={EMPTY_HEADER_INITIAL}
    animate={EMPTY_HEADER_ANIMATE}
    transition={EMPTY_HEADER_TRANSITION}
  >
    <EmptyResearchBrand />
    <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
      Ask a focused question to start a multi-source research brief.
    </p>
  </motion.div>
);

const EmptyResearchBrand = () => (
  <div className="mb-2 flex items-center gap-3">
    <div className="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10">
      <Cpu className="h-4 w-4 text-primary" />
    </div>
    <h1 className="font-serif text-3xl tracking-tight text-foreground">Research Workspace</h1>
  </div>
);

interface EmptyResearchComposerProps {
  query: string;
  setQuery: (value: string) => void;
  isSearching: boolean;
  inputRef: React.RefCallback<HTMLTextAreaElement>;
  onFocusInput: () => void;
  onSearch: () => void | Promise<void>;
}

interface EmptyResearchComposerHandlersProps {
  readonly setQuery: (value: string) => void;
  readonly onFocusInput: () => void;
  readonly onSearch: () => void | Promise<void>;
}

interface EmptyResearchComposerFormProps
  extends Pick<EmptyResearchComposerProps, "inputRef" | "isSearching" | "query"> {
  readonly handleChange: (event: EmptyChangeEvent) => void;
  readonly handleKeyDown: (event: EmptyKeyDownEvent) => void;
  readonly handleSubmit: (event: EmptySubmitEvent) => void;
  readonly handleSuggestionClick: (suggestion: Readonly<SearchSuggestion>) => void;
}

const useEmptyResearchComposerHandlers = ({
  onFocusInput,
  onSearch,
  setQuery,
}: Readonly<EmptyResearchComposerHandlersProps>) => {
  const handleSubmit = useCallback(
    (event: EmptySubmitEvent) => {
      event.preventDefault();
      void onSearch();
    },
    [onSearch],
  );
  const handleChange = useCallback(
    (event: EmptyChangeEvent) => {
      setQuery(event.target.value);
    },
    [setQuery],
  );
  const handleKeyDown = useCallback(
    (event: EmptyKeyDownEvent) => {
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
  return { handleChange, handleKeyDown, handleSubmit, handleSuggestionClick };
};

const EmptyResearchSubmitContent = ({ isSearching }: Readonly<{ isSearching: boolean }>) => {
  if (isSearching) {
    return <Loader2 className="h-4 w-4 animate-spin" />;
  }
  return (
    <>
      Start Research <ArrowRight className="h-4 w-4" />
    </>
  );
};

const EmptyResearchFilterButtons = () => (
  <div className="flex gap-2">
    <button
      type="button"
      className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
    >
      <Filter className="h-4 w-4" />
    </button>
    <button
      type="button"
      className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-background/60 hover:text-foreground"
    >
      <Clock className="h-4 w-4" />
    </button>
  </div>
);

const EmptyResearchToolbar = ({
  isSearching,
  query,
}: Readonly<Pick<EmptyResearchComposerProps, "isSearching" | "query">>) => (
  <div className="mt-2 flex items-center justify-between border-t border-border/20 px-3 pb-1 pt-3">
    <EmptyResearchFilterButtons />
    <button
      type="submit"
      disabled={!query.trim() || isSearching}
      className="flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-sm font-medium text-background transition-all duration-300 ease-out active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <EmptyResearchSubmitContent isSearching={isSearching} />
    </button>
  </div>
);

const EmptyResearchComposerForm = ({
  query,
  isSearching,
  inputRef,
  handleChange,
  handleKeyDown,
  handleSubmit,
  handleSuggestionClick,
}: Readonly<EmptyResearchComposerFormProps>) => (
  <form onSubmit={handleSubmit}>
    <textarea
      ref={inputRef}
      value={query}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder="Ask a question about coverage, bias, or context..."
      className="min-h-20 w-full resize-none bg-transparent px-4 py-3 text-base font-sans text-foreground placeholder:text-muted-foreground/50 focus:outline-none"
    />
    {query.length >= 3 && (
      <SearchSuggestions
        query={query}
        onSuggestionClick={handleSuggestionClick}
        className="mt-2 border-t border-border/40 pt-2"
      />
    )}
    <EmptyResearchToolbar isSearching={isSearching} query={query} />
  </form>
);

const EmptyResearchComposer = ({
  query,
  setQuery,
  isSearching,
  inputRef,
  onFocusInput,
  onSearch,
}: Readonly<EmptyResearchComposerProps>) => {
  const { handleChange, handleKeyDown, handleSubmit, handleSuggestionClick } =
    useEmptyResearchComposerHandlers({ onFocusInput, onSearch, setQuery });
  return (
    <div className="group relative w-full">
      <div className="absolute inset-0 rounded-3xl bg-gradient-to-r from-primary/10 to-transparent opacity-0 blur-xl transition duration-500 group-hover:opacity-100" />
      <div className="relative rounded-2xl border border-border/40 bg-card/40 p-2 shadow-2xl shadow-black/20 backdrop-blur-xl transition-all duration-300 ease-out focus-within:border-primary/30">
        <EmptyResearchComposerForm
          query={query}
          isSearching={isSearching}
          inputRef={inputRef}
          handleChange={handleChange}
          handleKeyDown={handleKeyDown}
          handleSubmit={handleSubmit}
          handleSuggestionClick={handleSuggestionClick}
        />
      </div>
    </div>
  );
};

const SampleQueryGrid = ({
  onSampleQuery,
}: Readonly<Pick<EmptyResearchViewProps, "onSampleQuery">>) => {
  const handleSampleQueryClick = useCallback(
    (event: SampleQueryClickEvent) => {
      const sampleQuery = event.currentTarget.dataset.query;
      if (sampleQuery !== undefined) {
        onSampleQuery(sampleQuery);
      }
    },
    [onSampleQuery],
  );
  return (
    <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
      {sampleQueries.slice(0, SAMPLE_QUERY_LIMIT).map((sampleQuery) => (
        <motion.button
          key={sampleQuery}
          data-query={sampleQuery}
          onClick={handleSampleQueryClick}
          initial={SAMPLE_QUERY_INITIAL}
          animate={SAMPLE_QUERY_ANIMATE}
          transition={SAMPLE_QUERY_TRANSITION}
          className="group rounded-2xl border border-border/40 bg-card/40 p-5 text-left transition-all duration-300 ease-out hover:-translate-y-1 hover:border-primary/30 hover:bg-card/60"
        >
          <p className="text-sm leading-relaxed text-muted-foreground/70 transition-colors group-hover:text-foreground">
            {sampleQuery}
          </p>
        </motion.button>
      ))}
    </div>
  );
};

const EmptyResearchView = ({
  query,
  setQuery,
  isSearching,
  inputRef,
  onFocusInput,
  onSearch,
  onSampleQuery,
}: Readonly<EmptyResearchViewProps>) => (
  <div className="flex flex-1 flex-col p-4 lg:p-8">
    <div className="mx-auto flex w-full max-w-2xl flex-1 -mt-16 flex-col justify-center">
      <EmptyResearchHeader />
      <EmptyResearchComposer
        query={query}
        setQuery={setQuery}
        isSearching={isSearching}
        inputRef={inputRef}
        onFocusInput={onFocusInput}
        onSearch={onSearch}
      />
      <SampleQueryGrid onSampleQuery={onSampleQuery} />
    </div>
  </div>
);

export { EmptyResearchView };
export type { EmptyResearchViewProps };
