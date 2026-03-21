"use client";

import { useQuery } from "@tanstack/react-query";
import { Search, TrendingUp, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { fetchSearchSuggestions, SearchSuggestion } from "@/lib/api";
import { useDebounce } from "@/hooks/useDebounce";

interface SearchSuggestionsProps {
  query: string;
  onSuggestionClick?: (suggestion: SearchSuggestion) => void;
  minQueryLength?: number;
  debounceMs?: number;
  className?: string;
}

export function SearchSuggestions({
  query,
  onSuggestionClick,
  minQueryLength = 3,
  debounceMs = 300,
  className = "",
}: SearchSuggestionsProps) {
  const debouncedQuery = useDebounce(query, debounceMs);
  const suggestionsQuery = useQuery<SearchSuggestion[]>({
    queryKey: ["search-suggestions", debouncedQuery, minQueryLength],
    queryFn: async () => {
      const response = await fetchSearchSuggestions(debouncedQuery, 5);
      return response.suggestions;
    },
    enabled: debouncedQuery.length >= minQueryLength,
    retry: 1,
  });
  const suggestions = suggestionsQuery.data ?? [];
  const loading = suggestionsQuery.isLoading;
  const error = suggestionsQuery.error instanceof Error ? suggestionsQuery.error.message : null;

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

  if (error || suggestions.length === 0) {
    return null;
  }

  return (
    <div className={`${className}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <TrendingUp className="w-3 h-3" />
        <span>Related topics</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion.cluster_id}
            type="button"
            onClick={() => onSuggestionClick?.(suggestion)}
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
}
