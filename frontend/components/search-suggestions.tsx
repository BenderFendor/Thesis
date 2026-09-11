"use client";
import { hasText } from "@/lib/utils";

import { Loader2, TrendingUp } from "lucide-react";
import type { SearchSuggestion } from "@/lib/api";
import {
  SearchSuggestionItems,
  useSearchSuggestionHandlers,
  useSearchSuggestionsQuery,
} from "./search-suggestion-parts";

interface SearchSuggestionsProps {
  readonly query: string;
  readonly onSuggestionClick?: (suggestion: SearchSuggestion) => void;
  readonly minQueryLength?: number;
  readonly debounceMs?: number;
  readonly className?: string;
}

const EMPTY_SEARCH_SUGGESTIONS: readonly SearchSuggestion[] = [];

interface SearchSuggestionResultProps {
  readonly className: string;
  readonly errorMessage: string | undefined;
  readonly loading: boolean;
  readonly minQueryLength: number;
  readonly query: string;
  readonly suggestions: readonly SearchSuggestion[];
  readonly suggestionHandlers: ReadonlyMap<number, () => void>;
}

const SearchSuggestionResult = ({
  className,
  errorMessage,
  loading,
  minQueryLength,
  query,
  suggestions,
  suggestionHandlers,
}: SearchSuggestionResultProps) => {
  if (query.length < minQueryLength) {
    return null;
  }

  if (loading) {
    return (
      <div className={`flex items-center gap-2 text-xs text-muted-foreground ${className}`}>
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Finding related topics...</span>
      </div>
    );
  }

  if (hasText(errorMessage) || suggestions.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <TrendingUp className="w-3 h-3" />
        <span>Related topics</span>
      </div>
      <SearchSuggestionItems suggestions={suggestions} suggestionHandlers={suggestionHandlers} />
    </div>
  );
};

export const SearchSuggestions = ({
  query,
  onSuggestionClick,
  minQueryLength = 3,
  debounceMs = 300,
  className = "",
}: SearchSuggestionsProps) => {
  const {
    data: suggestions = EMPTY_SEARCH_SUGGESTIONS,
    error,
    isLoading: loading,
  } = useSearchSuggestionsQuery(query, minQueryLength, debounceMs);
  const suggestionHandlers = useSearchSuggestionHandlers(suggestions, onSuggestionClick);

  return (
    <SearchSuggestionResult
      className={className}
      errorMessage={error?.message}
      loading={loading}
      minQueryLength={minQueryLength}
      query={query}
      suggestions={suggestions}
      suggestionHandlers={suggestionHandlers}
    />
  );
};
