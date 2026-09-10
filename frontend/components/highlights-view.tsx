"use client";

import { Highlighter, X } from "lucide-react";
import type { ChangeEventHandler, Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { deleteHighlight, getAllHighlights } from "@/lib/api";
import type { Highlight } from "@/lib/api";
import { hasText } from "@/lib/utils";
import { toast } from "sonner";

const COLOR_CLASSES = {
  blue: "bg-blue-200 border-blue-300",
  green: "bg-green-200 border-green-300",
  purple: "bg-purple-200 border-purple-300",
  red: "bg-red-200 border-red-300",
  yellow: "bg-yellow-200 border-yellow-300",
} as const satisfies Record<Highlight["color"], string>;
const FILTER_COLORS = ["yellow", "blue", "red"] as const;
type FilterColor = (typeof FILTER_COLORS)[number];

interface HighlightCardProps {
  readonly highlight: Highlight;
  readonly onDelete: (highlightId: number | undefined) => void;
}

interface HighlightFilterButtonProps {
  readonly active: boolean;
  readonly color: FilterColor;
  readonly onFilterChange: (color: FilterColor) => void;
}

interface HighlightsFilterButtonsProps {
  readonly filterColor: Highlight["color"] | null;
  readonly onFilterChange: (color: FilterColor | null) => void;
}

interface HighlightsFilterBarProps {
  readonly filterColor: Highlight["color"] | null;
  readonly onFilterChange: (color: FilterColor | null) => void;
  readonly onSearchChange: (value: string) => void;
  readonly searchTerm: string;
}

interface HighlightsResultProps {
  readonly filtered: readonly Highlight[];
  readonly onDelete: (highlightId: number | undefined) => void;
}

interface HighlightsContentProps extends HighlightsFilterBarProps {
  readonly filtered: readonly Highlight[];
  readonly onDelete: (highlightId: number | undefined) => void;
}

interface HighlightsController {
  readonly filterColor: Highlight["color"] | null;
  readonly filtered: readonly Highlight[];
  readonly handleDelete: (highlightId: number | undefined) => void;
  readonly handleFilterChange: (color: FilterColor | null) => void;
  readonly handleSearchChange: (value: string) => void;
  readonly loading: boolean;
  readonly searchTerm: string;
}

interface LoadedHighlightsState {
  readonly highlights: readonly Highlight[];
  readonly loading: boolean;
  readonly setHighlights: Dispatch<SetStateAction<Highlight[]>>;
}

interface HighlightDeleteAction {
  readonly handleDelete: (highlightId: number | undefined) => Promise<void>;
}

const HighlightCardSource = ({ highlight }: Readonly<Pick<HighlightCardProps, "highlight">>) => (
  <p className="text-xs text-gray-500">
    From:{" "}
    <a
      href={highlight.article_url}
      target="_blank"
      rel="noopener noreferrer"
      className="truncate text-blue-600 hover:underline dark:text-blue-400"
    >
      {highlight.article_url.replace(/^https?:\/\//u, "")}
    </a>
  </p>
);

const HighlightCardBody = ({ highlight }: Readonly<Pick<HighlightCardProps, "highlight">>) => (
  <div className="min-w-0 flex-1">
    <p className="mb-2 text-sm italic text-gray-800">&quot;{highlight.highlighted_text}&quot;</p>
    {hasText(highlight.note) && (
      <p className="mb-2 text-xs text-gray-600">
        <strong>Note:</strong> {highlight.note}
      </p>
    )}
    <HighlightCardSource highlight={highlight} />
  </div>
);

const HighlightDeleteButton = ({ onDelete }: Readonly<{ onDelete: () => void }>) => (
  <Button variant="ghost" size="sm" onClick={onDelete} className="flex-shrink-0">
    <X className="h-4 w-4" />
  </Button>
);

const HighlightCard = ({ highlight, onDelete }: Readonly<HighlightCardProps>) => {
  const handleDelete = useCallback(() => {
    onDelete(highlight.id);
  }, [highlight.id, onDelete]);
  return (
    <Card key={highlight.id} className={`border-2 p-4 ${COLOR_CLASSES[highlight.color]}`}>
      <div className="flex items-start justify-between gap-4">
        <HighlightCardBody highlight={highlight} />
        <HighlightDeleteButton onDelete={handleDelete} />
      </div>
    </Card>
  );
};

const getFilterVariant = (active: boolean): "default" | "outline" => {
  if (active) {
    return "default";
  }
  return "outline";
};

const getFilterClassName = (color: FilterColor, active: boolean): string => {
  if (active) {
    return COLOR_CLASSES[color];
  }
  return "";
};

const getColorLabel = (color: FilterColor): string =>
  `${color.charAt(0).toUpperCase()}${color.slice(1)}`;

const HighlightFilterButton = ({
  active,
  color,
  onFilterChange,
}: Readonly<HighlightFilterButtonProps>) => {
  const handleClick = useCallback(() => {
    onFilterChange(color);
  }, [color, onFilterChange]);
  return (
    <Button
      variant={getFilterVariant(active)}
      size="sm"
      onClick={handleClick}
      className={getFilterClassName(color, active)}
    >
      {getColorLabel(color)}
    </Button>
  );
};

const HighlightsFilterButtons = ({
  filterColor,
  onFilterChange,
}: Readonly<HighlightsFilterButtonsProps>) => {
  const handleAllFilter = useCallback(() => {
    onFilterChange(null);
  }, [onFilterChange]);
  return (
    <div className="flex gap-2 flex-wrap">
      <Button variant={getFilterVariant(filterColor === null)} size="sm" onClick={handleAllFilter}>
        All
      </Button>
      {FILTER_COLORS.map((color) => (
        <HighlightFilterButton
          key={color}
          active={filterColor === color}
          color={color}
          onFilterChange={onFilterChange}
        />
      ))}
    </div>
  );
};

const HighlightsFilterBar = ({
  filterColor,
  onFilterChange,
  onSearchChange,
  searchTerm,
}: Readonly<HighlightsFilterBarProps>) => {
  const handleSearchChange = useCallback<ChangeEventHandler<HTMLInputElement>>(
    (event) => {
      onSearchChange(event.target.value);
    },
    [onSearchChange],
  );
  return (
    <>
      <HighlightsFilterButtons filterColor={filterColor} onFilterChange={onFilterChange} />
      <div className="relative">
        <input
          type="text"
          placeholder="Search highlights..."
          value={searchTerm}
          onChange={handleSearchChange}
          className="w-full px-4 py-2 border rounded-lg dark:bg-gray-800 dark:border-gray-700"
        />
      </div>
    </>
  );
};

const HighlightsEmptyState = () => (
  <div className="text-center py-8 text-gray-600 dark:text-gray-400">
    <Highlighter className="w-8 h-8 mx-auto mb-2 opacity-50" />
    <p>No highlights yet</p>
  </div>
);

const HighlightsResult = ({ filtered, onDelete }: Readonly<HighlightsResultProps>) => {
  if (filtered.length === 0) {
    return <HighlightsEmptyState />;
  }
  return (
    <div className="space-y-3">
      {filtered.map((highlight) => (
        <HighlightCard key={highlight.id} highlight={highlight} onDelete={onDelete} />
      ))}
    </div>
  );
};

const HighlightsContent = ({
  filterColor,
  filtered,
  onDelete,
  onFilterChange,
  onSearchChange,
  searchTerm,
}: Readonly<HighlightsContentProps>) => (
  <div className="space-y-4">
    <HighlightsFilterBar
      filterColor={filterColor}
      onFilterChange={onFilterChange}
      onSearchChange={onSearchChange}
      searchTerm={searchTerm}
    />
    <HighlightsResult filtered={filtered} onDelete={onDelete} />
  </div>
);

const useLoadedHighlights = (): LoadedHighlightsState => {
  const [highlights, setHighlights] = useState<Highlight[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const fetchHighlights = async (): Promise<void> => {
      try {
        setLoading(true);
        const data = await getAllHighlights();
        setHighlights(data);
      } catch (error) {
        console.error("Failed to load highlights:", error);
        toast.error("Failed to load highlights");
      } finally {
        setLoading(false);
      }
    };
    void fetchHighlights();
  }, []);
  return { highlights, loading, setHighlights };
};

const filterHighlights = (
  highlights: readonly Highlight[],
  filterColor: Highlight["color"] | null,
  searchTerm: string,
): Highlight[] => {
  const normalizedSearchTerm = searchTerm.toLowerCase();
  return highlights
    .filter((highlight) => filterColor === null || highlight.color === filterColor)
    .filter(
      (highlight) =>
        highlight.highlighted_text.toLowerCase().includes(normalizedSearchTerm) ||
        highlight.article_url.toLowerCase().includes(normalizedSearchTerm),
    );
};

const useHighlightDelete = (
  setHighlights: Dispatch<SetStateAction<Highlight[]>>,
): HighlightDeleteAction => {
  const handleDelete = useCallback(
    async (highlightId: number | undefined): Promise<void> => {
      if (highlightId === undefined || highlightId === 0) {
        return;
      }
      try {
        await deleteHighlight(highlightId);
        setHighlights((previousHighlights) =>
          previousHighlights.filter((highlight) => highlight.id !== highlightId),
        );
        toast.success("Highlight deleted");
      } catch (error) {
        console.error("Failed to delete highlight:", error);
        toast.error("Failed to delete highlight");
      }
    },
    [setHighlights],
  );
  return { handleDelete };
};

const useHighlightsController = (): HighlightsController => {
  const { highlights, loading, setHighlights } = useLoadedHighlights();
  const [filterColor, setFilterColor] = useState<Highlight["color"] | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const filtered = useMemo(
    () => filterHighlights(highlights, filterColor, searchTerm),
    [filterColor, highlights, searchTerm],
  );
  const handleFilterChange = useCallback((color: FilterColor | null) => {
    setFilterColor(color);
  }, []);
  const handleSearchChange = useCallback((value: string) => {
    setSearchTerm(value);
  }, []);
  const { handleDelete: deleteHighlightById } = useHighlightDelete(setHighlights);
  const handleDelete = useCallback(
    (highlightId: number | undefined) => {
      void deleteHighlightById(highlightId);
    },
    [deleteHighlightById],
  );
  return {
    filterColor,
    filtered,
    handleDelete,
    handleFilterChange,
    handleSearchChange,
    loading,
    searchTerm,
  };
};

const HighlightsView = () => {
  const controller = useHighlightsController();
  if (controller.loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin">
          <Highlighter className="w-8 h-8 text-gray-400" />
        </div>
      </div>
    );
  }
  return (
    <HighlightsContent
      filterColor={controller.filterColor}
      filtered={controller.filtered}
      onDelete={controller.handleDelete}
      onFilterChange={controller.handleFilterChange}
      onSearchChange={controller.handleSearchChange}
      searchTerm={controller.searchTerm}
    />
  );
};

export { HighlightsView };
