"use client";

import type { SearchSuggestion } from "@/lib/api";
import { fetchSearchSuggestions } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { useDebounce } from "@/hooks/use-debounce";
import { useMemo } from "react";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

const useSearchSuggestionsQuery = (query: string, minQueryLength: number, debounceMs: number) => {
  const debouncedQuery = useDebounce(query, debounceMs);
  return useQuery<readonly SearchSuggestion[]>({
    enabled: debouncedQuery.length >= minQueryLength,
    queryFn: async () => {
      const response = await fetchSearchSuggestions(debouncedQuery, 5);
      return response.suggestions;
    },
    queryKey: ["search-suggestions", debouncedQuery, minQueryLength],
    retry: 1,
  });
};

const useSearchSuggestionHandlers = (
  suggestions: readonly SearchSuggestion[],
  onSuggestionClick?: (suggestion: SearchSuggestion) => void,
) =>
  useMemo(
    () =>
      new Map(
        suggestions.map((suggestion) => [
          suggestion.cluster_id,
          () => {
            onSuggestionClick?.(suggestion);
          },
        ]),
      ),
    [onSuggestionClick, suggestions],
  );

const SearchSuggestionBadge = ({ suggestion }: { readonly suggestion: SearchSuggestion }) => (
  <Badge
    variant="outline"
    className="cursor-pointer transition-colors hover:bg-primary/15 hover:border-primary/40 hover:text-primary"
  >
    <Search className="w-3 h-3 mr-1.5 opacity-50 group-hover:opacity-100" />
    {suggestion.label}
    <span className="ml-1.5 text-[10px] opacity-50">{Math.round(suggestion.relevance * 100)}%</span>
  </Badge>
);

interface SearchSuggestionItemsProps {
  readonly suggestions: readonly SearchSuggestion[];
  readonly suggestionHandlers: ReadonlyMap<number, () => void>;
}

const SearchSuggestionItems = ({ suggestions, suggestionHandlers }: SearchSuggestionItemsProps) => (
  <div className="flex flex-wrap gap-2">
    {suggestions.map((suggestion) => (
      <button
        key={suggestion.cluster_id}
        type="button"
        onClick={suggestionHandlers.get(suggestion.cluster_id)}
        className="group"
      >
        <SearchSuggestionBadge suggestion={suggestion} />
      </button>
    ))}
  </div>
);

export { SearchSuggestionItems, useSearchSuggestionHandlers, useSearchSuggestionsQuery };
