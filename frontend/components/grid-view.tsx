"use client";

import { Loader2 } from "lucide-react";
import { createElement } from "react";
import { GridViewContent, VirtualizedModeView } from "./grid-view-layout";
import { useGridViewModel } from "./grid-view-model";
import type { GridViewProps } from "./grid-view-model";

const LOADING_STYLE = { minHeight: "calc(100vh - 140px)" };

export const GridView = (props: Readonly<GridViewProps>) => {
  const model = useGridViewModel(props);

  if (model.isLoadingState && model.displayArticles.length === 0) {
    return (
      <div
        className="flex h-full w-full items-center justify-center bg-background"
        style={LOADING_STYLE}
      >
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-primary/50" />
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Curating stories...
          </p>
        </div>
      </div>
    );
  }

  if (props.useVirtualization === true) {
    return createElement(VirtualizedModeView, model.virtualized);
  }

  return createElement(GridViewContent, model.content);
};
