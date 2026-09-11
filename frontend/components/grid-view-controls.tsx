"use client";

import { Layers,List,Search } from "lucide-react";
import {
Select,
SelectContent,
SelectItem,
SelectTrigger,
SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import type { GridViewMode } from "@/lib/view-mode-storage";
import { cn } from "@/lib/utils";
import { useCallback } from "react";

type GridClusterWindow = "1d" | "1w" | "1m";
type GridChangeEvent = Readonly<{ target: Readonly<{ value: string }> }>;

const isGridClusterWindow = (value: string): value is GridClusterWindow =>
  value === "1d" || value === "1w" || value === "1m";

interface GridViewSearchBarProps {
  readonly onChange: (event: GridChangeEvent) => void;
  readonly value: string;
  readonly variant: "virtualized" | "main";
}

const GridViewSearchBar = ({ value, onChange, variant }: GridViewSearchBarProps) => {
  const isVirtualized = variant === "virtualized";
  const containerClass = (() => {
  if (isVirtualized) {
    return "relative";
  }
  return "relative w-full max-w-xl";
})();
  const iconClass = (() => {
  if (isVirtualized) {
    return "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground";
  }
  return "absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70 sm:left-3.5 sm:h-4 sm:w-4";
})();
  const inputClass = (() => {
  if (isVirtualized) {
    return "w-full rounded-xl bg-white/5 px-10 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50";
  }
  return "w-full rounded-lg bg-white/5 px-9 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 transition-all focus:outline-none focus:ring-1 focus:ring-primary/50 sm:rounded-xl sm:px-10";
})();
  const placeholder = (() => {
  if (isVirtualized) {
    return "Search articles...";
  }
  return "Search the news...";
})();

  return (
    <div className={containerClass}>
      <Search className={iconClass} />
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className={inputClass}
      />
    </div>
  );
};

interface ModeSwitcherProps {
  readonly clusterWindow: GridClusterWindow;
  readonly onClusterWindow: (value: GridClusterWindow) => void;
  readonly onModeSelect: (mode: GridViewMode) => void;
  readonly viewMode: GridViewMode;
}

const getModeButtonVariant = (viewMode: GridViewMode, mode: GridViewMode): "default" | "ghost" => {
  if (viewMode === mode) {
    return "default";
  }
  return "ghost";
};

const getModeButtonClass = (viewMode: GridViewMode, mode: GridViewMode): string => {
  if (viewMode === mode) {
    return "bg-white/10 text-white shadow-sm";
  }
  return "text-muted-foreground hover:text-foreground";
};

const getModeButtonClasses = (viewMode: GridViewMode, mode: GridViewMode): string =>
  cn(
    "flex-1 sm:flex-none h-7 rounded-md px-2 sm:px-3 text-[10px] sm:text-xs uppercase tracking-widest transition-all",
    getModeButtonClass(viewMode, mode),
  );

const GridClusterWindowSelect = ({
  clusterWindow,
  onChange,
}: Readonly<{
  clusterWindow: GridClusterWindow;
  onChange: (value: string) => void;
}>) => (
  <Select value={clusterWindow} onValueChange={onChange}>
    <SelectTrigger className="h-9 rounded-lg border-white/5 bg-white/5 text-xs uppercase tracking-widest">
      <SelectValue />
    </SelectTrigger>
    <SelectContent className="rounded-lg border-white/10 bg-background/95 backdrop-blur-xl">
      <SelectItem value="1d" className="text-xs uppercase tracking-widest">
        Last 24h
      </SelectItem>
      <SelectItem value="1w" className="text-xs uppercase tracking-widest">
        Last 7d
      </SelectItem>
      <SelectItem value="1m" className="text-xs uppercase tracking-widest">
        Last 30d
      </SelectItem>
    </SelectContent>
  </Select>
);

interface ModeButtonProps {
  className: string;
  mode: "source" | "topic";
  onClick: () => void;
  variant: "default" | "ghost";
}

const ModeButton = (props: Readonly<ModeButtonProps>) => {
  const { className, mode, onClick, variant } = props;
  if (mode === "source") {
    return (
      <Button variant={variant} size="sm" onClick={onClick} className={className}>
        <List className="mr-1.5 h-3.5 w-3.5" />
        By Source
      </Button>
    );
  }
  return (
    <Button variant={variant} size="sm" onClick={onClick} className={className}>
      <Layers className="mr-1.5 h-3.5 w-3.5" />
      By Topic
    </Button>
  );
};

const ModeSwitcher = ({
  viewMode,
  clusterWindow,
  onModeSelect,
  onClusterWindow,
}: ModeSwitcherProps) => {
  const handleSourceSelect = useCallback(() => {
    onModeSelect("source");
  }, [onModeSelect]);
  const handleTopicSelect = useCallback(() => {
    onModeSelect("topic");
  }, [onModeSelect]);
  const handleClusterWindow = useCallback(
    (value: string) => {
      if (isGridClusterWindow(value)) {
        onClusterWindow(value);
      }
    },
    [onClusterWindow],
  );
  const sourceVariant = getModeButtonVariant(viewMode, "source");
  const topicVariant = getModeButtonVariant(viewMode, "topic");
  const sourceClass = getModeButtonClasses(viewMode, "source");
  const topicClass = getModeButtonClasses(viewMode, "topic");

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:gap-3 lg:w-auto lg:justify-end">
      <div className="flex w-full rounded-lg border border-white/5 bg-white/5 p-1 sm:w-auto">
        <ModeButton
          variant={sourceVariant}
          className={sourceClass}
          onClick={handleSourceSelect}
          mode="source"
        />
        <ModeButton
          variant={topicVariant}
          className={topicClass}
          onClick={handleTopicSelect}
          mode="topic"
        />
      </div>
      {viewMode === "topic" && (
        <GridClusterWindowSelect clusterWindow={clusterWindow} onChange={handleClusterWindow} />
      )}
    </div>
  );
};

export { GridViewSearchBar, ModeSwitcher };
