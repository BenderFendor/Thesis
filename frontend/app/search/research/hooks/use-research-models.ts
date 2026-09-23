import { API_BASE_URL } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import { ResearchModelCatalogSchema } from "../model/schemas";
import type { ResearchModelCatalog } from "../model/types";

const EMPTY_CATALOG: ResearchModelCatalog = {
  default: null,
  models: [],
  provider: "unknown",
};

const fetchResearchModelCatalog = async (signal: AbortSignal): Promise<ResearchModelCatalog> => {
  const response = await fetch(`${API_BASE_URL}/api/news/research/models`, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new Error(`Model catalog request failed: ${response.status}`);
  }
  const parsed = ResearchModelCatalogSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new Error("Model catalog response was invalid.");
  }
  return parsed.data;
};

const chooseResearchModel = (
  current: string | undefined,
  catalog: ResearchModelCatalog,
): string | undefined => {
  if (current !== undefined && catalog.models.some((model) => model.id === current)) {
    return current;
  }
  return catalog.default ?? catalog.models[0]?.id;
};

const useResearchModelCatalog = () => {
  const [catalog, setCatalog] = useState<ResearchModelCatalog>(EMPTY_CATALOG);
  const [selectedModelId, setSelectedModelId] = useState<string>();
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const selectModel = useCallback((modelId: string): void => {
    setSelectedModelId(modelId);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const loadCatalog = async (): Promise<void> => {
      try {
        const nextCatalog = await fetchResearchModelCatalog(controller.signal);
        setCatalog(nextCatalog);
        setSelectedModelId((current) => chooseResearchModel(current, nextCatalog));
        setHasError(false);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setHasError(true);
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    };
    void loadCatalog();
    return () => {
      controller.abort();
    };
  }, []);

  return { catalog, hasError, isLoading, selectModel, selectedModelId, setSelectedModelId };
};

export { useResearchModelCatalog };
