import { ArrowRight, Search } from "lucide-react";
import type { ChangeEventHandler } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface WorkspaceSearchProps {
  readonly expanded: boolean;
  readonly onExpand: () => void;
  readonly onSearch: (query: string) => void;
}

interface WorkspaceFormSubmitEvent {
  readonly preventDefault: () => void;
}

interface InputFocusTarget {
  readonly focus: () => void;
}

interface WorkspaceSearchFormProps {
  readonly onInputRef: (element: InputFocusTarget | null) => void;
  readonly onQueryChange: ChangeEventHandler<HTMLInputElement>;
  readonly onSubmit: (event: WorkspaceFormSubmitEvent) => void;
  readonly query: string;
}

const CollapsedWorkspaceSearch = (
  props: Readonly<{ readonly onOpen: () => void }>,
) => (
  <button
    type="button"
    onClick={props.onOpen}
    className="flex h-11 w-full items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-white/10 hover:bg-white/[0.05] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    aria-label="Open workspace search"
    title="Search"
  >
    <Search className="h-5 w-5" strokeWidth={1.6} />
  </button>
);

const WorkspaceSearchForm = ({
  onInputRef,
  onQueryChange,
  onSubmit,
  query,
}: Readonly<WorkspaceSearchFormProps>) => (
  <form onSubmit={onSubmit} aria-label="Search the workspace" className="relative">
    <Search
      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
      strokeWidth={1.6}
      aria-hidden="true"
    />
    <input
      ref={onInputRef}
      type="search"
      value={query}
      onChange={onQueryChange}
      placeholder="Search the workspace"
      aria-label="Search the workspace"
      className="h-11 w-full rounded-lg border border-white/10 bg-[var(--news-bg-primary)] pl-10 pr-11 text-sm text-foreground placeholder:text-muted-foreground/65 focus:border-primary/60 focus:outline-none focus:ring-2 focus:ring-primary/30"
    />
    <button
      type="submit"
      className={cn(
        "absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        !query.trim() && "opacity-50",
      )}
      aria-label="Submit search"
    >
      <ArrowRight className="h-4 w-4" />
    </button>
  </form>
);

export const WorkspaceSearch = ({
  expanded,
  onExpand,
  onSearch,
}: Readonly<WorkspaceSearchProps>) => {
  const [query, setQuery] = useState(""),
    inputRef = useRef<InputFocusTarget | null>(null),
    shouldFocusRef = useRef(false);

  useEffect(() => {
    if (expanded && shouldFocusRef.current) {
      shouldFocusRef.current = false;
      inputRef.current?.focus();
    }
  }, [expanded]);

  const handleCollapsedClick = useCallback(() => {
    shouldFocusRef.current = true;
    onExpand();
  }, [onExpand]);
  const handleInputRef = useCallback((element: InputFocusTarget | null): void => {
    inputRef.current = element;
  }, []);
  const handleSubmit = useCallback(
    (event: WorkspaceFormSubmitEvent) => {
      event.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) {
        inputRef.current?.focus();
        return;
      }
      onSearch(trimmed);
    },
    [onSearch, query],
  );
  const handleQueryChange = useCallback<ChangeEventHandler<HTMLInputElement>>((event) => {
    setQuery(event.target.value);
  }, []);

  if (!expanded) {
    return <CollapsedWorkspaceSearch onOpen={handleCollapsedClick} />;
  }

  return (
    <WorkspaceSearchForm
      onInputRef={handleInputRef}
      onQueryChange={handleQueryChange}
      onSubmit={handleSubmit}
      query={query}
    />
  );
};
