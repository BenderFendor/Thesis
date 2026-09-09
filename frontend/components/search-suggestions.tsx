"use client";
import { hasText } from "@/lib/utils";

import { Loader2, Search, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { SearchSuggestion } from "@/lib/api";
import { fetchSearchSuggestions } from "@/lib/api";
import { useDebounce } from "@/hooks/use-debounce";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

interface SearchSuggestionsProps {
  readonly query: string;
  readonly onSuggestionClick?: (suggestion: SearchSuggestion) => void;
  readonly minQueryLength?: number;
  readonly debounceMs?: number;
  readonly className?: string;
}

const EMPTY_SEARCH_SUGGESTIONS: readonly SearchSuggestion[] = [];

export const SearchSuggestions = ({
  query,
  onSuggestionClick,
  minQueryLength = 3,
  debounceMs = 300,
  className = "",
}: SearchSuggestionsProps) => {
  const debouncedQuery = useDebounce(query, debounceMs);
  const suggestionsQuery = useQuery<readonly SearchSuggestion[]>({
      enabled: debouncedQuery.length >= minQueryLength,
      queryFn: async () => {
        const response = await fetchSearchSuggestions(debouncedQuery, 5);
        return response.suggestions;
      },
      queryKey: ["search-suggestions", debouncedQuery, minQueryLength],
      retry: 1,
    });
  const suggestions = suggestionsQuery.data ?? EMPTY_SEARCH_SUGGESTIONS;
  const loading = suggestionsQuery.isLoading;
  const error = (() => {
  if (suggestionsQuery.error instanceof Error) {
    return suggestionsQuery.error.message;
  }
  return null;
})();
  const suggestionHandlers = useMemo(
      () =>
        new Map(
          suggestions.map((suggestion) => [
            suggestion.cluster_id,
            () => onSuggestionClick?.(suggestion),
          ]),
        ),
      [onSuggestionClick, suggestions],
    );

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

  if (hasText(error) || suggestions.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <TrendingUp className="w-3 h-3" />
        <span>Related topics</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.cluster_id}
            type="button"
            onClick={suggestionHandlers.get(suggestion.cluster_id)}
            className="group"
          >
            <Badge
              variant="outline"
              className="cursor-pointer transition-colors hover:bg-primary/15 hover:border-primary/40 hover:text-primary"
            >
              <Search className="w-3 h-3 mr-1.5 opacity-50 group-hover:opacity-100" />
              {suggestion.label}
              <span className="ml-1.5 text-[10px] opacity-50">
                {Math.round(suggestion.relevance * 100)}%
              </span>
            </Badge>
          </button>
        ))}
      </div>
    </div>
  );
};
